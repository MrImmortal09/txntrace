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
 * needs rolls forward into the next-oldest one.
 *
 * Any excess remaining after covering all open splits (e.g. friend owed ₹410,
 * sent ₹1000 -> excess ₹590) is stored as unapplied_amount in settlements,
 * indicating that the user now owes the friend this amount.
 */
export const applySettlement = async (
  contactId: string,
  contactName: string,
  amount: number,
  transactionId: string
): Promise<{ matchedSplitId: string | null; unappliedAmount: number }> => {
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

  const unapplied = Math.max(0, Number(remaining.toFixed(2)));

  await db.execute(
    `INSERT INTO settlements (id, contact_id, contact_name, amount, unapplied_amount, transaction_id, matched_split_id, date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `settle_${transactionId}`,
      contactId,
      contactName,
      amount,
      unapplied,
      transactionId,
      firstMatchedId,
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );

  // Identifying this credit as a payment from a known contact *is* reviewing
  // it — there's nothing left to decide on Daily once it's been applied to
  // a friend's balance. Every caller (a fresh match, auto-matching on
  // ingestion, and the re-parse tool) goes through here, so fixing it once
  // in this shared spot covers all three instead of needing it at each.
  await db.execute('UPDATE transactions SET reviewed = 1, needs_contact_match = 0, updated_at = ? WHERE id = ?', [
    new Date().toISOString(),
    transactionId,
  ]);

  return { matchedSplitId: firstMatchedId, unappliedAmount: unapplied };
};

/**
 * Creates a new split for a contact, automatically offsetting against any
 * existing unapplied credit balance (money you owe to the friend).
 * If the user owes the friend ₹590 and adds a new split for ₹200, the ₹200 is
 * immediately satisfied and the user's debt to the friend drops to ₹390.
 */
export const createSplit = async (
  transactionId: string,
  contactId: string,
  contactName: string,
  amount: number
): Promise<{ id: string; amountOwed: number; settled: boolean }> => {
  const splitId = `split_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const creditRes = await db.execute(
    `SELECT id, unapplied_amount FROM settlements
     WHERE contact_id = ? AND unapplied_amount > 0
     ORDER BY date ASC`,
    [contactId]
  );
  const rows: any = creditRes.rows;
  const credits = rows?._array || rows || [];

  let remainingDebt = amount;
  for (const c of credits) {
    if (remainingDebt <= 0) break;
    const currentUnapplied = Number(c.unapplied_amount || 0);
    if (currentUnapplied <= 0) continue;

    if (currentUnapplied >= remainingDebt) {
      const nextUnapplied = Number((currentUnapplied - remainingDebt).toFixed(2));
      await db.execute('UPDATE settlements SET unapplied_amount = ? WHERE id = ?', [nextUnapplied, c.id]);
      remainingDebt = 0;
    } else {
      remainingDebt = Number((remainingDebt - currentUnapplied).toFixed(2));
      await db.execute('UPDATE settlements SET unapplied_amount = 0 WHERE id = ?', [c.id]);
    }
  }

  const settled = remainingDebt <= 0;
  const amountOwed = Math.max(0, Number(remainingDebt.toFixed(2)));

  await db.execute(
    `INSERT INTO splits (id, transaction_id, contact_id, contact_name, amount_owed, original_amount, settled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [splitId, transactionId, contactId, contactName, amountOwed, amount, settled ? 1 : 0]
  );

  return { id: splitId, amountOwed, settled };
};

/**
 * Records that the user paid a friend back (clearing money owed to friend).
 * Reduces unapplied_amount on the friend's settlements oldest first.
 */
export const settleDebtToFriend = async (
  contactId: string,
  contactName: string,
  amount: number,
  transactionId?: string
): Promise<void> => {
  let txnId = transactionId;
  const now = new Date().toISOString();
  if (!txnId) {
    txnId = `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await db.execute(
      `INSERT INTO transactions (id, bank, amount, type, merchant_raw, date, source, reviewed, created_at, updated_at)
       VALUES (?, NULL, ?, 'debit', ?, ?, 'manual', 1, ?, ?)`,
      [txnId, amount, `Paid back ${contactName}`, now, now, now]
    );
  }

  await createSplit(txnId, contactId, contactName, amount);

  await db.execute('UPDATE transactions SET reviewed = 1, updated_at = ? WHERE id = ?', [
    now,
    txnId,
  ]);
};

/**
 * Marks a credit or debit transaction as user's own, clearing review queue
 * and any pending contact match status.
 */
export const markTransactionAsMine = async (transactionId: string): Promise<void> => {
  await db.execute(
    'UPDATE transactions SET reviewed = 1, needs_contact_match = 0, updated_at = ? WHERE id = ?',
    [new Date().toISOString(), transactionId]
  );
};

export interface AutoMatchResult {
  matched: boolean;
  contactId?: string;
  contactName?: string;
  unappliedAmount?: number;
}

/**
 * Attempts to automatically match an incoming credit transaction to a contact:
 * 1. Checks contact aliases for the raw payer/merchant name.
 * 2. Checks known contacts in splits/settlements matching the payer name.
 * 3. Checks device phone contacts matching the payer name.
 * If matched, applies settlement and saves alias for future auto-matches.
 */
export const autoMatchCreditTransaction = async (
  txn: { id: string; merchant_raw: string | null; amount: number }
): Promise<AutoMatchResult> => {
  const rawName = txn.merchant_raw ? txn.merchant_raw.trim() : '';

  // 1. Check existing alias
  if (rawName) {
    const alias = await findAliasForName(rawName);
    if (alias) {
      const { unappliedAmount } = await applySettlement(alias.contact_id, alias.contact_name, txn.amount, txn.id);
      return {
        matched: true,
        contactId: alias.contact_id,
        contactName: alias.contact_name,
        unappliedAmount,
      };
    }
  }

  // 2. Check if normalized rawName matches any known contact in splits, settlements, or aliases
  if (rawName) {
    const normalized = normalizeName(rawName);
    const candidateRes = await db.execute(
      `SELECT contact_id, contact_name FROM (
         SELECT contact_id, contact_name FROM contact_aliases WHERE normalized_name = ?
         UNION
         SELECT contact_id, contact_name FROM splits WHERE UPPER(contact_name) = ?
         UNION
         SELECT contact_id, contact_name FROM settlements WHERE UPPER(contact_name) = ?
       ) WHERE contact_id IS NOT NULL LIMIT 1`,
      [normalized, normalized, normalized]
    );
    const rows: any = candidateRes.rows;
    const candidates = rows?._array || rows || [];
    if (candidates.length > 0 && candidates[0].contact_id) {
      const match = candidates[0];
      await db.execute(
        `INSERT OR REPLACE INTO contact_aliases (id, normalized_name, raw_name, contact_id, contact_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [normalized, normalized, rawName, match.contact_id, match.contact_name, new Date().toISOString()]
      );
      const { unappliedAmount } = await applySettlement(match.contact_id, match.contact_name, txn.amount, txn.id);
      return {
        matched: true,
        contactId: match.contact_id,
        contactName: match.contact_name,
        unappliedAmount,
      };
    }
  }

  // 3. Check device contacts
  try {
    const Contacts = require('react-native-contacts');
    const ContactsModule = Contacts.default || Contacts;
    const perm = await ContactsModule.checkPermission();
    if (perm === 'authorized' && rawName) {
      const allContacts = await ContactsModule.getAll();
      const normRaw = normalizeName(rawName);
      const matched = allContacts.find((c: any) => {
        const name = c.displayName || `${c.givenName || ''} ${c.familyName || ''}`.trim();
        return normalizeName(name) === normRaw;
      });
      if (matched) {
        const contactName = matched.displayName || `${matched.givenName || ''} ${matched.familyName || ''}`.trim();
        await db.execute(
          `INSERT OR REPLACE INTO contact_aliases (id, normalized_name, raw_name, contact_id, contact_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [normRaw, normRaw, rawName, matched.recordID, contactName, new Date().toISOString()]
        );
        const { unappliedAmount } = await applySettlement(matched.recordID, contactName, txn.amount, txn.id);
        return {
          matched: true,
          contactId: matched.recordID,
          contactName,
          unappliedAmount,
        };
      }
    }
  } catch (err) {
    // Ignore contacts read error if module unavailable or permission not granted
  }

  return { matched: false };
};

/**
 * Manually matches a credit transaction to a chosen contact, saving the alias
 * so future transactions from this payer auto-match automatically.
 */
export const matchCreditToContact = async (
  txnId: string,
  rawMerchant: string | null,
  contactId: string,
  contactName: string,
  amount: number
): Promise<{ unappliedAmount: number }> => {
  if (rawMerchant) {
    await db.execute(
      `INSERT OR REPLACE INTO contact_aliases (id, normalized_name, raw_name, contact_id, contact_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [normalizeName(rawMerchant), normalizeName(rawMerchant), rawMerchant, contactId, contactName, new Date().toISOString()]
    );
  }
  const result = await applySettlement(contactId, contactName, amount, txnId);
  return { unappliedAmount: result.unappliedAmount };
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

/**
 * Allows the user to edit a friend's split / debt amount.
 * Setting newAmountOwed to 0 marks the split as settled.
 */
export const editSplitAmount = async (
  splitId: string,
  newAmountOwed: number,
  newTotalAmount?: number
): Promise<void> => {
  const settled = newAmountOwed <= 0 ? 1 : 0;
  const roundedOwed = Math.max(0, Number(newAmountOwed.toFixed(2)));
  if (newTotalAmount !== undefined && newTotalAmount !== null) {
    const roundedTotal = Math.max(roundedOwed, Number(newTotalAmount.toFixed(2)));
    await db.execute(
      'UPDATE splits SET amount_owed = ?, original_amount = ?, settled = ? WHERE id = ?',
      [roundedOwed, roundedTotal, settled, splitId]
    );
  } else {
    await db.execute(
      `UPDATE splits SET amount_owed = ?, settled = ?,
        original_amount = CASE WHEN original_amount IS NULL OR original_amount < ? THEN ? ELSE original_amount END
       WHERE id = ?`,
      [roundedOwed, settled, roundedOwed, roundedOwed, splitId]
    );
  }
};

/**
 * Removes / deletes a split debt entirely from the ledger.
 */
export const deleteSplit = async (splitId: string): Promise<void> => {
  await db.execute('DELETE FROM splits WHERE id = ?', [splitId]);
};

/**
 * Allows the user to edit a settlement amount and/or unapplied excess amount.
 */
export const editSettlementAmount = async (
  settlementId: string,
  newAmount: number,
  newUnappliedAmount?: number
): Promise<void> => {
  const roundedAmount = Math.max(0, Number(newAmount.toFixed(2)));
  if (newUnappliedAmount !== undefined && newUnappliedAmount !== null) {
    const roundedUnapplied = Math.max(0, Number(newUnappliedAmount.toFixed(2)));
    await db.execute(
      'UPDATE settlements SET amount = ?, unapplied_amount = ? WHERE id = ?',
      [roundedAmount, roundedUnapplied, settlementId]
    );
  } else {
    await db.execute(
      'UPDATE settlements SET amount = ?, unapplied_amount = MIN(unapplied_amount, ?) WHERE id = ?',
      [roundedAmount, roundedAmount, settlementId]
    );
  }
};

/**
 * Removes / deletes a settlement record entirely from the ledger.
 */
export const deleteSettlement = async (settlementId: string): Promise<void> => {
  await db.execute('DELETE FROM settlements WHERE id = ?', [settlementId]);
};

/**
 * Clears all outstanding debts with a contact, marking all open splits as settled
 * and zeroing out any unapplied settlement balances.
 */
export const clearAllDebtsWithContact = async (contactId: string): Promise<void> => {
  await db.execute('UPDATE splits SET settled = 1, amount_owed = 0 WHERE contact_id = ?', [contactId]);
  await db.execute('UPDATE settlements SET unapplied_amount = 0 WHERE contact_id = ?', [contactId]);
};
