import { SERVER_URL as SERVER_URL_DEFAULT } from '@env';
import { db } from '../db/schema';
import { getSetting, setSetting } from './appSettings';

const LAST_SYNC_KEY = 'web_sync_last_created_at';
const LAST_SPLITS_SYNC_KEY = 'web_sync_last_split_created_at';
const LAST_SETTLEMENTS_SYNC_KEY = 'web_sync_last_settlement_created_at';
const AUTH_TOKEN_KEY = 'web_sync_auth_token';

export const getServerUrl = async (): Promise<string> => {
  return 'https://txn.axiosiiitl.dev';
};

export const getAuthToken = async (): Promise<string | null> => {
  return await getSetting(AUTH_TOKEN_KEY);
};

export const setAuthToken = (token: string) => setSetting(AUTH_TOKEN_KEY, token);

const getAuthHeaders = async () => {
  const token = await getAuthToken();
  if (!token) throw new Error('Not authenticated. Please login first.');
  return { 'Authorization': `Bearer ${token}` };
};

export interface ServerBackupStatus {
  exists: boolean;
  transactionCount: number;
  splitCount: number;
  settlementCount: number;
  cardCount: number;
  contactCount: number;
  lastUpdated: string | null;
}

interface RemoteTransaction {
  id: string;
  bank: string | null;
  amount: number;
  type: string;
  merchant_raw: string | null;
  date: string;
  source: string | null;
  category: string | null;
  note: string | null;
  reviewed: number;
  created_at: string;
  updated_at: string;
  reference: string | null;
  account_last4: string | null;
  balance: number | null;
  sender: string | null;
  sms_body: string | null;
  needs_contact_match?: number;
  card_id?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Pulls whatever changed on the server since last time (or all records if fullPull=true) —
 * keyed by updated_at rather than created_at, so an edit to a row the phone already
 * has (e.g. a note added on the web) is picked up too, not just brand-new
 * rows. When fullPull is true, server rows unconditionally update local rows.
 */
export const syncFromServer = async (fullPull = false): Promise<{ imported: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const since = fullPull ? null : await getSetting(LAST_SYNC_KEY);
  const url = `${baseUrl}/api/transactions/export${since ? `?since=${encodeURIComponent(since)}` : ''}`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  const remote: RemoteTransaction[] = data.transactions || [];

  let imported = 0;
  let latestUpdatedAt = since;

  for (const txn of remote) {
    const updatedAt = txn.updated_at || txn.created_at;
    const query = fullPull
      ? `INSERT INTO transactions
          (id, bank, amount, type, merchant_raw, date, source, category, note, reviewed, created_at, updated_at, reference, account_last4, balance, sender, sms_body, needs_contact_match, card_id, location, latitude, longitude)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           bank = excluded.bank,
           amount = excluded.amount,
           type = excluded.type,
           merchant_raw = excluded.merchant_raw,
           date = excluded.date,
           source = excluded.source,
           category = excluded.category,
           note = excluded.note,
           reviewed = excluded.reviewed,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           reference = excluded.reference,
           account_last4 = excluded.account_last4,
           balance = excluded.balance,
           sender = excluded.sender,
           sms_body = excluded.sms_body,
           needs_contact_match = excluded.needs_contact_match,
           card_id = excluded.card_id,
           location = excluded.location,
           latitude = excluded.latitude,
           longitude = excluded.longitude`
      : `INSERT INTO transactions
          (id, bank, amount, type, merchant_raw, date, source, category, note, reviewed, created_at, updated_at, reference, account_last4, balance, sender, sms_body, needs_contact_match, card_id, location, latitude, longitude)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           bank = excluded.bank,
           amount = excluded.amount,
           type = excluded.type,
           merchant_raw = excluded.merchant_raw,
           date = excluded.date,
           source = excluded.source,
           category = excluded.category,
           note = excluded.note,
           reviewed = excluded.reviewed,
           updated_at = excluded.updated_at,
           reference = excluded.reference,
           account_last4 = excluded.account_last4,
           balance = excluded.balance,
           sender = excluded.sender,
           sms_body = excluded.sms_body,
           needs_contact_match = excluded.needs_contact_match,
           card_id = excluded.card_id,
           location = excluded.location,
           latitude = excluded.latitude,
           longitude = excluded.longitude
         WHERE excluded.updated_at > COALESCE(transactions.updated_at, transactions.created_at, '')`;

    const result = await db.execute(query, [
      txn.id,
      txn.bank,
      txn.amount,
      txn.type,
      txn.merchant_raw,
      txn.date,
      txn.source,
      txn.category,
      txn.note,
      txn.reviewed,
      txn.created_at,
      updatedAt,
      txn.reference,
      txn.account_last4,
      txn.balance,
      txn.sender,
      txn.sms_body,
      txn.needs_contact_match ?? 0,
      txn.card_id ?? null,
      txn.location ?? null,
      txn.latitude ?? null,
      txn.longitude ?? null,
    ]);
    imported += result.rowsAffected;
    if (!latestUpdatedAt || updatedAt > latestUpdatedAt) latestUpdatedAt = updatedAt;
  }

  if (latestUpdatedAt) await setSetting(LAST_SYNC_KEY, latestUpdatedAt);
  return { imported };
};

interface RemoteCard {
  id: string;
  name: string;
  bank: string | null;
  last4: string | null;
  credit_limit: number | null;
  is_credit_card: number;
  custom_pattern: string | null;
  created_at: string;
}

/**
 * Full replace, not a delta sync — the registry is small (a handful of cards,
 * not a growing transaction history) and an edit on the web app (renamed
 * card, changed limit) should take effect on the next sync rather than
 * waiting on a "since" cursor that only makes sense for append-only data.
 */
export const syncCardsFromServer = async (): Promise<{ count: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const headers = await getAuthHeaders();
  const res = await fetch(`${baseUrl}/api/cards/export`, { headers });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  const remote: RemoteCard[] = data.cards || [];

  await db.execute('DELETE FROM cards');
  for (const card of remote) {
    await db.execute(
      `INSERT INTO cards (id, name, bank, last4, credit_limit, is_credit_card, custom_pattern, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [card.id, card.name, card.bank, card.last4, card.credit_limit, card.is_credit_card, card.custom_pattern, card.created_at]
    );
  }
  return { count: remote.length };
};

interface LocalContact {
  id: string;
  name: string;
}

/**
 * The phone is the only side with real device-contact access, so it pushes
 * up rather than pulling down (the reverse of cards). Full replace, not a
 * delta — an address book is small and the server never originates or edits
 * a contact itself, so there's no independent state on that side to merge
 * against; whatever gets pushed just becomes the current list. Takes an
 * already-fetched contact array rather than calling react-native-contacts
 * itself, so this module doesn't need the contacts permission as a dependency.
 */
export const syncContactsToServer = async (contacts: LocalContact[]): Promise<{ count: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const headers = await getAuthHeaders();
  const res = await fetch(`${baseUrl}/api/contacts/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ contacts }),
  });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  return { count: data.count ?? contacts.length };
};

