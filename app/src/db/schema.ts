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
      card_id TEXT,
      location TEXT,
      latitude REAL,
      longitude REAL
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

  try {
    await db.execute(`ALTER TABLE transactions ADD COLUMN location TEXT;`);
  } catch (error) {
    // Already migrated.
  }

  try {
    await db.execute(`ALTER TABLE transactions ADD COLUMN latitude REAL;`);
  } catch (error) {
    // Already migrated.
  }

  try {
    await db.execute(`ALTER TABLE transactions ADD COLUMN longitude REAL;`);
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

  // Credit-card tracking lives only on the phone: the statement cycle drives
  // "how much to pay", and reward_program is a JSON RewardProgram (see
  // services/rewards/engine.ts) copied from a preset so rate edits persist.
  // origin tells a card added on the phone ('app') from one pulled from the
  // web ('web'), so a web sync only removes cards the web actually owns.
  const cardMigrations = [
    `ALTER TABLE cards ADD COLUMN statement_day INTEGER;`,
    `ALTER TABLE cards ADD COLUMN due_day INTEGER;`,
    `ALTER TABLE cards ADD COLUMN reward_preset TEXT;`,
    `ALTER TABLE cards ADD COLUMN reward_program TEXT;`,
    `ALTER TABLE cards ADD COLUMN origin TEXT DEFAULT 'web';`,
    // The reward tier the user picked for a card transaction; NULL means the
    // card's default (or a merchant-keyword match). Phone-only, like the
    // cards.* columns above: setTransactionRewardTier() in creditCards.ts
    // deliberately doesn't bump updated_at when writing it, so web sync
    // doesn't mistake it for a locally edited row.
    `ALTER TABLE transactions ADD COLUMN reward_tier TEXT;`,
  ];
  for (const migration of cardMigrations) {
    try {
      await db.execute(migration);
    } catch (error) {
      // Already migrated.
    }
  }

  // Cashback/points actually credited for a statement ('received'), or
  // points cashed out ('redeemed') — compared against the computed estimate
  // to spot a bank under-crediting.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reward_entries (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      kind TEXT, -- 'received' | 'redeemed'
      cycle_key TEXT, -- statement date (YYYY-MM-DD) for 'received'
      units REAL, -- ₹ for cashback cards, points for points cards
      amount REAL, -- ₹ value
      note TEXT,
      date TEXT,
      created_at TEXT
    );
  `);

  // The real billed amount off a statement, when the SMS-derived estimate is
  // off (missed SMS, fees, EMIs, carried-over balance).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS card_statements (
      id TEXT PRIMARY KEY, -- card_id:statement_date
      card_id TEXT,
      statement_date TEXT,
      billed_amount REAL,
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
      logged_at TEXT,
      location TEXT
    );
  `);

  try {
    await db.execute(`ALTER TABLE sms_log ADD COLUMN location TEXT;`);
  } catch (error) {
    // Already migrated.
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS splits (
      id TEXT PRIMARY KEY,
      transaction_id TEXT,
      contact_id TEXT,
      contact_name TEXT,
      amount_owed REAL,
      original_amount REAL,
      settled INTEGER DEFAULT 0, -- boolean
      FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    );
  `);

  try {
    await db.execute(`ALTER TABLE splits ADD COLUMN original_amount REAL;`);
  } catch (error) {
    // Already migrated.
  }

  try {
    await db.execute(`UPDATE splits SET original_amount = amount_owed WHERE original_amount IS NULL AND settled = 0;`);
  } catch (error) {
    // Already backfilled.
  }

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
  // unapplied_amount stores any excess payment beyond open debts (e.g. friend
  // owed ₹410, sent ₹1000 -> unapplied_amount is ₹590, meaning you owe friend ₹590).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      contact_id TEXT,
      contact_name TEXT,
      amount REAL,
      unapplied_amount REAL DEFAULT 0,
      transaction_id TEXT,
      matched_split_id TEXT,
      date TEXT,
      created_at TEXT
    );
  `);

  try {
    await db.execute(`ALTER TABLE settlements ADD COLUMN unapplied_amount REAL DEFAULT 0;`);
  } catch (error) {
    // Already migrated.
  }

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
