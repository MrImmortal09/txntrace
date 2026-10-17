import { db } from '../db/schema';

/**
 * Deletes every transaction and everything built on them: friend splits,
 * settlements, and the payer names learned from matching them. All in one
 * transaction, so Friends can't be left showing balances whose transactions
 * are gone. Cards, card statements and rewards, categories, settings and the
 * SMS log are kept.
 */
export const clearTransactionData = () =>
  db.transaction(async tx => {
    for (const table of ['splits', 'settlements', 'contact_aliases', 'transactions']) {
      await tx.execute(`DELETE FROM ${table}`);
    }
  });
