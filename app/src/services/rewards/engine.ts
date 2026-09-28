/**
 * Pure reward + statement-cycle math — no DB access, so it can be unit tested
 * and recomputed on every screen load. Nothing derived here is persisted:
 * change a tier's rate or a card's statement day and every past transaction
 * is re-valued on the next render.
 */

export type RewardKind = 'cashback' | 'points';
export type CapPeriod = 'cycle' | 'quarter';

export interface RewardTier {
  id: string;
  label: string;
  /** cashback: percent of the amount. points: points per full block. */
  rate: number;
  /** A transaction below this earns nothing (e.g. Swiggy BLCK's ₹249 minimum). */
  minAmount?: number;
  /** Auto-picks this tier when the merchant name contains any of these (lowercase). */
  keywords?: string[];
  /** Once the card's rewarding spend in the cycle passes this, the rest earns acceleratedRate (IDFC Mayura's 10X above ₹20k). */
  accelerateAfter?: number;
  acceleratedRate?: number;
}

export interface RewardCap {
  id: string;
  label: string;
  /** ₹ for cashback cards, points for points cards. */
  limit: number;
  period: CapPeriod;
  tierIds: string[];
}

export interface RewardProgram {
  kind: RewardKind;
  /** points only: ₹ per block, floored per transaction (not pooled across the cycle). */
  blockSize: number;
  /** ₹ per point (1 for cashback). */
  pointValue: number;
  /** true = shows up on the statement by itself; false = has to be redeemed. */
  autoCredit: boolean;
  defaultTierId: string;
  tiers: RewardTier[];
  caps: RewardCap[];
}

export interface RewardTxn {
  id: string;
  amount: number;
  type: string;
  date: string;
  merchant_raw: string | null;
  sms_body?: string | null;
  reward_tier: string | null;
}

export interface TxnReward {
  tierId: string;
  /** ₹ for cashback, points for points cards — after caps. */
  units: number;
  uncappedUnits: number;
  /** ₹ value of units. */
  value: number;
}

// ─── Dates ────────────────────────────────────────────────────────────────
// Everything works on local calendar days: a statement "on the 15th" closes at
// the end of the 15th in the phone's timezone.

const pad = (n: number) => String(n).padStart(2, '0');

export const toDateKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d: Date, days: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

export const parseTxnDate = (value: string): Date => {
  const clean = value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value;
  return new Date(clean);
};

/** The statement date in a given month, clamped so "31st" means Feb 28th/29th. month may overflow (-1, 12). */
export const statementDateIn = (year: number, month: number, statementDay: number): Date => {
  const first = new Date(year, month, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(statementDay, lastDay));
};

/** The statement date that closes the cycle containing `d` — `d` itself if it's statement day. */
export const cycleEndFor = (statementDay: number, d: Date): Date => {
  const day = startOfDay(d);
  const sameMonth = statementDateIn(day.getFullYear(), day.getMonth(), statementDay);
  return day.getTime() <= sameMonth.getTime()
    ? sameMonth
    : statementDateIn(day.getFullYear(), day.getMonth() + 1, statementDay);
};

export const previousStatementDate = (statementDay: number, cycleEnd: Date): Date =>
  statementDateIn(cycleEnd.getFullYear(), cycleEnd.getMonth() - 1, statementDay);

export const cycleStartFor = (statementDay: number, cycleEnd: Date): Date =>
  addDays(previousStatementDate(statementDay, cycleEnd), 1);

/** Due date is a fixed day of the month after the statement; falls back to statement + 20 days (the usual Indian grace period). */
export const dueDateFor = (statementDate: Date, dueDay: number | null): Date => {
  if (!dueDay) return addDays(statementDate, 20);
  const sameMonth = statementDateIn(statementDate.getFullYear(), statementDate.getMonth(), dueDay);
  return sameMonth.getTime() > statementDate.getTime()
    ? sameMonth
    : statementDateIn(statementDate.getFullYear(), statementDate.getMonth() + 1, dueDay);
};