interface RemoteSplit {
  id: string;
  transaction_id: string;
  contact_id: string;
  contact_name: string;
  amount_owed: number;
  original_amount?: number | null;
  settled: number;
  created_at: string;
}

/**
 * Pulls splits created on the web's own transactions page down to the
 * phone, so a split made there shows up in the same Friends ledger as one
 * made on-device — delta-keyed by created_at (or all if fullPull=true).
 */
export const syncSplitsFromServer = async (fullPull = false): Promise<{ imported: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const since = fullPull ? null : await getSetting(LAST_SPLITS_SYNC_KEY);
  const url = `${baseUrl}/api/splits/export${since ? `?since=${encodeURIComponent(since)}` : ''}`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  const remote: RemoteSplit[] = data.splits || [];

  let imported = 0;
  let latestCreatedAt = since;

  for (const split of remote) {
    const result = await db.execute(
      `INSERT INTO splits (id, transaction_id, contact_id, contact_name, amount_owed, original_amount, settled)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         transaction_id = excluded.transaction_id,
         contact_id = excluded.contact_id,
         contact_name = excluded.contact_name,
         amount_owed = excluded.amount_owed,
         original_amount = COALESCE(excluded.original_amount, splits.original_amount),
         settled = excluded.settled`,
      [
        split.id,
        split.transaction_id,
        split.contact_id,
        split.contact_name,
        split.amount_owed,
        split.original_amount ?? null,
        split.settled,
      ]
    );
    imported += result.rowsAffected;
    if (split.created_at && (!latestCreatedAt || split.created_at > latestCreatedAt)) latestCreatedAt = split.created_at;
  }

  if (latestCreatedAt) await setSetting(LAST_SPLITS_SYNC_KEY, latestCreatedAt);
  return { imported };
};

