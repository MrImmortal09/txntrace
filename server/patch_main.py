import os
import re

file_path = "/Users/oms/Coding/opensource/txntrace/server/app/main.py"
with open(file_path, "r") as f:
    content = f.read()

# 1. Add new imports
new_imports = """
import os
import jwt
import httpx
from fastapi import Depends, Cookie, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.responses import RedirectResponse, JSONResponse
import random

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

# Simple in-memory OTP store for now (in production, use Redis or DB)
OTP_STORE = {}

@app.post("/api/auth/request-otp")
async def request_otp(payload: dict):
    phone = payload.get("phone")
    if not phone or len(str(phone)) != 10:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    
    otp = str(random.randint(100000, 999999))
    OTP_STORE[phone] = otp
    
    if not WA_SERVER_URL or not WA_API_KEY:
        print(f"Mock OTP for {phone}: {otp}")
        return {"success": True, "mock": True}
        
    chat_id = f"91{phone}@s.whatsapp.net"
    text = f"Your OTP is: *{otp}*\\nValid for 10 minutes. Do not share with anyone."
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{WA_SERVER_URL}/api/sendText",
            headers={"Content-Type": "application/json", "key": WA_API_KEY},
            json={"chatId": chat_id, "text": text}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"WhatsApp server error")
            
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
"""

content = content.replace('from typing import Any', new_imports + '\nfrom typing import Any', 1)