const quarterKey = (d: Date) => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;

// A card with no statement day set is bucketed by calendar month for caps.
const CALENDAR_MONTH = 31;

// ─── Rewards ──────────────────────────────────────────────────────────────

export const resolveTier = (program: RewardProgram, txn: Pick<RewardTxn, 'reward_tier' | 'merchant_raw'>): RewardTier | null => {
  if (program.tiers.length === 0) return null;
  const explicit = txn.reward_tier ? program.tiers.find(t => t.id === txn.reward_tier) : undefined;
  if (explicit) return explicit;
  // txn.reward_tier may point at a tier that no longer exists (program edited after the tier was set) — fall through.

  const merchant = (txn.merchant_raw || '').toLowerCase();
  if (merchant) {
    const byKeyword = program.tiers.find(t => t.keywords?.some(k => merchant.includes(k)));
    if (byKeyword) return byKeyword;
  }

  return program.tiers.find(t => t.id === program.defaultTierId) || program.tiers[0];
};

const earnUnits = (program: RewardProgram, amount: number, rate: number): number => {
  if (rate <= 0 || amount <= 0) return 0;
  if (program.kind === 'points') {
    return program.blockSize > 0 ? Math.floor(amount / program.blockSize) * rate : 0;
  }
  return (amount * rate) / 100;
};

/** What a single transaction would earn on a tier, ignoring caps and acceleration — used for the tier picker preview. */
export const estimateUnits = (program: RewardProgram, tier: RewardTier, amount: number): number =>
  tier.minAmount && amount < tier.minAmount ? 0 : earnUnits(program, amount, tier.rate);

/**
 * Walks the card's debits oldest-first so caps and the acceleration threshold
 * fill up in the order the bank would have seen them. Credits (payments,
 * refunds) earn nothing and are skipped.
 */
export const computeRewards = (
  program: RewardProgram,
  statementDay: number | null,
  txns: RewardTxn[]
): Map<string, TxnReward> => {
  const results = new Map<string, TxnReward>();
  const cycleSpend = new Map<string, number>();
  const capUsed = new Map<string, number>();
  const day = statementDay || CALENDAR_MONTH;

  const debits = txns
    .filter(t => t.type === 'debit' && t.amount > 0)
    .map(t => ({ txn: t, when: parseTxnDate(t.date) }))
    .filter(t => !isNaN(t.when.getTime()))
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  for (const { txn, when } of debits) {
    const tier = resolveTier(program, txn);
    if (!tier) continue;

    const cycleKey = toDateKey(cycleEndFor(day, when));
    let units = 0;

    if (!(tier.minAmount && txn.amount < tier.minAmount) && tier.rate > 0) {
      if (tier.accelerateAfter && tier.acceleratedRate) {
        const before = cycleSpend.get(cycleKey) || 0;
        const basePortion = Math.max(0, Math.min(txn.amount, tier.accelerateAfter - before));
        units =
          earnUnits(program, basePortion, tier.rate) +
          earnUnits(program, txn.amount - basePortion, tier.acceleratedRate);
      } else {
        units = earnUnits(program, txn.amount, tier.rate);
      }
      cycleSpend.set(cycleKey, (cycleSpend.get(cycleKey) || 0) + txn.amount);
    }

    const uncappedUnits = units;
    // Order of `program.caps` doesn't matter: each cap.forEach step only reads capUsed as it stood
    // *before* this transaction, so `units` converges to min(uncappedUnits, ...every cap's headroom)
    // regardless of iteration order — then every applicable cap is credited with that same final,
    // already-fully-capped amount (the actual units awarded), never with an intermediate value.
    const caps = program.caps.filter(c => c.tierIds.includes(tier.id));
    const capKeys = caps.map(c => `${c.id}|${c.period === 'quarter' ? quarterKey(when) : cycleKey}`);
    caps.forEach((cap, i) => {
      units = Math.min(units, Math.max(0, cap.limit - (capUsed.get(capKeys[i]) || 0)));
    });
    capKeys.forEach(key => capUsed.set(key, (capUsed.get(key) || 0) + units));

    results.set(txn.id, {
      tierId: tier.id,
      units,
      uncappedUnits,
      value: program.kind === 'points' ? units * program.pointValue : units,
    });
  }

  return results;
};

