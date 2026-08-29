import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

from .bank_styles import BANKS, FALLBACK, bank_style_for
from .db import get_db, init_db
from .parsing import parse_statement
from .version import read_version_info

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="TxnTrace Server")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")
templates.env.globals["version_info"] = {}

VERSION_INFO: dict = {}


@app.on_event("startup")
def _startup() -> None:
    init_db()
    VERSION_INFO.update(read_version_info())
    templates.env.globals["version_info"] = VERSION_INFO


@app.get("/api/version")
def api_version():
    return VERSION_INFO


def _row_id(bank: str, row: dict[str, Any]) -> str:
    # Same reasoning as contentKey/extractReference on the mobile side: a
    # deterministic id from the transaction's own content means re-uploading
    # the same statement twice doesn't create duplicate rows.
    basis = f"{bank}|{row['date'][:10]}|{row['amount']}|{row['type']}|{row.get('merchant') or ''}"
    return "stmt_" + hashlib.sha256(basis.encode()).hexdigest()[:24]


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/transactions", response_class=HTMLResponse)
def transactions_page(request: Request):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC").fetchall()
    transactions = []
    for r in rows:
        t = dict(r)
        style = bank_style_for(t.get("bank"))
        t["bank_color"] = style["color"]
        t["bank_logo"] = style["logo"]
        transactions.append(t)
    return templates.TemplateResponse(request, "transactions.html", {"transactions": transactions})


@app.get("/cards", response_class=HTMLResponse)
def cards_page(request: Request):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cards ORDER BY created_at DESC").fetchall()
    return templates.TemplateResponse(
        request, "cards.html", {"cards": [dict(r) for r in rows], "banks": BANKS, "fallback_bank": FALLBACK}
    )


@app.get("/api/cards")
def api_list_cards():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cards ORDER BY created_at DESC").fetchall()
    return {"cards": [dict(r) for r in rows]}


@app.get("/api/cards/export")
def api_export_cards():
    """Pull-sync endpoint for the mobile app — the phone matches SMS against
    this locally, so it needs the full current set every time, not a delta
    (the registry is small and edits should take effect immediately rather
    than waiting on whatever "since" cursor the phone last saved)."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cards ORDER BY created_at DESC").fetchall()
    return {"cards": [dict(r) for r in rows]}


@app.post("/api/cards")
async def api_create_card(payload: dict[str, Any]):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Card name is required.")
    card_id = f"card_{uuid.uuid4().hex[:16]}"
    with get_db() as conn:
        conn.execute(
            """INSERT INTO cards (id, name, bank, last4, credit_limit, is_credit_card, custom_pattern, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                card_id,
                name,
                payload.get("bank"),
                (payload.get("last4") or "").strip() or None,
                payload.get("credit_limit"),
                1 if payload.get("is_credit_card", True) else 0,
                (payload.get("custom_pattern") or "").strip() or None,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    return {"id": card_id}


@app.put("/api/cards/{card_id}")
async def api_update_card(card_id: str, payload: dict[str, Any]):
    with get_db() as conn:
        cur = conn.execute(
            """UPDATE cards SET name = %s, bank = %s, last4 = %s, credit_limit = %s,
               is_credit_card = %s, custom_pattern = %s WHERE id = %s""",
            (
                (payload.get("name") or "").strip(),
                payload.get("bank"),
                (payload.get("last4") or "").strip() or None,
                payload.get("credit_limit"),
                1 if payload.get("is_credit_card", True) else 0,
                (payload.get("custom_pattern") or "").strip() or None,
                card_id,
            ),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Card not found.")
    return {"updated": True}


@app.delete("/api/cards/{card_id}")
def api_delete_card(card_id: str):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM cards WHERE id = %s", (card_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Card not found.")
    return {"deleted": True}


@app.post("/api/statements/parse")
async def api_parse_statement(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        rows = parse_statement(file.filename or "", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(
            status_code=422,
            detail="Couldn't find any transaction rows in this file. The column layout may not be recognized yet.",
        )
    return {"rows": rows}


@app.post("/api/transactions")
async def api_commit_transactions(payload: dict[str, Any]):
    bank = payload.get("bank") or "Unknown Bank"
    rows = payload.get("rows") or []
    if not rows:
        raise HTTPException(status_code=400, detail="No rows to import.")

    now = datetime.now(timezone.utc).isoformat()
    inserted = 0
    with get_db() as conn:
        for row in rows:
            txn_id = _row_id(bank, row)
            cur = conn.execute(
                """INSERT INTO transactions
                   (id, bank, amount, type, merchant_raw, date, source, category, note, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, 'statement', %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (
                    txn_id,
                    bank,
                    row["amount"],
                    row["type"],
                    row.get("merchant"),
                    row["date"],
                    row.get("category"),
                    row.get("note"),
                    now,
                ),
            )
            inserted += cur.rowcount
    return {"imported": inserted, "skipped_duplicates": len(rows) - inserted}


@app.get("/api/transactions")
def api_list_transactions():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC").fetchall()
    return {"transactions": [dict(r) for r in rows]}


@app.get("/api/transactions/export")
def api_export_transactions(since: str | None = Query(default=None)):
    """Pull-sync endpoint for the mobile app: everything created after `since` (ISO 8601)."""
    with get_db() as conn:
        if since:
            rows = conn.execute(
                "SELECT * FROM transactions WHERE created_at > %s ORDER BY created_at ASC", (since,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM transactions ORDER BY created_at ASC").fetchall()
    return {"transactions": [dict(r) for r in rows]}
