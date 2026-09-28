import {
  buildCardOverview,
  computeRewards,
  cycleEndFor,
  cycleStartFor,
  dueDateFor,
  formatTierRate,
  isRefundCredit,
  resolveTier,
  RewardTxn,
  toDateKey,
} from '../src/services/rewards/engine';
import { findPreset, clonePresetProgram } from '../src/services/rewards/presets';

const program = (id: string) => clonePresetProgram(findPreset(id)!);

let seq = 0;
const debit = (amount: number, date: string, merchant = 'SHOP', reward_tier: string | null = null): RewardTxn => ({
  id: `t${++seq}`,
  amount,
  type: 'debit',
  date,
  merchant_raw: merchant,
  sms_body: null,
  reward_tier,
});
const credit = (amount: number, date: string, sms_body: string): RewardTxn => ({
  id: `t${++seq}`,
  amount,
  type: 'credit',
  date,
  merchant_raw: null,
  sms_body,
  reward_tier: null,
});

describe('statement cycle dates', () => {
  it('closes the cycle on statement day and starts the next one the day after', () => {
    expect(toDateKey(cycleEndFor(15, new Date(2026, 8, 15)))).toBe('2026-09-15');
    expect(toDateKey(cycleEndFor(15, new Date(2026, 8, 16)))).toBe('2026-10-15');
    expect(toDateKey(cycleStartFor(15, new Date(2026, 9, 15)))).toBe('2026-09-16');
  });

  it('clamps a 31st statement day to short months', () => {
    expect(toDateKey(cycleEndFor(31, new Date(2026, 1, 10)))).toBe('2026-02-28');
    expect(toDateKey(cycleStartFor(31, new Date(2026, 2, 31)))).toBe('2026-03-01');
  });

  it('rolls the due day into the month after the statement when needed', () => {
    expect(toDateKey(dueDateFor(new Date(2026, 8, 15), 5))).toBe('2026-10-05');
    expect(toDateKey(dueDateFor(new Date(2026, 8, 5), 25))).toBe('2026-09-25');
    expect(toDateKey(dueDateFor(new Date(2026, 8, 15), null))).toBe('2026-10-05');
  });
});