// ─── Dues & cycle summaries ───────────────────────────────────────────────

const REFUND_PATTERN = /refund|revers|cash\s?back|chargeback|credited back/i;

/**
 * A credit on a card is either a bill payment or money coming back for a
 * purchase. Refunds/cashback reduce what the cycle bills; payments pay off a
 * statement. Anything not recognizably a refund is treated as a payment,
 * since that's by far the most common credit on a card.
 */
export const isRefundCredit = (txn: Pick<RewardTxn, 'merchant_raw' | 'sms_body'>): boolean =>
  REFUND_PATTERN.test(txn.merchant_raw || '') || REFUND_PATTERN.test(txn.sms_body || '');

export interface RewardEntry {
  id: string;
  card_id: string;
  kind: 'received' | 'redeemed';
  /** Statement date (YYYY-MM-DD) a 'received' entry was credited for. */
  cycle_key: string | null;
  units: number;
  amount: number;
  note: string | null;
  date: string;
}

export interface CycleSummary {
  key: string;
  start: Date;
  end: Date;
  isCurrent: boolean;
  spend: number;
  refunds: number;
  payments: number;
  /** Spend minus refunds — what this cycle adds to the bill. */
  netSpend: number;
  expectedUnits: number;
  expectedValue: number;
  /** Logged actual reward for this cycle, null if nothing logged yet. */
  receivedUnits: number | null;
  txns: RewardTxn[];
}

export interface CardOverview {
  current: CycleSummary;
  last: CycleSummary;
  /** Newest first; always contains current and last, plus any older cycle with activity. */
  cycles: CycleSummary[];
  lastStatementDate: Date;
  dueDate: Date;
  billed: number;
  billedIsManual: boolean;
  paidSinceStatement: number;
  toPay: number;
  rewards: Map<string, TxnReward>;
  /** Points/cashback credited through the last statement (logged actuals win over estimates), minus redemptions. */
  balanceUnits: number;
  redeemedUnits: number;
}

export interface OverviewInput {
  statementDay: number;
  dueDay: number | null;
  program: RewardProgram | null;
  txns: RewardTxn[];
  entries: RewardEntry[];
  /** Manually entered statement amounts, keyed by statement date. */
  billedOverrides: Record<string, number>;
  today?: Date;
}

