import { Alert } from 'react-native';
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

/**
 * INR per unit of each currency: the cached copy, refreshed from the server
 * when it's old, or when it lacks a currency in `needed` (the server may have
 * fetched one since, e.g. after a failed pair was retried).
 */
export const getExchangeRates = async (needed: string[] = []): Promise<Rates> => {
  const cached = await loadCached();
  const fresh = cached && Date.now() - Date.parse(cached.checked_at) < MAX_AGE_MS;
  if (fresh && needed.every(c => cached.rates[c])) return cached.rates;
  if (Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) return cached?.rates || {};

  try {
    const latest = await fetchExchangeRates(8_000);
    // A server that hasn't fetched yet answers with no rates. Keep what we
    // had, and back off like a failure, or every screen focus would ask again.
    if (Object.keys(latest.rates).length === 0) {
      lastFailureAt = Date.now();
      return cached?.rates || {};
    }
    await setSetting(
      RATES_KEY,
      JSON.stringify({ rates: latest.rates, fetched_at: latest.fetched_at, checked_at: new Date().toISOString() })
    );
    // Still missing a needed currency: back off, so the next check doesn't ask at once.
    if (needed.some(c => !latest.rates[c])) lastFailureAt = Date.now();
    return latest.rates;
  } catch (e) {
    lastFailureAt = Date.now();
    console.warn('Could not fetch exchange rates:', e);
    return cached?.rates || {};
  }
};

const roundPaise = (n: number) => Math.round(n * 100) / 100;

/** A foreign spend still at ₹0 because no exchange rate was known when it came in. */
export const isAwaitingRate = (txn: { original_currency?: string | null; fx_rate?: number | null }): boolean =>
  !!txn.original_currency && !txn.fx_rate;

/**
 * Why a spend awaiting a rate can't be split or matched to a friend yet: the
 * split or settlement would be made at ₹0 and never catch up.
 */
export const alertAwaitingRate = () =>
  Alert.alert(
    'Waiting for an exchange rate',
    'This is in another currency and has no rupee amount yet. Open the app with a connection and it’s priced automatically, then try again.'
  );

// A spend split with a friend, or matched to one as a payment, keeps its
// rupee amount: the split or settlement was made from it, and re-pricing the
// spend alone would leave the two disagreeing.
const NOT_SHARED = `NOT EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id)
  AND NOT EXISTS (SELECT 1 FROM settlements st WHERE st.transaction_id = t.id)`;

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

  const rates = await getExchangeRates([...new Set(pending.map(t => t.original_currency as string))]);
  let converted = 0;
  for (const txn of pending) {
    const price = priceInRupees(txn.original_amount, txn.original_currency, rates, txn.fx_markup);
    if (price.fx_rate === null) continue;
    // Only if the markup is still the one priced with: a card saved meanwhile
    // may have changed it, and the next check prices the row with the new one.
    const res = await db.execute(
      `UPDATE transactions SET amount = ?, fx_rate = ?, updated_at = ?
       WHERE id = ? AND fx_rate IS NULL AND COALESCE(fx_markup, 0) = ?`,
      [price.amount, price.fx_rate, new Date().toISOString(), txn.id, txn.fx_markup ?? 0]
    );
    converted += res.rowsAffected ?? 0;
  }
  return converted;
};

/**
 * Brings every foreign spend in line with the markup of the card it's linked
 * to now, at the rate it was first converted at. Runs after cards are saved,
 * deleted or re-matched, so a markup set after the spend came in, or a spend
 * linked to its card later, still ends up priced with the right markup.
 */
export const repriceForeignSpends = async (): Promise<number> => {
  const rows = rowsOf(
    await db.execute(
      `SELECT t.id, t.amount, t.original_currency, t.original_amount, t.fx_rate, t.fx_markup, c.forex_markup AS card_markup
       FROM transactions t LEFT JOIN cards c ON c.id = t.card_id
       WHERE t.original_currency IS NOT NULL AND ${NOT_SHARED}`
    )
  );
  let changed = 0;
  for (const txn of rows) {
    const rates = txn.fx_rate ? { [txn.original_currency]: txn.fx_rate } : {};
    const price = priceInRupees(txn.original_amount, txn.original_currency, rates, txn.card_markup);
    // A spend still waiting for a rate keeps its ₹0; only the markup is remembered.
    const amount = txn.fx_rate ? price.amount : txn.amount;
    if (price.fx_markup === txn.fx_markup && amount === txn.amount) continue;
    await db.execute('UPDATE transactions SET amount = ?, fx_markup = ?, updated_at = ? WHERE id = ?', [
      amount,
      price.fx_markup,
      new Date().toISOString(),
      txn.id,
    ]);
    changed++;
  }
  return changed;
};
