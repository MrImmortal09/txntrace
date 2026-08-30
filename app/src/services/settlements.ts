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
 * Applies an incoming payment to a contact's open debts, oldest first,
 * tracking a running balance rather than requiring one payment to cover a
 * split in full. A payment smaller than what's owed now reduces amount_owed
 * instead of being left unmatched; leftover beyond what the oldest split
 * needs rolls forward into the next-oldest one, so several partial payments
 * (₹10, then ₹90 against a ₹100 debt) still add up to fully settling it.
 * This can only run after the user has explicitly matched a payment to a
 * contact in the first place, so applying it — even partially — to their
 * known debt is exactly what that match means, not a guess. A contact with
 * no open splits at all still gets the settlement recorded, just with no
 * matched split, so the money isn't silently dropped from their history.
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
     WHERE s.contact_id = ? AND s.settled = 0
     ORDER BY t.date ASC`,
    [contactId]
  );
  const rows: any = openSplits.rows;
  const arr = rows?._array || rows || [];

  let remaining = amount;
  let firstMatchedId: string | null = null;

  for (const split of arr) {
    if (remaining <= 0) break;
    firstMatchedId = firstMatchedId ?? split.id;

    if (remaining >= split.amount_owed) {
      remaining = Number((remaining - split.amount_owed).toFixed(2));
      await db.execute('UPDATE splits SET settled = 1, amount_owed = 0 WHERE id = ?', [split.id]);
    } else {
      const newOwed = Number((split.amount_owed - remaining).toFixed(2));
      remaining = 0;
      await db.execute('UPDATE splits SET amount_owed = ? WHERE id = ?', [newOwed, split.id]);
    }
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
      firstMatchedId,
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );

  return { matchedSplitId: firstMatchedId };
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
