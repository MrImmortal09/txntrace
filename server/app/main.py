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
        contacts = conn.execute("SELECT * FROM contacts ORDER BY name ASC").fetchall()
        split_rows = conn.execute("SELECT * FROM splits").fetchall()
        # Same "most recently used contact" ranking as the phone's split
        # modal (app/src/components/SplitModal.tsx) — computed the same way,
        # off actual past splits, so the picker feels consistent either side.
        recency_rows = conn.execute(
            """SELECT s.contact_id as contact_id, MAX(t.date) as last_used
               FROM splits s JOIN transactions t ON t.id = s.transaction_id
               GROUP BY s.contact_id"""
        ).fetchall()

    splits_by_txn: dict[str, list[dict]] = {}
    for s in split_rows:
        splits_by_txn.setdefault(s["transaction_id"], []).append(dict(s))

    transactions = []
    for r in rows:
        t = dict(r)
        style = bank_style_for(t.get("bank"))
        t["bank_color"] = style["color"]
        t["bank_logo"] = style["logo"]
        t["splits"] = splits_by_txn.get(t["id"], [])
        transactions.append(t)

    recency = {row["contact_id"]: row["last_used"] for row in recency_rows}

    return templates.TemplateResponse(
        request,
        "transactions.html",
        {"transactions": transactions, "contacts": [dict(c) for c in contacts], "recency": recency},
    )


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


@app.post("/api/contacts/sync")
async def api_sync_contacts(payload: dict[str, Any]):
    """Full-replace push from the phone — the only side with real device-
    contact access, mirroring how /api/cards/export is a full replace in the
    other direction. The web side never originates or edits a contact, so
    there's nothing to reconcile: whatever the phone last pushed just is
    the current list."""
    contacts = payload.get("contacts") or []
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute("DELETE FROM contacts")
        for c in contacts:
            contact_id = c.get("id")
            name = (c.get("name") or "").strip()
            if not contact_id or not name:
                continue
            conn.execute(
                "INSERT INTO contacts (id, name, created_at) VALUES (%s, %s, %s)",
                (contact_id, name, now),
            )
    return {"count": len(contacts)}


@app.get("/api/contacts")
def api_list_contacts():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM contacts ORDER BY name ASC").fetchall()
    return {"contacts": [dict(r) for r in rows]}


@app.post("/api/transactions/{txn_id}/splits")
async def api_create_splits(txn_id: str, payload: dict[str, Any]):
    """Create-once, like the phone's own split modal: a transaction is
    split a single time, not repeatedly edited, so there's no update path
    to keep in sync — only a 409 if it's already split. Also marks the
    transaction reviewed, exactly like the phone's own split modal does in
    the same action — otherwise a transaction split from the web never
    leaves the phone's Daily (pending review) list."""
    entries = payload.get("splits") or []
    if not entries:
        raise HTTPException(status_code=400, detail="No splits provided.")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        txn = conn.execute("SELECT id FROM transactions WHERE id = %s", (txn_id,)).fetchone()
        if not txn:
            raise HTTPException(status_code=404, detail="Transaction not found.")
        already = conn.execute(
            "SELECT id FROM splits WHERE transaction_id = %s LIMIT 1", (txn_id,)
        ).fetchone()
        if already:
            raise HTTPException(status_code=409, detail="This transaction is already split.")
        created = []
        for entry in entries:
            split_id = f"split_{uuid.uuid4().hex[:20]}"
            conn.execute(
                """INSERT INTO splits (id, transaction_id, contact_id, contact_name, amount_owed, settled, created_at)
                   VALUES (%s, %s, %s, %s, %s, 0, %s)""",
                (split_id, txn_id, entry.get("contact_id"), entry.get("contact_name"), entry.get("amount_owed"), now),
            )
            created.append(split_id)
        conn.execute(
            "UPDATE transactions SET reviewed = 1, updated_at = %s WHERE id = %s", (now, txn_id)
        )
    return {"created": created}


@app.get("/api/splits/export")
def api_export_splits(since: str | None = Query(default=None)):
    """Pull-sync endpoint for the mobile app: splits created on the web,
    keyed by created_at exactly like /api/transactions/export."""
    with get_db() as conn:
        if since:
            rows = conn.execute(
                "SELECT * FROM splits WHERE created_at > %s ORDER BY created_at ASC", (since,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM splits ORDER BY created_at ASC").fetchall()
    return {"splits": [dict(r) for r in rows]}


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
                   (id, bank, amount, type, merchant_raw, date, source, category, note, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, 'statement', %s, %s, %s, %s)
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
                    now,
                ),
            )
            inserted += cur.rowcount
    return {"imported": inserted, "skipped_duplicates": len(rows) - inserted}


@app.put("/api/transactions/{txn_id}")
async def api_update_transaction_note(txn_id: str, payload: dict[str, Any]):
    """Edits a transaction's note from the web. updated_at (not created_at,
    which never changes) is what /api/transactions/export keys its delta
    sync on, so this is what makes the edit actually reach the phone on its
    next sync rather than being silently skipped as "nothing new"."""
    note = payload.get("note")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE transactions SET note = %s, updated_at = %s WHERE id = %s",
            (note, now, txn_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return {"updated": True, "updated_at": now}


@app.get("/api/transactions")
def api_list_transactions():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions ORDER BY date DESC").fetchall()
    return {"transactions": [dict(r) for r in rows]}


@app.get("/api/transactions/export")
def api_export_transactions(since: str | None = Query(default=None)):
    """Pull-sync endpoint for the mobile app: everything *changed* (created
    or edited — e.g. a note added on the web) after `since` (ISO 8601).
    Keyed on updated_at rather than created_at, or an edit to a row the
    phone already has would never be picked up, since its created_at never
    changes."""
    with get_db() as conn:
        if since:
            rows = conn.execute(
                "SELECT * FROM transactions WHERE updated_at > %s ORDER BY updated_at ASC", (since,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM transactions ORDER BY updated_at ASC").fetchall()
    return {"transactions": [dict(r) for r in rows]}


@app.post("/api/admin/clear-db")
async def api_clear_db(payload: dict[str, Any]):
    """Wipes every table — transactions, cards, contacts, splits. There's no
    auth on this server at all, so the confirm phrase isn't a security
    boundary, just a guard against firing this by accident (a stray retry,
    a misclick) given it's irreversible and there's no undo."""
    if payload.get("confirm") != "CLEAR":
        raise HTTPException(status_code=400, detail='Send {"confirm": "CLEAR"} to proceed.')
    with get_db() as conn:
        conn.execute("DELETE FROM splits")
        conn.execute("DELETE FROM contacts")
        conn.execute("DELETE FROM cards")
        conn.execute("DELETE FROM transactions")
    return {"cleared": True}
