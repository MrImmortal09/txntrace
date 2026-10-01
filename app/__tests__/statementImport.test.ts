import { planStatementImport } from '../src/services/statementImport';
import { ParsedTransaction } from '../src/types';

jest.mock('../src/db/schema', () => ({ db: { execute: jest.fn() } }));

const row = (amount: number, day: number, type: 'debit' | 'credit' = 'debit', merchant = 'SHOP'): ParsedTransaction => ({
  amount,
  type,
  merchant,
  reference: null,
  accountLast4: null,
  balance: null,
  timestamp: new Date(2026, 8, day).getTime(),
  bankName: 'IDFC First Bank',
  isFromCard: true,
  currency: 'INR',
});
const sms = (id: string, amount: number, day: number, hour = 10, type = 'debit') => ({
  id,
  amount,
  type,
  date: new Date(2026, 8, day, hour).toISOString(),
});

describe('planStatementImport', () => {
  it('marks spends already tracked from SMS, allowing for a posting-date lag', () => {
    const plan = planStatementImport([row(499, 3), row(1200, 5)], [sms('a', 499, 1, 22)], 'card1');
    expect(plan.map(p => p.matchedId)).toEqual(['a', null]);
  });

  it('never matches one SMS to two identical statement lines', () => {
    const plan = planStatementImport([row(100, 3), row(100, 3)], [sms('a', 100, 3)], 'card1');
    expect(plan.map(p => p.matchedId)).toEqual(['a', null]);
    expect(plan[0].id).not.toBe(plan[1].id);
  });

  it('ignores a different amount, type, or a date too far off', () => {
    const plan = planStatementImport(
      [row(100, 10), row(100, 10, 'credit'), row(100, 20)],
      [sms('a', 100.5, 10), sms('b', 100, 10, 10, 'debit'), sms('c', 100, 15)],
      'card1'
    );
    expect(plan.map(p => p.matchedId)).toEqual(['b', null, null]);
  });

  it('gives the same line the same id on re-import', () => {
    const first = planStatementImport([row(250, 4), row(250, 4)], [], 'card1');
    const again = planStatementImport([row(250, 4), row(250, 4)], [], 'card1');
    expect(again.map(p => p.id)).toEqual(first.map(p => p.id));
  });
});
