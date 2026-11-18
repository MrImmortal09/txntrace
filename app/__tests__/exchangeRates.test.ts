import { db } from '../src/db/schema';
import { fetchExchangeRates } from '../src/services/webSync';
import {
  convertPendingForeignAmounts,
  getExchangeRates,
  isAwaitingRate,
  repriceForeignSpends,
} from '../src/services/exchangeRates';

jest.mock('../src/db/schema', () => ({ db: { execute: jest.fn() } }));
jest.mock('../src/services/webSync', () => ({ fetchExchangeRates: jest.fn() }));

const execute = db.execute as jest.Mock;
const updates = () => execute.mock.calls.filter(([q]) => q.startsWith('UPDATE transactions'));

describe('repriceForeignSpends', () => {
  beforeEach(() => execute.mockReset());

  it('re-prices with the linked card’s markup, at the stored rate', async () => {
    execute.mockImplementation(async (q: string) =>
      q.includes('FROM transactions t')
        ? {
            rows: [
              // Came in before its card had a markup: 1 × 90, no markup.
              { id: 'a', amount: 90, original_currency: 'USD', original_amount: 1, fx_rate: 90, fx_markup: 0, card_markup: 3.5 },
              // Already right: left alone.
              { id: 'b', amount: 93.15, original_currency: 'USD', original_amount: 1, fx_rate: 90, fx_markup: 3.5, card_markup: 3.5 },
              // Still waiting for a rate: stays at ₹0, only the markup is kept.
              { id: 'c', amount: 0, original_currency: 'EUR', original_amount: 5, fx_rate: null, fx_markup: 0, card_markup: 2 },
            ],
          }
        : { rowsAffected: 1 }
    );

    expect(await repriceForeignSpends()).toBe(2);
    const byId = Object.fromEntries(updates().map(([, params]) => [params[3], params]));
    expect(Object.keys(byId).sort()).toEqual(['a', 'c']);
    expect(byId.a.slice(0, 2)).toEqual([93.15, 3.5]);
    expect(byId.c.slice(0, 2)).toEqual([0, 2]);
  });

  it('drops the markup when the spend is no longer linked to a card', async () => {
    execute.mockImplementation(async (q: string) =>
      q.includes('FROM transactions t')
        ? { rows: [{ id: 'a', amount: 93.15, original_currency: 'USD', original_amount: 1, fx_rate: 90, fx_markup: 3.5, card_markup: null }] }
        : { rowsAffected: 1 }
    );
    await repriceForeignSpends();
    expect(updates()[0][1].slice(0, 2)).toEqual([90, 0]);
  });
});

describe('repriceForeignSpends and convertPendingForeignAmounts', () => {
  beforeEach(() => execute.mockReset());

  it('leaves spends that were split or matched to a friend alone', async () => {
    execute.mockResolvedValue({ rows: [] });
    await repriceForeignSpends();
    const [query] = execute.mock.calls[0];
    expect(query).toContain('NOT EXISTS (SELECT 1 FROM splits');
    expect(query).toContain('NOT EXISTS (SELECT 1 FROM settlements');
  });

  it('prices a pending spend only if its markup is still the one it read', async () => {
    const cached = JSON.stringify({ rates: { EUR: 100 }, fetched_at: null, checked_at: new Date().toISOString() });
    execute.mockImplementation(async (q: string) => {
      if (q.includes('FROM app_settings')) return { rows: [{ value: cached }] };
      if (q.includes('fx_rate IS NULL') && q.startsWith('SELECT')) {
        return { rows: [{ id: 'p', original_currency: 'EUR', original_amount: 5, fx_markup: 2 }] };
      }
      return { rowsAffected: 0 }; // a card save changed the markup meanwhile
    });
    expect(await convertPendingForeignAmounts()).toBe(0);
    const update = execute.mock.calls.find(([q]) => q.startsWith('UPDATE transactions'))!;
    expect(update[0]).toContain('COALESCE(fx_markup, 0) = ?');
    expect(update[1]).toEqual([510, 100, expect.any(String), 'p', 2]);
  });
});

describe('getExchangeRates', () => {
  it('asks the server again when the cached copy lacks a needed currency', async () => {
    execute.mockReset();
    const cached = JSON.stringify({ rates: { USD: 90 }, fetched_at: null, checked_at: new Date().toISOString() });
    execute.mockImplementation(async (q: string) => (q.includes('SELECT value') ? { rows: [{ value: cached }] } : {}));
    (fetchExchangeRates as jest.Mock).mockResolvedValue({ rates: { USD: 90, THB: 2.75 }, fetched_at: null });

    expect(await getExchangeRates(['USD'])).toEqual({ USD: 90 });
    expect(fetchExchangeRates).not.toHaveBeenCalled();
    expect(await getExchangeRates(['THB'])).toEqual({ USD: 90, THB: 2.75 });
    expect(fetchExchangeRates).toHaveBeenCalledTimes(1);
  });

  it('backs off after the server answers with no rates', async () => {
    (fetchExchangeRates as jest.Mock).mockClear();
    execute.mockReset();
    execute.mockResolvedValue({ rows: [] });
    (fetchExchangeRates as jest.Mock).mockResolvedValue({ rates: {}, fetched_at: null });

    expect(await getExchangeRates()).toEqual({});
    expect(await getExchangeRates()).toEqual({});
    expect(fetchExchangeRates).toHaveBeenCalledTimes(1);
  });
});

it('isAwaitingRate is true only for a foreign spend with no rate', () => {
  expect(isAwaitingRate({ original_currency: 'USD', fx_rate: null })).toBe(true);
  expect(isAwaitingRate({ original_currency: 'USD', fx_rate: 90 })).toBe(false);
  expect(isAwaitingRate({ original_currency: null, fx_rate: null })).toBe(false);
});
