import { db } from '../db/schema';
import { routeSms, parseAnySms, looksLikeBankSms } from '../parsers/sms';
import { findAliasForName, applySettlement, looksLikePersonName } from './settlements';

interface StoredSmsTxn {
  id: string;
  sender: string | null;
  sms_body: string | null;
  bank: string | null;
  merchant_raw: string | null;
  type: string;
  amount: number;
  needs_contact_match: number;
}

/**
 * Re-derives bank/merchant for every SMS-origin transaction from its saved
 * raw sender+body, using whatever the parser logic can do *now* rather than
 * whatever it could do when the message first arrived. A sender or parser
 * fix (e.g. a Shortcuts automation that used to ship an empty sender,
 * misrouting messages through the wrong bank's parser) only affects
 * newly-ingested messages — a transaction already stored with a wrong
 * bank/merchant stays wrong forever otherwise, since nothing else ever
 * looks at it again.
 *
 * Also re-runs the same friend-matching a fresh credit would get: a
 * corrected name might now read as a person's (or stop reading as one), or
 * match an alias that didn't exist yet at ingestion time.
 */
export const reparseStoredMessages = async (): Promise<{ updated: number; matched: number }> => {
  const res = await db.execute(
    `SELECT id, sender, sms_body, bank, merchant_raw, type, amount, needs_contact_match
     FROM transactions WHERE source = 'sms' AND sms_body IS NOT NULL AND sms_body != ''`
  );
  const rows: any = res.rows;
  const arr: StoredSmsTxn[] = rows?._array || rows || [];

  let updated = 0;
  let matched = 0;
  const now = () => new Date().toISOString();

  for (const txn of arr) {
    const sender = txn.sender || '';
    const body = txn.sms_body!;
    // Same fallback chain as live ingestion (see processSMSBatch) — trying
    // canHandle against the body text is what actually recovers the right
    // bank for a row whose sender was never captured correctly in the
    // first place, which re-deriving from that same empty sender can't fix.
    const parsed =
      routeSms(sender, body, now()) ??
      routeSms(body, body, now()) ??
      (looksLikeBankSms(body) ? parseAnySms(body, now()) : null);
    if (!parsed) continue;

    if (parsed.bank === txn.bank && parsed.merchant === txn.merchant_raw) continue;

    await db.execute('UPDATE transactions SET bank = ?, merchant_raw = ?, updated_at = ? WHERE id = ?', [
      parsed.bank,
      parsed.merchant,
      now(),
      txn.id,
    ]);
    updated++;

    if (txn.type !== 'credit') continue;

    if (!looksLikePersonName(parsed.merchant)) {
      if (txn.needs_contact_match) {
        await db.execute('UPDATE transactions SET needs_contact_match = 0 WHERE id = ?', [txn.id]);
      }
      continue;
    }

    const alias = await findAliasForName(parsed.merchant!);
    if (!alias) {
      if (!txn.needs_contact_match) {
        await db.execute('UPDATE transactions SET needs_contact_match = 1 WHERE id = ?', [txn.id]);
      }
      continue;
    }

    // Don't re-settle a credit that was already matched under its old
    // (wrong) name — only apply it the first time a name becomes known.
    const existing = await db.execute('SELECT id FROM settlements WHERE transaction_id = ?', [txn.id]);
    const existingRows: any = existing.rows;
    if ((existingRows?._array || existingRows || []).length > 0) continue;

    await applySettlement(alias.contact_id, alias.contact_name, txn.amount, txn.id);
    matched++;
  }

  return { updated, matched };
};
