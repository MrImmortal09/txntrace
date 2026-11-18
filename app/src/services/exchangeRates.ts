import { db } from '../db/schema';
import { getSetting, setSetting } from './appSettings';
import { fetchExchangeRates } from './webSync';

/**
 * Rupee prices for card spends made in another currency.
 *
 * The server fetches rates once a day and serves the same copy to everyone
 * (server/app/exchange_rates.py). The phone keeps the last copy it got, so a
 * message can still be converted with no connection, and only asks again
 * when that copy is half a day old.
 */

const RATES_KEY = 'exchange_rates';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
// After a failed fetch, don't try again for a while: ingestion runs on every
// screen focus, and each attempt offline would wait out the full timeout.
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

type Rates = Record<string, number>;

interface CachedRates {
  rates: Rates;
  /** When the server fetched them. */
  fetched_at: string | null;
  /** When this phone last got them from the server. */
  checked_at: string;
}

let lastFailureAt = 0;

const loadCached = async (): Promise<CachedRates | null> => {
  const raw = await getSetting(RATES_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.rates === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/** INR per unit of each currency: the cached copy, refreshed from the server when it's old. */
export const getExchangeRates = async (): Promise<Rates> => {
  const cached = await loadCached();
  if (cached && Date.now() - Date.parse(cached.checked_at) < MAX_AGE_MS) return cached.rates;
  if (Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) return cached?.rates || {};

  try {
    const fresh = await fetchExchangeRates(8_000);
    // A server that hasn't fetched yet answers with no rates; keep what we
    // had, and don't record a check, so the next message asks again.
    if (Object.keys(fresh.rates).length === 0) return cached?.rates || {};
    await setSetting(
      RATES_KEY,
      JSON.stringify({ rates: fresh.rates, fetched_at: fresh.fetched_at, checked_at: new Date().toISOString() })
    );
    return fresh.rates;
  } catch (e) {
    lastFailureAt = Date.now();
    console.warn('Could not fetch exchange rates:', e);
    return cached?.rates || {};
  }
};

const roundPaise = (n: number) => Math.round(n * 100) / 100;

export interface RupeePrice {
  /** What the transaction is stored at, in ₹. 0 while no rate is known. */
  amount: number;
  original_currency: string | null;
  original_amount: number | null;
  /** INR per unit; null when the currency had no rate yet. */
  fx_rate: number | null;
  /** The card's markup percent that went into amount. */
  fx_markup: number | null;
}

/** ₹ for an amount in `currency`, at the market rate plus the card's forex markup. */
export const priceInRupees = (
  amount: number,
  currency: string | undefined,
  rates: Rates,
  markupPercent: number | null | undefined
): RupeePrice => {
  if (!currency || currency === 'INR') {
    return { amount, original_currency: null, original_amount: null, fx_rate: null, fx_markup: null };
  }
  const markup = markupPercent && markupPercent > 0 ? markupPercent : 0;
  const rate = rates[currency];
  return {
    amount: rate ? roundPaise(amount * rate * (1 + markup / 100)) : 0,
    original_currency: currency,
    original_amount: amount,
    fx_rate: rate || null,
    fx_markup: markup,
  };
};

const rowsOf = (res: any): any[] => {
  const rows: any = res.rows;
  return rows?._array || rows || [];
};

/**
 * Prices the foreign spends that came in while no rate was known (stored at
 * ₹0). Cheap when there are none, so it's safe to call on every message check.
 */
export const convertPendingForeignAmounts = async (): Promise<number> => {
  const pending = rowsOf(
    await db.execute(
      'SELECT id, original_currency, original_amount, fx_markup FROM transactions WHERE original_currency IS NOT NULL AND fx_rate IS NULL'
    )
  );
  if (pending.length === 0) return 0;

  const rates = await getExchangeRates();
  let converted = 0;
  for (const txn of pending) {
    const price = priceInRupees(txn.original_amount, txn.original_currency, rates, txn.fx_markup);
    if (price.fx_rate === null) continue;
    await db.execute('UPDATE transactions SET amount = ?, fx_rate = ?, updated_at = ? WHERE id = ?', [
      price.amount,
      price.fx_rate,
      new Date().toISOString(),
      txn.id,
    ]);
    converted++;
  }
  return converted;
};

/**
 * Re-prices a card's foreign spends after its markup changes, at the rate
 * each was first converted at, so setting the markup fixes spends that came
 * in before it was set.
 */
export const applyCardForexMarkup = async (cardId: string, markupPercent: number | null): Promise<void> => {
  const markup = markupPercent && markupPercent > 0 ? markupPercent : 0;
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE transactions
       SET fx_markup = ?, amount = ROUND(original_amount * fx_rate * (1 + ? / 100.0), 2), updated_at = ?
     WHERE card_id = ? AND original_currency IS NOT NULL AND fx_rate IS NOT NULL
       AND COALESCE(fx_markup, 0) != ?`,
    [markup, markup, now, cardId, markup]
  );
  // Still waiting for a rate: just remember the markup for when it arrives.
  await db.execute(
    'UPDATE transactions SET fx_markup = ? WHERE card_id = ? AND original_currency IS NOT NULL AND fx_rate IS NULL',
    [markup, cardId]
  );
};