/**
 * Pushes every local split up to the server, so the web's own Friends page
 * (built from the server's splits/settlements tables) reflects the same
 * picture as the phone.
 */
export const syncSplitsToServer = async (): Promise<{ count: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const res = await db.execute(
    `SELECT s.id, s.transaction_id, s.contact_id, s.contact_name, s.amount_owed, s.original_amount, s.settled,
            t.date as txn_date, t.merchant_raw as txn_merchant, t.amount as txn_amount
     FROM splits s LEFT JOIN transactions t ON t.id = s.transaction_id`
  );
  const rows: any = res.rows;
  const splits = rows?._array || rows || [];
  if (splits.length === 0) return { count: 0 };

  const headers = await getAuthHeaders();
  const result = await fetch(`${baseUrl}/api/splits/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ splits }),
  });
  if (!result.ok) throw new Error(`Server responded with ${result.status}`);
  return { count: splits.length };
};

interface RemoteSettlement {
  id: string;
  contact_id: string;
  contact_name: string;
  amount: number;
  unapplied_amount?: number;
  transaction_id: string | null;
  matched_split_id: string | null;
  date: string;
  created_at: string;
}

/**
 * Pulls settlements from the server down to the phone — delta-keyed
 * by created_at (or all records if fullPull=true).
 */
export const syncSettlementsFromServer = async (fullPull = false): Promise<{ imported: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const since = fullPull ? null : await getSetting(LAST_SETTLEMENTS_SYNC_KEY);
  const url = `${baseUrl}/api/settlements/export${since ? `?since=${encodeURIComponent(since)}` : ''}`;
  const headers = await getAuthHeaders();

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  const remote: RemoteSettlement[] = data.settlements || [];

  let imported = 0;
  let latestCreatedAt = since;

  for (const s of remote) {
    const result = await db.execute(
      `INSERT INTO settlements (id, contact_id, contact_name, amount, unapplied_amount, transaction_id, matched_split_id, date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         contact_id = excluded.contact_id,
         contact_name = excluded.contact_name,
         amount = excluded.amount,
         unapplied_amount = excluded.unapplied_amount,
         transaction_id = excluded.transaction_id,
         matched_split_id = excluded.matched_split_id,
         date = excluded.date,
         created_at = excluded.created_at`,
      [
        s.id,
        s.contact_id,
        s.contact_name,
        s.amount,
        s.unapplied_amount ?? 0,
        s.transaction_id,
        s.matched_split_id,
        s.date,
        s.created_at,
      ]
    );
    imported += result.rowsAffected;
    if (s.created_at && (!latestCreatedAt || s.created_at > latestCreatedAt)) latestCreatedAt = s.created_at;
  }

  if (latestCreatedAt) await setSetting(LAST_SETTLEMENTS_SYNC_KEY, latestCreatedAt);
  return { imported };
};

/**
 * Pushes every local settlement (a friend's payment history) up to the
 * server for the same reason splits do — the web Friends page otherwise
 * has no way to know a debt was paid back via SMS-matching on the phone.
 */
export const syncSettlementsToServer = async (): Promise<{ count: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const res = await db.execute('SELECT * FROM settlements');
  const rows: any = res.rows;
  const settlements = rows?._array || rows || [];
  if (settlements.length === 0) return { count: 0 };

  const headers = await getAuthHeaders();
  const result = await fetch(`${baseUrl}/api/settlements/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ settlements }),
  });
  if (!result.ok) throw new Error(`Server responded with ${result.status}`);
  return { count: settlements.length };
};

/**
 * Queries server backup status to check whether backup data already exists
 * for the authenticated user, and returns row counts.
 */
