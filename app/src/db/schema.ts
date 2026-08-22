import { open } from '@op-engineering/op-sqlite';

export const db = open({
  name: 'txntrace.sqlite',
});

export const setupDatabase = async () => {
  await db.executeAsync(`
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
      balance REAL
    );
  `);

  await db.executeAsync(`
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

  await db.executeAsync(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE
    );
  `);

  await db.executeAsync(`
    INSERT OR IGNORE INTO categories (id, name) VALUES 
    ('food', 'Food'), 
    ('transport', 'Transport'), 
    ('bills', 'Bills'), 
    ('shopping', 'Shopping'), 
    ('rent', 'Rent'), 
    ('other', 'Other');
  `);
};
