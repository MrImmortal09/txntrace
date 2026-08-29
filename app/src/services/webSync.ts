import { SERVER_URL as SERVER_URL_DEFAULT } from '@env';
import { db } from '../db/schema';
import { getSetting, setSetting } from './appSettings';

const SERVER_URL_KEY = 'web_sync_server_url';
const LAST_SYNC_KEY = 'web_sync_last_created_at';

/**
 * An explicit choice made via Settings always wins — a build-time default
 * shouldn't silently override something the user deliberately changed. It's
 * only consulted (not persisted) when nothing has been set yet, so bumping
 * SERVER_URL in .env and rebuilding still takes effect for anyone who never
 * touched the field.
 */
export const getServerUrl = async (): Promise<string | null> => {
  const stored = await getSetting(SERVER_URL_KEY);
  if (stored) return stored;
  return SERVER_URL_DEFAULT ? SERVER_URL_DEFAULT.replace(/\/+$/, '') : null;
};

export const setServerUrl = (url: string) => setSetting(SERVER_URL_KEY, url.replace(/\/+$/, ''));

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
  reference: string | null;
  account_last4: string | null;
  balance: number | null;
  sender: string | null;
  sms_body: string | null;
}

/**
 * Pulls whatever the server hasn't handed us yet, keyed by created_at rather
 * than re-fetching everything each time — the server can accumulate a lot of
 * statement history, and INSERT OR IGNORE alone would still mean re-sending
 * the whole table over the network on every sync.
 */
export const syncFromServer = async (): Promise<{ imported: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const since = await getSetting(LAST_SYNC_KEY);
  const url = `${baseUrl}/api/transactions/export${since ? `?since=${encodeURIComponent(since)}` : ''}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  const remote: RemoteTransaction[] = data.transactions || [];

  let imported = 0;
  let latestCreatedAt = since;

  for (const txn of remote) {
    const result = await db.execute(
      `INSERT OR IGNORE INTO transactions
        (id, bank, amount, type, merchant_raw, date, source, category, note, reviewed, created_at, reference, account_last4, balance, sender, sms_body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        txn.reference,
        txn.account_last4,
        txn.balance,
        txn.sender,
        txn.sms_body,
      ]
    );
    imported += result.rowsAffected;
    if (!latestCreatedAt || txn.created_at > latestCreatedAt) latestCreatedAt = txn.created_at;
  }

  if (latestCreatedAt) await setSetting(LAST_SYNC_KEY, latestCreatedAt);
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

  const res = await fetch(`${baseUrl}/api/cards/export`);
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

  const res = await fetch(`${baseUrl}/api/contacts/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  const res = await fetch(url);
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
