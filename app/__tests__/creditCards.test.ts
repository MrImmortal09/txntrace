import { CreditCard, rewardInfoFor } from '../src/services/creditCards';
import { clonePresetProgram, findPreset } from '../src/services/rewards/presets';
import { RewardTxn } from '../src/services/rewards/engine';

// rewardInfoFor is pure; the module just imports the native SQLite handle.
jest.mock('../src/db/schema', () => ({ db: { execute: jest.fn() } }));

const swiggyCard: CreditCard = {
  id: 'card_hdfc',
  name: 'HDFC Swiggy BLCK',
  bank: 'HDFC Bank',
  last4: '0904',
  credit_limit: null,
  is_credit_card: 1,
  custom_pattern: null,
  statement_day: 15,
  due_day: null,
  reward_preset: 'hdfc_swiggy_blck',
  origin: 'app',
  program: clonePresetProgram(findPreset('hdfc_swiggy_blck')!),
};

const txn = (id: string, amount: number, merchant: string, reward_tier: string | null = null, date = '2026-10-12T01:55:00'): RewardTxn => ({
  id,
  amount,
  type: 'debit',
  date,
  merchant_raw: merchant,
  sms_body: null,
  reward_tier,
});

describe('rewardInfoFor', () => {
  it('reports the auto tier, the tier in effect, and the capped value on every tier', () => {
    const txns = [txn('earlier', 14800, 'SWIGGY', null, '2026-10-02T10:00:00'), txn('t1', 460, 'PTM*SWIGGY IN')];
    const info = rewardInfoFor(swiggyCard, txns, 't1')!;
    expect(info.autoTierId).toBe('swiggy');
    expect(info.tier.id).toBe('swiggy');
    expect(info.isExplicit).toBe(false);
    expect(info.reward!.units).toBeCloseTo(20); // ₹20 of the ₹1,500 Swiggy cap left
    expect(info.byTier.get('other')!.units).toBeCloseTo(4.6);
  });

  it('keeps the auto tier separate from one picked by hand', () => {
    const info = rewardInfoFor(swiggyCard, [txn('t1', 460, 'PTM*SWIGGY IN', 'other')], 't1')!;
    expect(info.autoTierId).toBe('swiggy');
    expect(info.tier.id).toBe('other');
    expect(info.isExplicit).toBe(true);
    expect(info.reward!.units).toBeCloseTo(4.6);
  });

  it('has nothing to value for an unreadable date', () => {
    const info = rewardInfoFor(swiggyCard, [txn('t1', 460, 'SWIGGY', null, 'not a date')], 't1')!;
    expect(info.reward).toBeNull();
    expect(info.byTier.size).toBe(0);
  });

  it('skips credits and cards without a reward program', () => {
    expect(rewardInfoFor(swiggyCard, [{ ...txn('t1', 460, 'REFUND'), type: 'credit' }], 't1')).toBeNull();
    expect(rewardInfoFor({ ...swiggyCard, program: null }, [txn('t1', 460, 'SWIGGY')], 't1')).toBeNull();
  });
});
