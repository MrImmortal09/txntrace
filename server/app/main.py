import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, Depends, Cookie
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.requests import Request
from starlette.responses import RedirectResponse
import os
import jwt
import httpx
import random

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

JWT_SECRET = os.environ.get("JWT_SECRET", "txntrace_super_secret")
WA_SERVER_URL = os.environ.get("WA_SERVER_URL")
WA_API_KEY = os.environ.get("WA_API_KEY")

security = HTTPBearer(auto_error=False)

def get_current_user(
    token: HTTPAuthorizationCredentials | None = Depends(security),
    txntrace_token: str | None = Cookie(None)
) -> str:
    raw_token = token.credentials if token else txntrace_token
    if not raw_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        payload = jwt.decode(raw_token, JWT_SECRET, algorithms=["HS256"])
        return payload.get("user_id")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_web_user(request: Request) -> str | None:
    token = request.cookies.get("txntrace_token")
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload.get("user_id")
    except:
        return None

OTP_STORE = {}

@app.post("/api/auth/request-otp")
async def request_otp(payload: dict):
    phone = payload.get("phone")
    if not phone or len(str(phone)) != 10:
        raise HTTPException(status_code=400, detail="Invalid Indian phone number")
    
    otp = str(random.randint(100000, 999999))
    OTP_STORE[phone] = otp
    
    if not WA_SERVER_URL or not WA_API_KEY:
        print(f"Mock OTP for {phone}: {otp}")
        return {"success": True, "mock": True}
        
    chat_id = f"91{phone}@s.whatsapp.net"
    text = f"Your OTP is: *{otp}*\\nValid for 10 minutes. Do not share with anyone."
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{WA_SERVER_URL}/api/sendText",
                headers={"Content-Type": "application/json", "key": WA_API_KEY},
                json={"chatId": chat_id, "text": text}
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=500, detail=f"WhatsApp server returned {resp.status_code}: {resp.text}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to connect to WhatsApp server: {str(exc)}")
    return {"success": True}

@app.post("/api/auth/verify-otp")
async def verify_otp(payload: dict):
    phone = payload.get("phone")
    otp = payload.get("otp")
    if str(OTP_STORE.get(phone)) != str(otp):
        raise HTTPException(status_code=401, detail="Invalid OTP")
        
    del OTP_STORE[phone]
    
    with get_db() as conn:
        conn.execute("INSERT INTO users (id, phone, created_at) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING", 
                    (f"user_{phone}", phone, datetime.now(timezone.utc).isoformat()))
        conn.execute("INSERT INTO users (id, phone, created_at) VALUES (%s, %s, %s) ON CONFLICT (phone) DO UPDATE SET phone=EXCLUDED.phone", 
                    (f"user_{phone}", phone, datetime.now(timezone.utc).isoformat()))
                    
    token = jwt.encode({"user_id": f"user_{phone}"}, JWT_SECRET, algorithm="HS256")
    return {"token": token}

@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html")


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
    user_id = get_web_user(request)
    if not user_id: return RedirectResponse("/login")
    return templates.TemplateResponse(request, "index.html")


