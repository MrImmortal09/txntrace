import { db } from '../src/db/schema';
import { fetchExchangeRates } from '../src/services/webSync';
import { getExchangeRates, isAwaitingRate, repriceForeignSpends } from '../src/services/exchangeRates';

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

describe('getExchangeRates', () => {
  it('backs off after the server answers with no rates', async () => {
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