# 2. Update all queries
replacements = {
    'def transactions_page(request: Request):': 'def transactions_page(request: Request):\n    user_id = get_web_user(request)\n    if not user_id: return RedirectResponse("/login")',
    'def index(request: Request):': 'def index(request: Request):\n    user_id = get_web_user(request)\n    if not user_id: return RedirectResponse("/login")',
    'def cards_page(request: Request):': 'def cards_page(request: Request):\n    user_id = get_web_user(request)\n    if not user_id: return RedirectResponse("/login")',
    'def friends_page(request: Request):': 'def friends_page(request: Request):\n    user_id = get_web_user(request)\n    if not user_id: return RedirectResponse("/login")',
    'def friend_detail_page(request: Request, contact_id: str):': 'def friend_detail_page(request: Request, contact_id: str):\n    user_id = get_web_user(request)\n    if not user_id: return RedirectResponse("/login")',
    
    # API definitions to add user_id: str = Depends(get_current_user)
    'def api_list_cards():': 'def api_list_cards(user_id: str = Depends(get_current_user)):',
    'def api_export_cards():': 'def api_export_cards(user_id: str = Depends(get_current_user)):',
    'async def api_create_card(payload: dict[str, Any]):': 'async def api_create_card(payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'async def api_update_card(card_id: str, payload: dict[str, Any]):': 'async def api_update_card(card_id: str, payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'def api_delete_card(card_id: str):': 'def api_delete_card(card_id: str, user_id: str = Depends(get_current_user)):',
    'async def api_sync_contacts(payload: dict[str, Any]):': 'async def api_sync_contacts(payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'def api_list_contacts():': 'def api_list_contacts(user_id: str = Depends(get_current_user)):',
    'async def api_create_splits(txn_id: str, payload: dict[str, Any]):': 'async def api_create_splits(txn_id: str, payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'def api_export_splits(since: str | None = Query(default=None)):': 'def api_export_splits(since: str | None = Query(default=None), user_id: str = Depends(get_current_user)):',
    'async def api_sync_splits_from_phone(payload: dict[str, Any]):': 'async def api_sync_splits_from_phone(payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'async def api_sync_settlements_from_phone(payload: dict[str, Any]):': 'async def api_sync_settlements_from_phone(payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'async def api_commit_transactions(payload: dict[str, Any]):': 'async def api_commit_transactions(payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'async def api_update_transaction_note(txn_id: str, payload: dict[str, Any]):': 'async def api_update_transaction_note(txn_id: str, payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'def api_list_transactions():': 'def api_list_transactions(user_id: str = Depends(get_current_user)):',
    'def api_export_transactions(since: str | None = Query(default=None)):': 'def api_export_transactions(since: str | None = Query(default=None), user_id: str = Depends(get_current_user)):',
    'async def api_clear_db(payload: dict[str, Any]):': 'async def api_clear_db(payload: dict[str, Any], user_id: str = Depends(get_current_user)):',
    'async def api_parse_statement(file: UploadFile = File(...)):': 'async def api_parse_statement(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):',
    
    # DB Queries SQL updates
    '"SELECT * FROM transactions ORDER BY date DESC"': '"SELECT * FROM transactions WHERE user_id = %s ORDER BY date DESC", (user_id,)',
    '"SELECT * FROM contacts ORDER BY name ASC"': '"SELECT * FROM contacts WHERE user_id = %s ORDER BY name ASC", (user_id,)',
    '"SELECT * FROM splits"': '"SELECT * FROM splits WHERE user_id = %s", (user_id,)',
    '"""SELECT s.contact_id as contact_id, MAX(t.date) as last_used': '"""SELECT s.contact_id as contact_id, MAX(t.date) as last_used\\n               FROM splits s JOIN transactions t ON t.id = s.transaction_id\\n               WHERE s.user_id = %s\\n               GROUP BY s.contact_id""", (user_id,)',
    '"SELECT * FROM cards ORDER BY created_at DESC"': '"SELECT * FROM cards WHERE user_id = %s ORDER BY created_at DESC", (user_id,)',
    '"""INSERT INTO cards (id, name, bank, last4, credit_limit, is_credit_card, custom_pattern, created_at)': '"""INSERT INTO cards (id, name, bank, last4, credit_limit, is_credit_card, custom_pattern, created_at, user_id)',
    'datetime.now(timezone.utc).isoformat(),': 'datetime.now(timezone.utc).isoformat(),\n                user_id,',
    'is_credit_card = %s, custom_pattern = %s WHERE id = %s"': 'is_credit_card = %s, custom_pattern = %s WHERE id = %s AND user_id = %s"',
    'card_id,': 'card_id,\n                user_id,',
    '"DELETE FROM cards WHERE id = %s", (card_id,)': '"DELETE FROM cards WHERE id = %s AND user_id = %s", (card_id, user_id)',
    '"DELETE FROM contacts"': '"DELETE FROM contacts WHERE user_id = %s", (user_id,)',
    '"INSERT INTO contacts (id, name, created_at) VALUES (%s, %s, %s)",': '"INSERT INTO contacts (id, name, created_at, user_id) VALUES (%s, %s, %s, %s)",',
    '(contact_id, name, now),': '(contact_id, name, now, user_id),',
    '"SELECT id, date, merchant_raw, amount FROM transactions WHERE id = %s", (txn_id,)': '"SELECT id, date, merchant_raw, amount FROM transactions WHERE id = %s AND user_id = %s", (txn_id, user_id)',
    '"SELECT id FROM splits WHERE transaction_id = %s LIMIT 1", (txn_id,)': '"SELECT id FROM splits WHERE transaction_id = %s AND user_id = %s LIMIT 1", (txn_id, user_id)',
    'txn_date, txn_merchant, txn_amount)': 'txn_date, txn_merchant, txn_amount, user_id)',
    'txn["merchant_raw"],\n                    txn["amount"],': 'txn["merchant_raw"],\n                    txn["amount"],\n                    user_id,',
    'UPDATE transactions SET reviewed = 1, updated_at = %s WHERE id = %s", (now, txn_id)': 'UPDATE transactions SET reviewed = 1, updated_at = %s WHERE id = %s AND user_id = %s", (now, txn_id, user_id)',
    '"SELECT * FROM splits WHERE created_at > %s ORDER BY created_at ASC", (since,)': '"SELECT * FROM splits WHERE user_id = %s AND created_at > %s ORDER BY created_at ASC", (user_id, since)',
    '"SELECT * FROM splits ORDER BY created_at ASC"': '"SELECT * FROM splits WHERE user_id = %s ORDER BY created_at ASC", (user_id,)',
    's.get("txn_merchant"),\n                    s.get("txn_amount"),': 's.get("txn_merchant"),\n                    s.get("txn_amount"),\n                    user_id,',
    's.get("date"),\n                    s.get("created_at"),': 's.get("date"),\n                    s.get("created_at"),\n                    user_id,',
    'WHERE settled = 0), 0) as owed\\n               FROM splits\\n               GROUP BY contact_id': 'WHERE settled = 0), 0) as owed\\n               FROM splits\\n               WHERE user_id = %s\\n               GROUP BY contact_id""", (user_id,)',
    '"SELECT * FROM splits WHERE contact_id = %s", (contact_id,)': '"SELECT * FROM splits WHERE contact_id = %s AND user_id = %s", (contact_id, user_id)',
    '"SELECT * FROM settlements WHERE contact_id = %s", (contact_id,)': '"SELECT * FROM settlements WHERE contact_id = %s AND user_id = %s", (contact_id, user_id)',
    'note, created_at, updated_at)': 'note, created_at, updated_at, user_id)',
    'now,\n                    now,': 'now,\n                    now,\n                    user_id,',
    '"UPDATE transactions SET note = %s, updated_at = %s WHERE id = %s",\n            (note, now, txn_id),': '"UPDATE transactions SET note = %s, updated_at = %s WHERE id = %s AND user_id = %s",\n            (note, now, txn_id, user_id),',
    '"SELECT * FROM transactions WHERE updated_at > %s ORDER BY updated_at ASC", (since,)': '"SELECT * FROM transactions WHERE user_id = %s AND updated_at > %s ORDER BY updated_at ASC", (user_id, since)',
    '"SELECT * FROM transactions ORDER BY updated_at ASC"': '"SELECT * FROM transactions WHERE user_id = %s ORDER BY updated_at ASC", (user_id,)',
    '"DELETE FROM splits"': '"DELETE FROM splits WHERE user_id = %s", (user_id,)',
    '"DELETE FROM cards"': '"DELETE FROM cards WHERE user_id = %s", (user_id,)',
    '"DELETE FROM transactions"': '"DELETE FROM transactions WHERE user_id = %s", (user_id,)',
    'date, created_at)': 'date, created_at, user_id)'
}

for old, new in replacements.items():
    content = content.replace(old, new)

# Fix specifically the multi-line GROUP BY replacement that might have missed
if 'GROUP BY contact_id""", (user_id,)' not in content:
    content = content.replace('GROUP BY contact_id', 'WHERE user_id = %s\\n               GROUP BY contact_id""", (user_id,)')
    # Fix the missing parenthesis in the query
    content = content.replace(').fetchall()', '.fetchall()')
    content = content.replace('"""SELECT s.contact_id as contact_id, MAX(t.date) as last_used\n               FROM splits s JOIN transactions t ON t.id = s.transaction_id\n               WHERE user_id = %s\n               GROUP BY contact_id""", (user_id,)\n        ).fetchall()', '"""SELECT s.contact_id as contact_id, MAX(t.date) as last_used\n               FROM splits s JOIN transactions t ON t.id = s.transaction_id\n               WHERE s.user_id = %s\n               GROUP BY s.contact_id""", (user_id,)\n        .fetchall()')

with open(file_path, "w") as f:
    f.write(content)
print("Updated main.py")
