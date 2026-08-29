import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DB")

# Mirrors the mobile app's `transactions` table (app/src/db/schema.ts) column
# for column, so a row from either side maps onto the other with no renaming —
# that's what makes phone <-> server sync a straight copy instead of a translation.
SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    bank TEXT,
    amount REAL,
    type TEXT,
    merchant_raw TEXT,
    date TEXT,
    source TEXT,
    category TEXT,
    note TEXT,
    reviewed INTEGER DEFAULT 0,
    created_at TEXT,
    reference TEXT,
    account_last4 TEXT,
    balance REAL,
    sender TEXT,
    sms_body TEXT,
    card_id TEXT
);
"""

# A user-named card or account (e.g. "HDFC Regalia") with a limit and a
# matching rule. last4 is the common case ("debited xx4230" -> card 4230);
# custom_pattern is an optional raw regex for when last4 alone is ambiguous
# (two cards sharing the same last 4 digits, or a bank whose SMS format needs
# something more specific to identify).
CARDS_SCHEMA = """
CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    name TEXT,
    bank TEXT,
    last4 TEXT,
    credit_limit REAL,
    is_credit_card INTEGER DEFAULT 1,
    custom_pattern TEXT,
    created_at TEXT
);
"""


@contextmanager
def get_db():
    if not DATABASE_URL:
        raise RuntimeError(
            "DB is not set. Put your Neon connection string in server/.env as DB=... "
            "or export it before running uvicorn."
        )
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.execute(SCHEMA)
        conn.execute(CARDS_SCHEMA)