export const buildCardOverview = ({
  statementDay,
  dueDay,
  program,
  txns,
  entries,
  billedOverrides,
  today = new Date(),
}: OverviewInput): CardOverview => {
  const rewards = program ? computeRewards(program, statementDay, txns) : new Map<string, TxnReward>();
  const currentEnd = cycleEndFor(statementDay, today);
  const currentKey = toDateKey(currentEnd);
  const lastStatementDate = previousStatementDate(statementDay, currentEnd);
  const lastKey = toDateKey(lastStatementDate);

  const cycles = new Map<string, CycleSummary>();
  const cycleFor = (end: Date): CycleSummary => {
    const key = toDateKey(end);
    let cycle = cycles.get(key);
    if (!cycle) {
      cycle = {
        key,
        start: cycleStartFor(statementDay, end),
        end,
        isCurrent: key === currentKey,
        spend: 0,
        refunds: 0,
        payments: 0,
        netSpend: 0,
        expectedUnits: 0,
        expectedValue: 0,
        receivedUnits: null,
        txns: [],
      };
      cycles.set(key, cycle);
    }
    return cycle;
  };

  cycleFor(currentEnd);
  cycleFor(lastStatementDate);

  let paidSinceStatement = 0;
  for (const txn of txns) {
    const when = parseTxnDate(txn.date);
    if (isNaN(when.getTime())) continue;
    const cycle = cycleFor(cycleEndFor(statementDay, when));
    cycle.txns.push(txn);

    if (txn.type === 'debit') {
      cycle.spend += txn.amount;
      const reward = rewards.get(txn.id);
      if (reward) {
        cycle.expectedUnits += reward.units;
        cycle.expectedValue += reward.value;
      }
    } else if (isRefundCredit(txn)) {
      cycle.refunds += txn.amount;
    } else {
      cycle.payments += txn.amount;
      if (startOfDay(when).getTime() > lastStatementDate.getTime()) paidSinceStatement += txn.amount;
    }
  }

  let redeemedUnits = 0;
  for (const entry of entries) {
    if (entry.kind === 'redeemed') {
      redeemedUnits += entry.units;
    } else if (entry.cycle_key) {
      const cycle = cycles.get(entry.cycle_key);
      if (cycle) cycle.receivedUnits = (cycle.receivedUnits || 0) + entry.units;
    }
  }

  let creditedUnits = 0;
  for (const cycle of cycles.values()) {
    cycle.netSpend = cycle.spend - cycle.refunds;
    cycle.txns.sort((a, b) => parseTxnDate(b.date).getTime() - parseTxnDate(a.date).getTime());
    if (!cycle.isCurrent) creditedUnits += cycle.receivedUnits ?? cycle.expectedUnits;
  }
  // A 'received' entry for a cycle with no transactions left (e.g. card re-matched) still counts toward the balance.
  for (const entry of entries) {
    if (entry.kind === 'received' && entry.cycle_key && !cycles.has(entry.cycle_key)) creditedUnits += entry.units;
  }

  const last = cycles.get(lastKey)!;
  const billedIsManual = billedOverrides[lastKey] !== undefined;
  // Relies on last.netSpend having been set in the cycles.values() loop above — must stay after it.
  const billed = billedIsManual ? billedOverrides[lastKey] : Math.max(0, last.netSpend);

  return {
    current: cycles.get(currentKey)!,
    last,
    cycles: [...cycles.values()].sort((a, b) => b.end.getTime() - a.end.getTime()),
    lastStatementDate,
    dueDate: dueDateFor(lastStatementDate, dueDay),
    billed,
    billedIsManual,
    paidSinceStatement,
    toPay: Math.max(0, billed - paidSinceStatement),
    rewards,
    balanceUnits: Math.max(0, creditedUnits - redeemedUnits),
    redeemedUnits,
  };
};

// ─── Formatting ───────────────────────────────────────────────────────────

export const formatRupees = (n: number, decimals = 0): string =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

/** An amount in the card's own unit: "₹12.50" for cashback, "40 pts" for points. */
export const formatUnits = (program: RewardProgram, units: number): string =>
  program.kind === 'points' ? `${Math.round(units).toLocaleString('en-IN')} pts` : formatRupees(units, 2);

const trimNumber = (n: number) => String(Math.round(n * 100) / 100);

export const effectivePercent = (program: RewardProgram, rate: number): number =>
  program.kind === 'points'
    ? program.blockSize > 0 ? (rate / program.blockSize) * program.pointValue * 100 : 0
    : rate;

export const formatTierRate = (program: RewardProgram, tier: RewardTier): string => {
  if (tier.rate <= 0) return '0%';
  if (program.kind === 'cashback') return `${trimNumber(tier.rate)}%`;
  return `${trimNumber(tier.rate)} pts/₹${program.blockSize} (≈${trimNumber(effectivePercent(program, tier.rate))}%)`;
};

export const daysUntil = (d: Date, today: Date = new Date()): number =>
  Math.trunc((startOfDay(d).getTime() - startOfDay(today).getTime()) / 86400000);

export const dueLabel = (days: number): string =>
  days < 0 ? `overdue by ${-days}d` : days === 0 ? 'due today' : `due in ${days}d`;

export const formatShortDate = (d: Date): string => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
