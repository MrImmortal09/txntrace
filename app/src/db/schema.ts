import { open } from '@op-engineering/op-sqlite';

export const db = open({
  name: 'txntrace.sqlite',
});

export const setupDatabase = async () => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      bank TEXT,
      amount REAL,
      type TEXT, -- 'debit' | 'credit'
      merchant_raw TEXT,
      date TEXT,
      source TEXT, -- 'sms' | 'statement' | 'manual'
      category TEXT,
      note TEXT,
      reviewed INTEGER DEFAULT 0, -- boolean
      created_at TEXT,
      reference TEXT,
      account_last4 TEXT,
      balance REAL,
      sender TEXT,
      sms_body TEXT,
      needs_contact_match INTEGER DEFAULT 0, -- boolean: a credit with an unmapped payer name
      card_id TEXT
    );
  `);

  // CREATE TABLE IF NOT EXISTS is a no-op on a device that already has this
  // table from before this column existed, so it needs an explicit
  // migration — wrapped in try/catch since SQLite has no ADD COLUMN IF NOT
  // EXISTS and this needs to stay a harmless no-op on every later launch.
  // Lets a note added on the web (updated_at newer than what the phone has)
  // be told apart from one only ever set at import time — see webSync.ts.
  try {
    await db.execute(`ALTER TABLE transactions ADD COLUMN updated_at TEXT;`);
  } catch (error) {
    // Already migrated.
  }

  // Mirrors the server's `cards` table (server/app/db.py) — the phone matches
  // SMS against this locally so ingestion stays network-free, but the rows
  // themselves are configured on the web app and pulled down via /api/cards/export.
  await db.execute(`
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
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sms_log (
      id TEXT PRIMARY KEY,
      sender TEXT,
      body TEXT,
      received_at TEXT,
      source TEXT, -- 'shortcut' | 'filter' | 'unknown'
      status TEXT, -- 'parsed' | 'unparsed'
      bank TEXT,
      amount REAL,
      type TEXT,
      merchant TEXT,
      reference TEXT,
      logged_at TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS splits (
      id TEXT PRIMARY KEY,
      transaction_id TEXT,
      contact_id TEXT,
      contact_name TEXT,
      amount_owed REAL,
      settled INTEGER DEFAULT 0, -- boolean
      FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    );
  `);

  // Remembers which contact a payer name from an incoming SMS refers to, so the
  // user is only asked to identify e.g. "Mr ANURAG YADAV" once — every later
  // credit from that same name auto-settles without asking again.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contact_aliases (
      id TEXT PRIMARY KEY,
      normalized_name TEXT UNIQUE,
      raw_name TEXT,
      contact_id TEXT,
      contact_name TEXT,
      created_at TEXT
    );
  `);

  // A record of money received against a friend's debt — separate from splits'
  // own "settled" flag so a friend's detail screen can show a real timeline
  // ("you paid for X on the 3rd" / "they paid you back on the 9th"), and so a
  // payment that doesn't match any open split is still visible rather than
  // silently dropped.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      contact_id TEXT,
      contact_name TEXT,
      amount REAL,
      transaction_id TEXT,
      matched_split_id TEXT,
      date TEXT,
      created_at TEXT
    );
  `);

  // Small key-value store for on-device settings (e.g. the server URL for
  // web sync) — avoids pulling in AsyncStorage for what's currently one string.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE
    );
  `);

  await db.execute(`
    INSERT OR IGNORE INTO categories (id, name) VALUES 
    ('food', 'Food'), 
    ('transport', 'Transport'), 
    ('bills', 'Bills'), 
    ('shopping', 'Shopping'), 
    ('rent', 'Rent'), 
    ('other', 'Other');
  `);
};
