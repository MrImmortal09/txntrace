import { SERVER_URL as SERVER_URL_DEFAULT } from '@env';
import { db } from '../db/schema';
import { deleteSettings, getSetting, setSetting } from './appSettings';

const LAST_SYNC_KEY = 'web_sync_last_created_at';
const LAST_SPLITS_SYNC_KEY = 'web_sync_last_split_created_at';
const LAST_SETTLEMENTS_SYNC_KEY = 'web_sync_last_settlement_created_at';
const AUTH_TOKEN_KEY = 'web_sync_auth_token';

/** Served by the server's /privacy route. App Store Connect links to it too. */
export const PRIVACY_POLICY_URL = 'https://txn.axiosiiitl.dev/privacy';

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

// React Native's fetch never gives up by itself (iOS sends a timeout of 0), so
// one stalled request would leave Sync or Backup spinning forever. Long enough
// for a slow network; Cloudflare in front of the server answers 524 at 100s.
const REQUEST_TIMEOUT_MS = 90_000;

const request = async (url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      throw new Error(`The server didn't answer within ${timeoutMs / 1000}s (${path}). Check your connection and try again.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

const signOutOfWebSync = () =>
  deleteSettings([AUTH_TOKEN_KEY, LAST_SYNC_KEY, LAST_SPLITS_SYNC_KEY, LAST_SETTLEMENTS_SYNC_KEY]);

/**
 * Settings → Delete Account. The server deletes the account and everything it
 * holds for it, and this phone is signed out of web sync, sync positions
 * included, so a later sign-in starts from scratch. Data on the phone stays.
 */
export const deleteServerAccount = async (): Promise<void> => {
  const baseUrl = await getServerUrl();
  const headers = await getAuthHeaders();
  const res = await request(`${baseUrl}/api/account`, { method: 'DELETE', headers });
  if (res.status === 401) {
    // The token no longer proves who this is, so the account can't be
    // deleted with it. Signing in again gets a token that can.
    await signOutOfWebSync();
    throw new Error('Your sign-in has expired. Sign in again, then delete your account.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Server responded with ${res.status}`);
  }
  await signOutOfWebSync();
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
  reward_tier?: string | null;
}

/**
 * Pulls whatever changed on the server since last time (or all records if fullPull=true) —
 * keyed by updated_at rather than created_at, so an edit to a row the phone already
 * has (e.g. a note added on the web) is picked up too, not just brand-new
 * rows. When fullPull is true, server rows unconditionally update local rows.
 * The reward tier is set on the phone, so like a card's settings, only a new
 * row or a Restore takes the server's.
 */
