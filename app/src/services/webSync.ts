import { SERVER_URL as SERVER_URL_DEFAULT } from '@env';
import { db } from '../db/schema';
import { getSetting, setSetting } from './appSettings';

const LAST_SYNC_KEY = 'web_sync_last_created_at';
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
}

/**
 * Pulls whatever changed on the server since last time — keyed by
 * updated_at rather than created_at, so an edit to a row the phone already
 * has (e.g. a note added on the web) is picked up too, not just brand-new
 * rows. That also means this can no longer be a plain INSERT OR IGNORE: an
 * existing local row needs updating when the server's copy is newer, but
 * must NOT be clobbered when the phone's own copy is newer (e.g. reviewed
 * locally after the server's last-known state) — hence the upsert's WHERE,
 * comparing timestamps instead of blindly preferring either side.
 */
export const syncFromServer = async (): Promise<{ imported: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const since = await getSetting(LAST_SYNC_KEY);
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
    const result = await db.execute(
      `INSERT INTO transactions
        (id, bank, amount, type, merchant_raw, date, source, category, note, reviewed, created_at, updated_at, reference, account_last4, balance, sender, sms_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         sms_body = excluded.sms_body
       WHERE excluded.updated_at > COALESCE(transactions.updated_at, transactions.created_at, '')`,
      [
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
      ]
    );
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
  settled: number;
  created_at: string;
}

const LAST_SPLITS_SYNC_KEY = 'web_sync_last_split_created_at';

/**
 * Pulls splits created on the web's own transactions page down to the
 * phone, so a split made there shows up in the same Friends ledger as one
 * made on-device — delta-keyed by created_at exactly like syncFromServer.
 */
export const syncSplitsFromServer = async (): Promise<{ imported: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const since = await getSetting(LAST_SPLITS_SYNC_KEY);
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
      `INSERT OR IGNORE INTO splits (id, transaction_id, contact_id, contact_name, amount_owed, settled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [split.id, split.transaction_id, split.contact_id, split.contact_name, split.amount_owed, split.settled]
    );
    imported += result.rowsAffected;
    if (!latestCreatedAt || split.created_at > latestCreatedAt) latestCreatedAt = split.created_at;
  }

  if (latestCreatedAt) await setSetting(LAST_SPLITS_SYNC_KEY, latestCreatedAt);
  return { imported };
};

/**
 * Pushes every local split up to the server, so the web's own Friends page
 * (built from the server's splits/settlements tables) reflects the same
 * picture as the phone — otherwise it would only ever see splits created
 * directly on the web, missing everything from SMS-matching or the app's
 * own "+" manual-expense flow. A full push, not a delta: there's no
 * updated_at tracked locally on splits to diff against, and the dataset is
 * small enough (a personal app's lifetime split history, not a growing
 * transaction log) that resending all of it each sync is cheap. The
 * server merges by id (see /api/splits/sync) rather than replacing its own
 * table, so this can't clobber anything authored there.
 */
export const syncSplitsToServer = async (): Promise<{ count: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const res = await db.execute(
    `SELECT s.id, s.transaction_id, s.contact_id, s.contact_name, s.amount_owed, s.settled,
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