@app.get("/transactions", response_class=HTMLResponse)
def transactions_page(request: Request):
    user_id = get_web_user(request)
    if not user_id: return RedirectResponse("/login")
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions WHERE user_id = %s ORDER BY date DESC", (user_id,)).fetchall()
        contacts = conn.execute("SELECT * FROM contacts WHERE user_id = %s ORDER BY name ASC", (user_id,)).fetchall()
        split_rows = conn.execute("SELECT * FROM splits WHERE user_id = %s", (user_id,)).fetchall()
        # Same "most recently used contact" ranking as the phone's split
        # modal (app/src/components/SplitModal.tsx) — computed the same way,
        # off actual past splits, so the picker feels consistent either side.
        recency_rows = conn.execute(
            """SELECT s.contact_id as contact_id, MAX(t.date) as last_used
               FROM splits s JOIN transactions t ON t.id = s.transaction_id
               WHERE s.user_id = %s
               GROUP BY s.contact_id""", (user_id,)
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
    user_id = get_web_user(request)
    if not user_id: return RedirectResponse("/login")
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cards WHERE user_id = %s ORDER BY created_at DESC", (user_id,)).fetchall()
    return templates.TemplateResponse(
        request, "cards.html", {"cards": [dict(r) for r in rows], "banks": BANKS, "fallback_bank": FALLBACK}
    )


@app.get("/api/cards")
def api_list_cards(user_id: str = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cards WHERE user_id = %s ORDER BY created_at DESC", (user_id,)).fetchall()
    return {"cards": [dict(r) for r in rows]}


@app.get("/api/cards/export")
def api_export_cards(user_id: str = Depends(get_current_user)):
    """Pull-sync endpoint for the mobile app — the phone matches SMS against
    this locally, so it needs the full current set every time, not a delta
    (the registry is small and edits should take effect immediately rather
    than waiting on whatever "since" cursor the phone last saved)."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cards WHERE user_id = %s ORDER BY created_at DESC", (user_id,)).fetchall()
    return {"cards": [dict(r) for r in rows]}


@app.post("/api/cards")
async def api_create_card(payload: dict[str, Any], user_id: str = Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Card name is required.")
    card_id = f"card_{uuid.uuid4().hex[:16]}"
    with get_db() as conn:
        conn.execute(
            """INSERT INTO cards (id, name, bank, last4, credit_limit, is_credit_card, custom_pattern, created_at, user_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                card_id,
                name,
                payload.get("bank"),
                (payload.get("last4") or "").strip() or None,
                payload.get("credit_limit"),
                1 if payload.get("is_credit_card", True) else 0,
                (payload.get("custom_pattern") or "").strip() or None,
                datetime.now(timezone.utc).isoformat(),
                user_id,
            ),
        )
    return {"id": card_id}


@app.put("/api/cards/{card_id}")
async def api_update_card(card_id: str, payload: dict[str, Any], user_id: str = Depends(get_current_user)):
    with get_db() as conn:
        cur = conn.execute(
            """UPDATE cards SET name = %s, bank = %s, last4 = %s, credit_limit = %s,
               is_credit_card = %s, custom_pattern = %s WHERE id = %s AND user_id = %s""",
            (
                (payload.get("name") or "").strip(),
                payload.get("bank"),
                (payload.get("last4") or "").strip() or None,
                payload.get("credit_limit"),
                1 if payload.get("is_credit_card", True) else 0,
                (payload.get("custom_pattern") or "").strip() or None,
                card_id,
                user_id,
            ),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Card not found.")
    return {"updated": True}


@app.delete("/api/cards/{card_id}")
def api_delete_card(card_id: str, user_id: str = Depends(get_current_user)):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM cards WHERE id = %s AND user_id = %s", (card_id, user_id))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Card not found.")
    return {"deleted": True}


@app.post("/api/contacts/sync")
async def api_sync_contacts(payload: dict[str, Any], user_id: str = Depends(get_current_user)):
    """Full-replace push from the phone — the only side with real device-
    contact access, mirroring how /api/cards/export is a full replace in the
    other direction. The web side never originates or edits a contact, so
    there's nothing to reconcile: whatever the phone last pushed just is
    the current list."""
    contacts = payload.get("contacts") or []
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute("DELETE FROM contacts WHERE user_id = %s", (user_id,))
        for c in contacts:
            contact_id = c.get("id")
            name = (c.get("name") or "").strip()
            if not contact_id or not name:
                continue
            conn.execute(
                "INSERT INTO contacts (id, name, created_at, user_id) VALUES (%s, %s, %s, %s)",
                (contact_id, name, now, user_id),
            )
    return {"count": len(contacts)}


@app.get("/api/contacts")
def api_list_contacts(user_id: str = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM contacts WHERE user_id = %s ORDER BY name ASC", (user_id,)).fetchall()
    return {"contacts": [dict(r) for r in rows]}


@app.post("/api/transactions/{txn_id}/splits")
async def api_create_splits(txn_id: str, payload: dict[str, Any], user_id: str = Depends(get_current_user)):
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
        txn = conn.execute(
            "SELECT id, date, merchant_raw, amount FROM transactions WHERE id = %s AND user_id = %s", (txn_id, user_id)
        ).fetchone()
        if not txn:
            raise HTTPException(status_code=404, detail="Transaction not found.")
        already = conn.execute(
            "SELECT id FROM splits WHERE transaction_id = %s AND user_id = %s LIMIT 1", (txn_id, user_id)
        ).fetchone()
        if already:
            raise HTTPException(status_code=409, detail="This transaction is already split.")
        created = []
        for entry in entries:
            split_id = f"split_{uuid.uuid4().hex[:20]}"
            conn.execute(
                """INSERT INTO splits
                   (id, transaction_id, contact_id, contact_name, amount_owed, settled, created_at,
                    txn_date, txn_merchant, txn_amount, user_id)
                   VALUES (%s, %s, %s, %s, %s, 0, %s, %s, %s, %s, %s)""",
                (
                    split_id,
                    txn_id,
                    entry.get("contact_id"),
                    entry.get("contact_name"),
                    entry.get("amount_owed"),
                    now,
                    txn["date"],
                    txn["merchant_raw"],
                    txn["amount"],
                    user_id,
                ),
            )
            created.append(split_id)
        conn.execute(
            "UPDATE transactions SET reviewed = 1, updated_at = %s WHERE id = %s AND user_id = %s", (now, txn_id, user_id)
        )
    return {"created": created}


@app.get("/api/splits/export")
def api_export_splits(since: str | None = Query(default=None), user_id: str = Depends(get_current_user)):
    """Pull-sync endpoint for the mobile app: splits created on the web,
    keyed by created_at exactly like /api/transactions/export."""
    with get_db() as conn:
        if since:
            rows = conn.execute(
                "SELECT * FROM splits WHERE user_id = %s AND created_at > %s ORDER BY created_at ASC", (user_id, since)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM splits WHERE user_id = %s ORDER BY created_at ASC", (user_id,)).fetchall()
    return {"splits": [dict(r) for r in rows]}


@app.post("/api/splits/sync")
async def api_sync_splits_from_phone(payload: dict[str, Any], user_id: str = Depends(get_current_user)):
    """Push from the phone — the reverse direction of /api/splits/export.
    Splits can be authored on *either* side now (web via the endpoint
    above, phone via SMS-matching or a manual expense), so unlike contacts
    (phone-only authored, full replace) this merges by id — an upsert, not
    a replace, so it never touches web-authored rows the phone doesn't
    know about. Re-pushing an id that already exists (its amount_owed
    dropped from a partial payment, or it got fully settled) correctly
    updates it rather than erroring."""
    splits = payload.get("splits") or []
    with get_db() as conn:
        for s in splits:
            conn.execute(
                """INSERT INTO splits
                   (id, transaction_id, contact_id, contact_name, amount_owed, settled, created_at,
                    txn_date, txn_merchant, txn_amount, user_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET
                     amount_owed = EXCLUDED.amount_owed,
                     settled = EXCLUDED.settled""",
                (
                    s.get("id"),
                    s.get("transaction_id"),
                    s.get("contact_id"),
                    s.get("contact_name"),
                    s.get("amount_owed"),
                    s.get("settled") or 0,
                    s.get("created_at") or datetime.now(timezone.utc).isoformat(),
                    s.get("txn_date"),
                    s.get("txn_merchant"),
                    s.get("txn_amount"),
                    user_id,
                ),
            )
    return {"count": len(splits)}


@app.post("/api/settlements/sync")
async def api_sync_settlements_from_phone(payload: dict[str, Any], user_id: str = Depends(get_current_user)):
    """Push from the phone for the friend payment-history the web's Friends
    page shows alongside splits. A settlement is immutable once recorded —
    a payment either happened or it didn't — so ON CONFLICT DO NOTHING is
    enough; there's no field on it that a later push would ever need to
    revise."""
    entries = payload.get("settlements") or []
    with get_db() as conn:
        for s in entries:
            conn.execute(
                """INSERT INTO settlements
                   (id, contact_id, contact_name, amount, transaction_id, matched_split_id, date, created_at, user_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (
                    s.get("id"),
                    s.get("contact_id"),
                    s.get("contact_name"),
                    s.get("amount"),
                    s.get("transaction_id"),
                    s.get("matched_split_id"),
                    s.get("date"),
                    s.get("created_at"),
                    user_id,
                ),
            )
    return {"count": len(entries)}


@app.get("/friends", response_class=HTMLResponse)
def friends_page(request: Request):
    user_id = get_web_user(request)
    if not user_id: return RedirectResponse("/login")
    with get_db() as conn:
        # Mirrors the mobile app's own FriendsScreen query: a friend's
        # identity comes from contact_name denormalized on splits/
        # settlements, not a join to `contacts` — a phone-authored split
        # references a real contact, but the corresponding row in the
        # phone-only-authored `contacts` mirror may not (yet) reflect it.
        rows = conn.execute(
            """SELECT contact_id, MAX(contact_name) as contact_name,
                 COALESCE(SUM(amount_owed) FILTER (WHERE settled = 0), 0) as owed
               FROM splits
               WHERE user_id = %s
               GROUP BY contact_id
               ORDER BY owed DESC, contact_name ASC""", (user_id,)
        ).fetchall()
    return templates.TemplateResponse(request, "friends.html", {"friends": [dict(r) for r in rows]})


@app.get("/friends/{contact_id}", response_class=HTMLResponse)
def friend_detail_page(request: Request, contact_id: str):
    user_id = get_web_user(request)
    if not user_id: return RedirectResponse("/login")
    with get_db() as conn:
        splits = conn.execute("SELECT * FROM splits WHERE contact_id = %s AND user_id = %s", (contact_id, user_id)).fetchall()
        settlements = conn.execute(
            "SELECT * FROM settlements WHERE contact_id = %s AND user_id = %s", (contact_id, user_id)
        ).fetchall()

    contact_name = next(
        (s["contact_name"] for s in list(splits) + list(settlements) if s["contact_name"]), "Friend"
    )
    owed = sum(s["amount_owed"] or 0 for s in splits if not s["settled"])

    # Combined into one date-sorted ledger here rather than in the template,
    # matching the mobile app's own FriendDetailScreen — a split shows
    # txn_amount (the stable original expense, untouched by settlement)
    # rather than amount_owed (a live running balance that reaches 0 once
    # paid off), so a fully-settled expense doesn't render as "₹0.00".
    entries = [
        {
            "kind": "split",
            "date": s["txn_date"],
            "amount": s["txn_amount"],
            "merchant": s["txn_merchant"],
            "settled": bool(s["settled"]),
        }
        for s in splits
    ] + [
        {
            "kind": "settlement",
            "date": s["date"],
            "amount": s["amount"],
            "merchant": None,
            "settled": True,
        }
        for s in settlements
    ]
    entries.sort(key=lambda e: e["date"] or "", reverse=True)

    return templates.TemplateResponse(
        request,
        "friend_detail.html",
        {"contact_id": contact_id, "contact_name": contact_name, "owed": owed, "entries": entries},
    )


@app.post("/api/statements/parse")
async def api_parse_statement(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
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
async def api_commit_transactions(payload: dict[str, Any], user_id: str = Depends(get_current_user)):
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
                   (id, bank, amount, type, merchant_raw, date, source, category, note, created_at, updated_at, user_id)
                   VALUES (%s, %s, %s, %s, %s, %s, 'statement', %s, %s, %s, %s, %s)
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
                    user_id,
                ),
            )
            inserted += cur.rowcount
    return {"imported": inserted, "skipped_duplicates": len(rows) - inserted}


@app.put("/api/transactions/{txn_id}")
async def api_update_transaction_note(txn_id: str, payload: dict[str, Any], user_id: str = Depends(get_current_user)):
    """Edits a transaction's note from the web. updated_at (not created_at,
    which never changes) is what /api/transactions/export keys its delta
    sync on, so this is what makes the edit actually reach the phone on its
    next sync rather than being silently skipped as "nothing new"."""
    note = payload.get("note")
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE transactions SET note = %s, updated_at = %s WHERE id = %s AND user_id = %s",
            (note, now, txn_id, user_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return {"updated": True, "updated_at": now}


@app.get("/api/transactions")
def api_list_transactions(user_id: str = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions WHERE user_id = %s ORDER BY date DESC", (user_id,)).fetchall()
    return {"transactions": [dict(r) for r in rows]}


@app.get("/api/transactions/export")
def api_export_transactions(since: str | None = Query(default=None), user_id: str = Depends(get_current_user)):
    """Pull-sync endpoint for the mobile app: everything *changed* (created
    or edited — e.g. a note added on the web) after `since` (ISO 8601).
    Keyed on updated_at rather than created_at, or an edit to a row the
    phone already has would never be picked up, since its created_at never
    changes."""
    with get_db() as conn:
        if since:
            rows = conn.execute(
                "SELECT * FROM transactions WHERE user_id = %s AND updated_at > %s ORDER BY updated_at ASC", (user_id, since)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM transactions WHERE user_id = %s ORDER BY updated_at ASC", (user_id,)).fetchall()
    return {"transactions": [dict(r) for r in rows]}


@app.post("/api/admin/clear-db")
async def api_clear_db(payload: dict[str, Any], user_id: str = Depends(get_current_user)):
    """Wipes every table for the user — transactions, cards, contacts, splits.
    The confirm phrase acts as a guard against firing this by accident."""
    if payload.get("confirm") != "CLEAR":
        raise HTTPException(status_code=400, detail='Send {"confirm": "CLEAR"} to proceed.')
    with get_db() as conn:
        conn.execute("DELETE FROM splits WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM contacts WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM cards WHERE user_id = %s", (user_id,))
        conn.execute("DELETE FROM transactions WHERE user_id = %s", (user_id,))
    return {"cleared": True}
