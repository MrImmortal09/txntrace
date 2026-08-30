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

# The phone is the only side with real device-contact access, so contacts
# are authored there and pushed up (the reverse of cards, which are
# web-authored and pulled down) — the web side never edits a contact, it's
# a read-only mirror used to populate its own split picker. Deliberately no
# phone-number column: nothing here needs it, and it's PII this app doesn't
# otherwise send off-device.
CONTACTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT
);
"""

# Mirrors the mobile app's `splits` table (app/src/db/schema.ts) column for
# column, plus one addition: created_at, needed only so the phone can pull
# down what's new since its last sync instead of the whole table — the
# phone's own INSERT names its columns explicitly, so the extra field is
# simply ignored on that side.
SPLITS_SCHEMA = """
CREATE TABLE IF NOT EXISTS splits (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    contact_id TEXT,
    contact_name TEXT,
    amount_owed REAL,
    settled INTEGER DEFAULT 0,
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
        conn.execute(CONTACTS_SCHEMA)
        conn.execute(SPLITS_SCHEMA)
        # Added after the initial table, so existing deployments need an
        # explicit migration rather than picking it up from CREATE TABLE IF
        # NOT EXISTS (a no-op once the table already exists). Lets an edit
        # made on the web (e.g. a note) be told apart from a row's original
        # import time, which is what makes last-write-wins sync possible —
        # see /api/transactions/export and the mobile app's syncFromServer.
        conn.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TEXT")
        conn.execute("UPDATE transactions SET updated_at = created_at WHERE updated_at IS NULL")