export const syncFromServer = async (fullPull = false): Promise<{ imported: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const since = fullPull ? null : await getSetting(LAST_SYNC_KEY);
  const url = `${baseUrl}/api/transactions/export${since ? `?since=${encodeURIComponent(since)}` : ''}`;
  const headers = await getAuthHeaders();

  const res = await request(url, { headers });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  const remote: RemoteTransaction[] = data.transactions || [];

  let imported = 0;
  let latestUpdatedAt = since;

  for (const txn of remote) {
    const updatedAt = txn.updated_at || txn.created_at;
    const query = fullPull
      ? `INSERT INTO transactions
          (id, bank, amount, type, merchant_raw, date, source, category, note, reviewed, created_at, updated_at, reference, account_last4, balance, sender, sms_body, needs_contact_match, card_id, location, latitude, longitude, reward_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           longitude = excluded.longitude,
           reward_tier = COALESCE(excluded.reward_tier, transactions.reward_tier)`
      : `INSERT INTO transactions
          (id, bank, amount, type, merchant_raw, date, source, category, note, reviewed, created_at, updated_at, reference, account_last4, balance, sender, sms_body, needs_contact_match, card_id, location, latitude, longitude, reward_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      txn.reward_tier ?? null,
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
  statement_day?: number | null;
  due_day?: number | null;
  reward_preset?: string | null;
  reward_program?: string | null;
  origin?: string | null;
}

/**
 * Mirrors the server's registry rather than a "since" delta — the registry is
 * small and an edit on the web app (renamed card, changed limit) should take
 * effect on the next sync. Upserts instead of wiping the table, though: cards
 * added on the phone (origin 'app') must survive a sync that doesn't know
 * about them.
 *
 * The statement and due days and reward program are set on the phone, so the
 * server only has them as of the last backup. A card new to this phone takes
 * them; Sync leaves an existing card's alone, so an older backup never undoes
 * a change; Restore (fullPull) takes the backup's.
 */
export const syncCardsFromServer = async (fullPull = false): Promise<{ count: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const headers = await getAuthHeaders();
  const res = await request(`${baseUrl}/api/cards/export`, { headers });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.cards)) throw new Error('Malformed response from server: missing cards array.');
  const remote: RemoteCard[] = data.cards;

  const restoreSettings = fullPull
    ? `,
         statement_day = COALESCE(excluded.statement_day, cards.statement_day),
         due_day = COALESCE(excluded.due_day, cards.due_day),
         reward_preset = COALESCE(excluded.reward_preset, cards.reward_preset),
         reward_program = COALESCE(excluded.reward_program, cards.reward_program)`
    : '';
  for (const card of remote) {
    await db.execute(
      `INSERT INTO cards (id, name, bank, last4, credit_limit, is_credit_card, custom_pattern, created_at,
                          statement_day, due_day, reward_preset, reward_program, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'web'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         bank = excluded.bank,
         last4 = excluded.last4,
         credit_limit = excluded.credit_limit,
         is_credit_card = excluded.is_credit_card,
         custom_pattern = excluded.custom_pattern${restoreSettings}`,
      [
        card.id,
        card.name,
        card.bank,
        card.last4,
        card.credit_limit,
        card.is_credit_card,
        card.custom_pattern,
        card.created_at,
        card.statement_day ?? null,
        card.due_day ?? null,
        card.reward_preset ?? null,
        card.reward_program ?? null,
        card.origin ?? null,
      ]
    );
  }

  const remoteIds = remote.map(c => c.id);
  await db.execute(
    `DELETE FROM cards WHERE COALESCE(origin, 'web') = 'web'${
      remoteIds.length ? ` AND id NOT IN (${remoteIds.map(() => '?').join(', ')})` : ''
    }`,
    remoteIds
  );
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
  const res = await request(`${baseUrl}/api/contacts/sync`, {
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

  const res = await request(url, { headers });
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
  const result = await request(`${baseUrl}/api/splits/sync`, {
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

  const res = await request(url, { headers });
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
  const result = await request(`${baseUrl}/api/settlements/sync`, {
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
  const res = await request(`${baseUrl}/api/backup/status`, { headers });
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

  // 5. A card's reward entries and statement amounts, which only Restore brings back
  const rewardsRes = await db.execute('SELECT * FROM reward_entries');
  const rewardsRows: any = rewardsRes.rows;
  const rewardEntries = rewardsRows?._array || rewardsRows || [];
  const statementsRes = await db.execute('SELECT * FROM card_statements');
  const statementsRows: any = statementsRes.rows;
  const cardStatements = statementsRows?._array || statementsRows || [];

  const headers = await getAuthHeaders();
  // The whole history goes up in one request, so it gets longer on a slow network.
  const res = await request(`${baseUrl}/api/backup/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      overwrite: options.overwrite,
      transactions,
      splits,
      settlements,
      cards,
      contacts: options.contacts || [],
      reward_entries: rewardEntries,
      card_statements: cardStatements,
    }),
  }, 3 * REQUEST_TIMEOUT_MS);

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
 * Restore only, never Sync: the reward entries and statement amounts the last
 * backup sent. The server's copy is only as new as that backup, so Sync would
 * bring back an entry deleted on the phone since. The backup's copy wins here.
 */
export const syncCardHistoryFromServer = async (): Promise<{ rewardEntries: number; cardStatements: number }> => {
  const baseUrl = await getServerUrl();
  if (!baseUrl) throw new Error('No server URL configured.');

  const headers = await getAuthHeaders();
  const res = await request(`${baseUrl}/api/card-history/export`, { headers });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  const rewardEntries: any[] = data.reward_entries || [];
  const cardStatements: any[] = data.card_statements || [];

  for (const r of rewardEntries) {
    await db.execute(
      `INSERT OR REPLACE INTO reward_entries (id, card_id, kind, cycle_key, units, amount, note, date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.card_id, r.kind, r.cycle_key, r.units, r.amount, r.note, r.date, r.created_at]
    );
  }
  for (const s of cardStatements) {
    await db.execute(
      `INSERT OR REPLACE INTO card_statements (id, card_id, statement_date, billed_amount, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [s.id, s.card_id, s.statement_date, s.billed_amount, s.created_at]
    );
  }
  return { rewardEntries: rewardEntries.length, cardStatements: cardStatements.length };
};

/**
 * Performs a full pull/restore from the server: pulls all transactions,
 * cards with their dues and rewards, splits, and settlements into the local
 * SQLite database.
 */
export const restoreFromServer = async (): Promise<{
  transactions: number;
  cards: number;
  splits: number;
  settlements: number;
}> => {
  const { imported: transactions } = await syncFromServer(true);
  const { count: cards } = await syncCardsFromServer(true);
  await syncCardHistoryFromServer();
  const { imported: splits } = await syncSplitsFromServer(true);
  const { imported: settlements } = await syncSettlementsFromServer(true);

  return {
    transactions,
    cards,
    splits,
    settlements,
  };
};
