import { db } from '../db/schema';
import { routeSms, parseAnySms, looksLikeBankSms } from '../parsers/sms';
import { findAliasForName, applySettlement, looksLikePersonName } from './settlements';
import { getExchangeRates, priceInRupees } from './exchangeRates';

interface StoredSmsTxn {
  id: string;
  sender: string | null;
  sms_body: string | null;
  bank: string | null;
  merchant_raw: string | null;
  type: string;
  amount: number;
  needs_contact_match: number;
  card_id: string | null;
  original_currency: string | null;
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
    `SELECT id, sender, sms_body, bank, merchant_raw, type, amount, needs_contact_match, card_id, original_currency
     FROM transactions WHERE source = 'sms' AND sms_body IS NOT NULL AND sms_body != ''`
  );
  const rows: any = res.rows;
  const arr: StoredSmsTxn[] = rows?._array || rows || [];

  let updated = 0;
  let matched = 0;
  const now = () => new Date().toISOString();
  // Loaded only if a stored message turns out to be a foreign-currency spend.
  let rates: Record<string, number> | null = null;
  let markupByCard: Map<string, number | null> | null = null;

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

    let amountFixed = false;
    // A spend abroad stored before foreign amounts were understood holds a
    // rupee figure picked from elsewhere in the message, often the available
    // limit. Price it now, from the currency amount the message gave.
    if (parsed.currency && parsed.currency !== 'INR' && !txn.original_currency) {
      rates ??= await getExchangeRates();
      if (!markupByCard) {
        const cardRows: any = (await db.execute('SELECT id, forex_markup FROM cards')).rows;
        markupByCard = new Map((cardRows?._array || cardRows || []).map((c: any) => [c.id, c.forex_markup]));
      }
      const price = priceInRupees(parsed.amount, parsed.currency, rates, txn.card_id ? markupByCard.get(txn.card_id) : null);
      await db.execute(
        `UPDATE transactions SET amount = ?, original_currency = ?, original_amount = ?, fx_rate = ?, fx_markup = ?,
           updated_at = ? WHERE id = ?`,
        [price.amount, price.original_currency, price.original_amount, price.fx_rate, price.fx_markup, now(), txn.id]
      );
      updated++;
      amountFixed = true;
    }

    if (parsed.bank === txn.bank && parsed.merchant === txn.merchant_raw) continue;

    await db.execute('UPDATE transactions SET bank = ?, merchant_raw = ?, updated_at = ? WHERE id = ?', [
      parsed.bank,
      parsed.merchant,
      now(),
      txn.id,
    ]);
    if (!amountFixed) updated++;

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