describe('computeRewards', () => {
  it('floors points per transaction, not per cycle', () => {
    const coral = program('icici_coral');
    const txns = [debit(199, '2026-09-02T10:00:00'), debit(199, '2026-09-03T10:00:00')];
    const rewards = computeRewards(coral, 15, txns);
    // 199/100 floors to 1 block × 2 pts each — pooling would have given 3 blocks.
    expect(rewards.get(txns[0].id)!.units).toBe(2);
    expect(rewards.get(txns[1].id)!.units).toBe(2);
    expect(rewards.get(txns[0].id)!.value).toBeCloseTo(0.5);
  });

  it('uses an explicit tier over the default, and keywords over the default', () => {
    const swiggy = program('hdfc_swiggy_blck');
    expect(resolveTier(swiggy, { merchant_raw: 'SWIGGY BANGALORE', reward_tier: null })!.id).toBe('swiggy');
    expect(resolveTier(swiggy, { merchant_raw: 'RANDOM STORE', reward_tier: null })!.id).toBe('other');
    expect(resolveTier(swiggy, { merchant_raw: 'SWIGGY', reward_tier: 'other' })!.id).toBe('other');
    // An id from a tier that no longer exists falls back rather than crashing.
    expect(resolveTier(swiggy, { merchant_raw: 'X', reward_tier: 'deleted' })!.id).toBe('other');
  });

  it('respects a tier minimum amount', () => {
    const swiggy = program('hdfc_swiggy_blck');
    const txns = [debit(200, '2026-09-02T10:00:00', 'SWIGGY'), debit(300, '2026-09-02T11:00:00', 'SWIGGY')];
    const rewards = computeRewards(swiggy, 15, txns);
    expect(rewards.get(txns[0].id)!.units).toBe(0);
    expect(rewards.get(txns[1].id)!.units).toBeCloseTo(30);
  });

  it('caps cashback per cycle and resets in the next cycle', () => {
    const sbi = program('sbi_cashback');
    // 5% of 30k = 1500 each; online cap is 2000/cycle.
    const txns = [
      debit(30000, '2026-09-01T10:00:00'),
      debit(30000, '2026-09-10T10:00:00'),
      debit(30000, '2026-09-20T10:00:00'), // next cycle (statement on the 15th)
    ];
    const rewards = computeRewards(sbi, 15, txns);
    expect(rewards.get(txns[0].id)!.units).toBe(1500);
    expect(rewards.get(txns[1].id)!.units).toBe(500);
    expect(rewards.get(txns[1].id)!.uncappedUnits).toBe(1500);
    expect(rewards.get(txns[2].id)!.units).toBe(1500);
  });

  it('applies the combined cap across tiers', () => {
    const sbi = program('sbi_cashback');
    const txns = [
      debit(40000, '2026-09-01T10:00:00', 'A', 'online'), // 2000 (hits online cap)
      debit(300000, '2026-09-02T10:00:00', 'B', 'offline'), // 3000 → offline cap 2000
    ];
    const rewards = computeRewards(sbi, 15, txns);
    expect(rewards.get(txns[0].id)!.units).toBe(2000);
    expect(rewards.get(txns[1].id)!.units).toBe(2000);
  });

  it('accounts a combined cap by actually-awarded units, not uncapped units, when an individual cap also binds', () => {
    const sbi = program('sbi_cashback');
    // online cap 2000/cycle, offline cap 2000/cycle, combined cap 4000/cycle.
    const txns = [
      debit(50000, '2026-09-01T10:00:00', 'A', 'online'), // 5% = 2500 → online cap trims to 2000
      debit(150000, '2026-09-02T10:00:00', 'B', 'offline'), // 1% = 1500, only 2000 left on combined cap
    ];
    const rewards = computeRewards(sbi, 15, txns);
    expect(rewards.get(txns[0].id)!.units).toBe(2000); // bound by the online cap, not the combined cap
    // Combined cap usage after txn 1 must be 2000 (what was actually earned), not 2500 (the uncapped amount) —
    // otherwise txn 2 would be shortchanged on the combined cap it never actually pushed up against.
    expect(rewards.get(txns[1].id)!.units).toBe(1500);
  });

  it('gives the same result no matter what order overlapping caps are listed in', () => {
    const capsSpec = (tierIds: string[], limit: number) => ({ id: `c${limit}${tierIds.join('')}`, label: '', limit, period: 'cycle' as const, tierIds });
    const base = {
      kind: 'cashback' as const,
      blockSize: 0,
      pointValue: 1,
      autoCredit: true,
      defaultTierId: 'online',
      tiers: [
        { id: 'online', label: 'Online', rate: 5 },
        { id: 'offline', label: 'Offline', rate: 1 },
      ],
    };
    const individualFirst = { ...base, caps: [capsSpec(['online'], 2000), capsSpec(['online', 'offline'], 4000)] };
    const combinedFirst = { ...base, caps: [capsSpec(['online', 'offline'], 4000), capsSpec(['online'], 2000)] };

    const run = (program: typeof individualFirst) =>
      computeRewards(program, 15, [debit(50000, '2026-09-01T10:00:00', 'A', 'online')]); // 5% of 50000 = 2500, uncapped

    const a = [...run(individualFirst).values()][0];
    const b = [...run(combinedFirst).values()][0];
    expect(a.units).toBe(2000);
    expect(b.units).toBe(2000);
  });

  it('applies quarterly caps across statement cycles', () => {
    const flipkart = program('axis_flipkart');
    const txns = [
      debit(60000, '2026-07-05T10:00:00', 'FLIPKART'), // 3000
      debit(60000, '2026-08-05T10:00:00', 'FLIPKART'), // 3000 → only 1000 left in Q3
      debit(60000, '2026-10-05T10:00:00', 'FLIPKART'), // Q4, fresh cap
    ];
    const rewards = computeRewards(flipkart, 20, txns);
    expect(rewards.get(txns[0].id)!.units).toBe(3000);
    expect(rewards.get(txns[1].id)!.units).toBe(1000);
    expect(rewards.get(txns[2].id)!.units).toBe(3000);
  });

  it('accelerates Mayura points above ₹20k of cycle spend', () => {
    const mayura = program('idfc_mayura');
    const txns = [debit(15000, '2026-09-01T10:00:00'), debit(15000, '2026-09-02T10:00:00')];
    const rewards = computeRewards(mayura, 15, txns);
    // first: 100 blocks × 5 = 500
    expect(rewards.get(txns[0].id)!.units).toBe(500);
    // second: 5000 at 5X (33 blocks → 165) + 10000 at 10X (66 blocks → 660)
    expect(rewards.get(txns[1].id)!.units).toBe(825);
  });

  it('ignores credits', () => {
    const coral = program('icici_coral');
    const txns = [credit(5000, '2026-09-01T10:00:00', 'Payment received')];
    expect(computeRewards(coral, 15, txns).size).toBe(0);
  });
});

