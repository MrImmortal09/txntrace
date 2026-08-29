import { db } from '../db/schema';

/**
 * Collapses a payer name down to a stable matching key.
 *
 * This only needs to match the SAME raw SMS name against itself across
 * messages (e.g. "Janhavi Ajay Ma" appearing in four separate credits) — it is
 * not trying to fuzzy-match against a contact's name, since that link is only
 * ever made once, by the user, in matchNameToContact below.
 */
export const normalizeName = (name: string): string =>
  name
    .toUpperCase()
    .replace(/^(MR|MRS|MS|DR|MISS)\.?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

export interface ContactAlias {
  contact_id: string;
  contact_name: string;
}

export const findAliasForName = async (rawName: string): Promise<ContactAlias | null> => {
  const res = await db.execute(
    'SELECT contact_id, contact_name FROM contact_aliases WHERE normalized_name = ?',
    [normalizeName(rawName)]
  );
  const rows: any = res.rows;
  const arr = rows?._array || rows || [];
  return arr[0] || null;
};

/**
 * Records the user's one-time answer to "who is this?" and immediately tries
 * to apply it to any money already sitting in needs_contact_match limbo.
 */
export const matchNameToContact = async (
  rawName: string,
  contactId: string,
  contactName: string
): Promise<void> => {
  await db.execute(
    `INSERT OR REPLACE INTO contact_aliases (id, normalized_name, raw_name, contact_id, contact_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [normalizeName(rawName), normalizeName(rawName), rawName, contactId, contactName, new Date().toISOString()]
  );

  const pending = await db.execute(
    `SELECT id, amount FROM transactions
     WHERE needs_contact_match = 1 AND merchant_raw = ? AND type = 'credit'`,
    [rawName]
  );
  const rows: any = pending.rows;
  const arr = rows?._array || rows || [];

  for (const txn of arr) {
    await applySettlement(contactId, contactName, txn.amount, txn.id);
    await db.execute('UPDATE transactions SET needs_contact_match = 0 WHERE id = ?', [txn.id]);
  }
};

/**
 * Applies an incoming payment to a contact's oldest open debt.
 *
 * Settles the oldest unsettled split whose amount_owed the payment fully
 * covers, rather than trying to split one payment across several debts or
 * handle partial payments — `settled` is a boolean, not a running balance, so
 * a payment smaller than the oldest open split is left unmatched for the user
 * to reconcile by hand instead of guessing which debt it was meant to cover.
 * The settlement itself is always recorded, even when nothing matches, so the
 * money isn't silently dropped from the friend's history.
 */
export const applySettlement = async (
  contactId: string,
  contactName: string,
  amount: number,
  transactionId: string
): Promise<{ matchedSplitId: string | null }> => {
  const openSplits = await db.execute(
    `SELECT s.id, s.amount_owed FROM splits s
     JOIN transactions t ON t.id = s.transaction_id
     WHERE s.contact_id = ? AND s.settled = 0 AND s.amount_owed <= ?
     ORDER BY t.date ASC LIMIT 1`,
    [contactId, amount]
  );
  const rows: any = openSplits.rows;
  const arr = rows?._array || rows || [];
  const match = arr[0] || null;

  if (match) {
    await db.execute('UPDATE splits SET settled = 1 WHERE id = ?', [match.id]);
  }

  await db.execute(
    `INSERT INTO settlements (id, contact_id, contact_name, amount, transaction_id, matched_split_id, date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `settle_${transactionId}`,
      contactId,
      contactName,
      amount,
      transactionId,
      match?.id ?? null,
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );

  return { matchedSplitId: match?.id ?? null };
};

/**
 * A merchant/payer name that's clearly a business, not a person, is never
 * worth prompting the user to match to a contact.
 */
export const looksLikePersonName = (name: string | null | undefined): boolean => {
  if (!name) return false;
  if (/unknown .* merchant/i.test(name)) return false;
  if (/\b(pvt|ltd|llp|inc|inc\.|inc\b|technologies|services|solutions|foods|store|mart|shop|restaurant|hotel|enterprises|traders|infra|payments|payment|gateway)\b/i.test(name)) {
    return false;
  }
  return true;
};