export const checkServerBackupStatus = async (): Promise<ServerBackupStatus> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const headers = await getAuthHeaders();
  const res = await fetch(`${baseUrl}/api/backup/status`, { headers });
  if (!res.ok) throw new Error(`Failed to check server backup status: Server responded with ${res.status}`);
  const data = await res.json();
  return {
    exists: Boolean(data.exists),
    transactionCount: data.transaction_count ?? 0,
    splitCount: data.split_count ?? 0,
    settlementCount: data.settlement_count ?? 0,
    cardCount: data.card_count ?? 0,
    contactCount: data.contact_count ?? 0,
    lastUpdated: data.last_updated ?? null,
  };
};

/**
 * Backs up all local user data (transactions, splits, settlements, cards, contacts)
 * to the server. If overwrite is true, existing user data on the server is replaced.
 */
export const backupLocalToServer = async (options: {
  overwrite: boolean;
  contacts?: LocalContact[];
}): Promise<{
  success: boolean;
  transactions: number;
  splits: number;
  settlements: number;
  cards: number;
  contacts: number;
}> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  // 1. Fetch transactions
  const txRes = await db.execute('SELECT * FROM transactions');
  const txRows: any = txRes.rows;
  const transactions = txRows?._array || txRows || [];

  // 2. Fetch splits (with denormalized transaction info)
  const splitsRes = await db.execute(
    `SELECT s.id, s.transaction_id, s.contact_id, s.contact_name, s.amount_owed, s.original_amount, s.settled,
            t.date as txn_date, t.merchant_raw as txn_merchant, t.amount as txn_amount
     FROM splits s LEFT JOIN transactions t ON t.id = s.transaction_id`
  );
  const splitsRows: any = splitsRes.rows;
  const splits = splitsRows?._array || splitsRows || [];

  // 3. Fetch settlements
  const setRes = await db.execute('SELECT * FROM settlements');
  const setRows: any = setRes.rows;
  const settlements = setRows?._array || setRows || [];

  // 4. Fetch cards
  const cardsRes = await db.execute('SELECT * FROM cards');
  const cardsRows: any = cardsRes.rows;
  const cards = cardsRows?._array || cardsRows || [];

  const headers = await getAuthHeaders();
  const res = await fetch(`${baseUrl}/api/backup/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      overwrite: options.overwrite,
      transactions,
      splits,
      settlements,
      cards,
      contacts: options.contacts || [],
    }),
  });

  if (!res.ok) throw new Error(`Backup failed: Server responded with ${res.status}`);
  const data = await res.json();

  // Advance sync cursors to match the local state that was just backed up to server
  let latestTxnTime: string | null = null;
  for (const t of transactions) {
    const tTime = t.updated_at || t.created_at;
    if (tTime && (!latestTxnTime || tTime > latestTxnTime)) latestTxnTime = tTime;
  }
  if (latestTxnTime) await setSetting(LAST_SYNC_KEY, latestTxnTime);

  let latestSplitTime: string | null = null;
  for (const s of splits) {
    if (s.created_at && (!latestSplitTime || s.created_at > latestSplitTime)) latestSplitTime = s.created_at;
  }
  if (latestSplitTime) await setSetting(LAST_SPLITS_SYNC_KEY, latestSplitTime);

  let latestSettlementTime: string | null = null;
  for (const st of settlements) {
    if (st.created_at && (!latestSettlementTime || st.created_at > latestSettlementTime)) latestSettlementTime = st.created_at;
  }
  if (latestSettlementTime) await setSetting(LAST_SETTLEMENTS_SYNC_KEY, latestSettlementTime);

  return {
    success: true,
    transactions: data.transactions_count ?? transactions.length,
    splits: data.splits_count ?? splits.length,
    settlements: data.settlements_count ?? settlements.length,
    cards: data.cards_count ?? cards.length,
    contacts: data.contacts_count ?? (options.contacts?.length || 0),
  };
};

/**
 * Performs a full pull/restore from the server: pulls all transactions,
 * cards, splits, and settlements into the local SQLite database.
 */
export const restoreFromServer = async (): Promise<{
  transactions: number;
  cards: number;
  splits: number;
  settlements: number;
}> => {
  const { imported: transactions } = await syncFromServer(true);
  const { count: cards } = await syncCardsFromServer();
  const { imported: splits } = await syncSplitsFromServer(true);
  const { imported: settlements } = await syncSettlementsFromServer(true);

  return {
    transactions,
    cards,
    splits,
    settlements,
  };
};