describe('buildCardOverview', () => {
  const today = new Date(2026, 8, 28); // 28 Sep 2026, statement on the 15th

  it('computes what is left to pay on the last statement', () => {
    const txns = [
      debit(10000, '2026-09-01T10:00:00'), // last cycle (16 Aug – 15 Sep)
      debit(2000, '2026-09-10T10:00:00'),
      credit(500, '2026-09-12T10:00:00', 'Refund of Rs 500 credited to your card'),
      credit(4000, '2026-09-20T10:00:00', 'Payment of Rs 4000 received towards your card'),
      debit(3000, '2026-09-25T10:00:00'), // current cycle
    ];
    const overview = buildCardOverview({
      statementDay: 15,
      dueDay: 5,
      program: program('sbi_cashback'),
      txns,
      entries: [],
      billedOverrides: {},
      today,
    });

    expect(toDateKey(overview.lastStatementDate)).toBe('2026-09-15');
    expect(toDateKey(overview.dueDate)).toBe('2026-10-05');
    expect(overview.billed).toBe(11500);
    expect(overview.paidSinceStatement).toBe(4000);
    expect(overview.toPay).toBe(7500);
    expect(overview.current.netSpend).toBe(3000);
    expect(overview.last.expectedValue).toBeCloseTo(600);
  });

  it('prefers a manually entered statement amount', () => {
    const overview = buildCardOverview({
      statementDay: 15,
      dueDay: null,
      program: null,
      txns: [debit(1000, '2026-09-01T10:00:00')],
      entries: [],
      billedOverrides: { '2026-09-15': 1450 },
      today,
    });
    expect(overview.billed).toBe(1450);
    expect(overview.billedIsManual).toBe(true);
  });

  it('tracks a points balance using logged actuals and redemptions', () => {
    const coral = program('icici_coral');
    const txns = [
      debit(1000, '2026-07-20T10:00:00'), // cycle ending 15 Aug: 20 pts expected
      debit(1000, '2026-08-20T10:00:00'), // cycle ending 15 Sep: 20 pts expected
      debit(1000, '2026-09-20T10:00:00'), // current cycle: not yet credited
    ];
    const overview = buildCardOverview({
      statementDay: 15,
      dueDay: null,
      program: coral,
      txns,
      entries: [
        { id: 'e1', card_id: 'c', kind: 'received', cycle_key: '2026-08-15', units: 18, amount: 4.5, note: null, date: '' },
        { id: 'e2', card_id: 'c', kind: 'redeemed', cycle_key: null, units: 10, amount: 2.5, note: null, date: '' },
      ],
      billedOverrides: {},
      today,
    });
    const aug = overview.cycles.find(c => c.key === '2026-08-15')!;
    expect(aug.receivedUnits).toBe(18);
    expect(aug.expectedUnits).toBe(20);
    // 18 (logged) + 20 (expected, last cycle) − 10 redeemed
    expect(overview.balanceUnits).toBe(28);
  });
});

describe('helpers', () => {
  it('tells refunds from payments', () => {
    expect(isRefundCredit({ merchant_raw: null, sms_body: 'Refund of Rs.200 processed' })).toBe(true);
    expect(isRefundCredit({ merchant_raw: null, sms_body: 'Cashback of Rs 45 credited' })).toBe(true);
    expect(isRefundCredit({ merchant_raw: null, sms_body: 'Payment of Rs 5000 received on your card' })).toBe(false);
  });

  it('formats tier rates with the effective percentage for points', () => {
    const mayura = program('idfc_mayura');
    expect(formatTierRate(mayura, mayura.tiers[0])).toBe('5 pts/₹150 (≈0.83%)');
    const flipkart = program('axis_flipkart');
    expect(formatTierRate(flipkart, flipkart.tiers[0])).toBe('7.5%');
  });
});
