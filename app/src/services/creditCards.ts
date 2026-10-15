import { db } from '../db/schema';
import { getSetting, setSetting } from './appSettings';
import { Card, matchCard } from './cardMatching';
import {
  buildCardOverview,
  CardOverview,
  RewardEntry,
  RewardProgram,
  RewardTier,
  RewardTxn,
  resolveTier,
  rewardsByTier,
  TxnReward,
} from './rewards/engine';

export interface CreditCard extends Card {
  statement_day: number | null;
  due_day: number | null;
  reward_preset: string | null;
  origin: string | null;
  program: RewardProgram | null;
}

export interface CreditCardInput {
  id?: string;
  name: string;
  bank: string | null;
  last4: string;
  credit_limit: number | null;
  statement_day: number;
  due_day: number | null;
  reward_preset: string | null;
  program: RewardProgram | null;
}

const rowsOf = (res: any): any[] => {
  const rows: any = res.rows;
  return rows?._array || rows || [];
};

const parseProgram = (json: string | null): RewardProgram | null => {
  if (!json) return null;
  try {
    const program = JSON.parse(json);
    return program && Array.isArray(program.tiers) ? program : null;
  } catch {
    return null;
  }
};

const toCreditCard = (row: any): CreditCard => ({ ...row, program: parseProgram(row.reward_program) });

export const loadCreditCards = async (): Promise<CreditCard[]> => {
  const res = await db.execute('SELECT * FROM cards WHERE is_credit_card = 1 ORDER BY name COLLATE NOCASE');
  return rowsOf(res).map(toCreditCard);
};

export const getCreditCard = async (id: string): Promise<CreditCard | null> => {
  const res = await db.execute('SELECT * FROM cards WHERE id = ?', [id]);
  const row = rowsOf(res)[0];
  return row ? toCreditCard(row) : null;
};

/**
 * Re-runs SMS → card matching for every transaction that isn't linked to a
 * card yet, so adding a card (or fixing its last 4 digits) also picks up the
 * spends that arrived before it was configured. `resetCardId` first unlinks
 * that card's own transactions, since its old digits may have matched rows
 * the new digits don't.
 */
export const rematchCardTransactions = async (resetCardId?: string): Promise<number> => {
  if (resetCardId) {
    await db.execute('UPDATE transactions SET card_id = NULL WHERE card_id = ?', [resetCardId]);
  }
  const cards: Card[] = rowsOf(await db.execute('SELECT * FROM cards'));
  if (cards.length === 0) return 0;

  const pending = rowsOf(
    await db.execute('SELECT id, sender, sms_body FROM transactions WHERE card_id IS NULL AND sms_body IS NOT NULL')
  );
  let matched = 0;
  for (const txn of pending) {
    const body: string = txn.sms_body || '';
    const card = matchCard(cards, txn.sender || '', body) || matchCard(cards, txn.sender || '', body.replace(/\s+/g, ' '));
    if (card) {
      // Re-checked so a row linked by something else meanwhile (sync, ingest) is never overwritten.
      await db.execute('UPDATE transactions SET card_id = ? WHERE id = ? AND card_id IS NULL', [card.id, txn.id]);
      matched++;
    }
  }
  return matched;
};

// Bump whenever matchCard/extractLast4 learns a new SMS format (v2: bare "HDFC
// Bank Card 0904"), so spends that arrived before the update get linked on the
// next launch instead of waiting for the user to re-save every card.
const CARD_MATCHER_VERSION = '2';
const CARD_MATCHER_KEY = 'card_matcher_version';

export const rematchAfterMatcherUpdate = async (): Promise<void> => {
  if ((await getSetting(CARD_MATCHER_KEY)) === CARD_MATCHER_VERSION) return;
  // No cards yet (fresh install): leave the version unset so the run still
  // happens once cards exist — including ones that arrive through web sync,
  // which, unlike saving a card in the app, doesn't rematch by itself.
  if (!rowsOf(await db.execute('SELECT COUNT(*) AS n FROM cards'))[0]?.n) return;
  await rematchCardTransactions();
  await setSetting(CARD_MATCHER_KEY, CARD_MATCHER_VERSION);
};

export const saveCreditCard = async (input: CreditCardInput): Promise<string> => {
  const programJson = input.program ? JSON.stringify(input.program) : null;
  if (input.id) {
    await db.execute(
      `UPDATE cards SET name = ?, bank = ?, last4 = ?, credit_limit = ?, statement_day = ?, due_day = ?,
         reward_preset = ?, reward_program = ?, is_credit_card = 1
       WHERE id = ?`,
      [
        input.name,
        input.bank,
        input.last4,
        input.credit_limit,
        input.statement_day,
        input.due_day,
        input.reward_preset,
        programJson,
        input.id,
      ]
    );
    await safeRematch(input.id);
    return input.id;
  }

  const id = `card_app_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await db.execute(
    `INSERT INTO cards (id, name, bank, last4, credit_limit, is_credit_card, custom_pattern, created_at,
       statement_day, due_day, reward_preset, reward_program, origin)
     VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?, 'app')`,
    [
      id,
      input.name,
      input.bank,
      input.last4,
      input.credit_limit,
      new Date().toISOString(),
      input.statement_day,
      input.due_day,
      input.reward_preset,
      programJson,
    ]
  );
  await safeRematch();
  return id;
};

export const deleteCreditCard = async (id: string): Promise<void> => {
  await db.execute('DELETE FROM cards WHERE id = ?', [id]);
  await db.execute('UPDATE transactions SET card_id = NULL, reward_tier = NULL WHERE card_id = ?', [id]);
  await db.execute('DELETE FROM reward_entries WHERE card_id = ?', [id]);
  await db.execute('DELETE FROM card_statements WHERE card_id = ?', [id]);
  // Another card may share the same digits now that this one is gone.
  await safeRematch();
};

/**
 * The card row is already committed by the time this runs — a rematch
 * failure (or just being slow on a big SMS history) shouldn't make the
 * save/delete itself look like it failed to the caller.
 */
const safeRematch = async (resetCardId?: string): Promise<void> => {
  try {
    await rematchCardTransactions(resetCardId);
  } catch (e) {
    console.error('Failed to rematch card transactions:', e);
  }
};

const loadCardTxns = async (cardId: string): Promise<RewardTxn[]> =>
  rowsOf(
    await db.execute(
      `SELECT id, amount, type, date, merchant_raw, sms_body, reward_tier
       FROM transactions WHERE card_id = ? ORDER BY date ASC`,
      [cardId]
    )
  );

export const loadRewardEntries = async (cardId: string): Promise<RewardEntry[]> =>
  rowsOf(await db.execute('SELECT * FROM reward_entries WHERE card_id = ? ORDER BY date DESC', [cardId]));

const loadBilledOverrides = async (cardId: string): Promise<Record<string, number>> => {
  const overrides: Record<string, number> = {};
  for (const row of rowsOf(
    await db.execute('SELECT statement_date, billed_amount FROM card_statements WHERE card_id = ?', [cardId])
  )) {
    overrides[row.statement_date] = row.billed_amount;
  }
  return overrides;
};

/** Null when the card has no statement day yet — there's no cycle to compute dues against. */
export const getCardOverview = async (card: CreditCard): Promise<CardOverview | null> => {
  if (!card.statement_day) return null;
  const [txns, entries, billedOverrides] = await Promise.all([
    loadCardTxns(card.id),
    loadRewardEntries(card.id),
    loadBilledOverrides(card.id),
  ]);
  return buildCardOverview({
    statementDay: card.statement_day,
    dueDay: card.due_day,
    program: card.program,
    txns,
    entries,
    billedOverrides,
  });
};

/** Pass null to go back to the card's default / keyword-matched tier. */
export const setTransactionRewardTier = async (txnId: string, tierId: string | null): Promise<void> => {
  // updated_at is deliberately left alone — the tier is phone-only and
  // bumping it would make web sync treat this row as locally edited.
  await db.execute('UPDATE transactions SET reward_tier = ? WHERE id = ?', [tierId, txnId]);
};

export const setStatementAmount = async (cardId: string, statementDate: string, amount: number | null) => {
  const id = `${cardId}:${statementDate}`;
  if (amount === null) {
    await db.execute('DELETE FROM card_statements WHERE id = ?', [id]);
    return;
  }
  await db.execute(
    `INSERT INTO card_statements (id, card_id, statement_date, billed_amount, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET billed_amount = excluded.billed_amount`,
    [id, cardId, statementDate, amount, new Date().toISOString()]
  );
};

export const addRewardEntry = async (entry: Omit<RewardEntry, 'id' | 'date'> & { date?: string }) => {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO reward_entries (id, card_id, kind, cycle_key, units, amount, note, date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `rwd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      entry.card_id,
      entry.kind,
      entry.cycle_key,
      entry.units,
      entry.amount,
      entry.note,
      entry.date || now,
      now,
    ]
  );
};

/** Replaces whatever was logged as received for a statement — one figure per cycle, straight off the statement. */
export const setReceivedReward = async (card: CreditCard, cycleKey: string, units: number | null) => {
  await db.execute(`DELETE FROM reward_entries WHERE card_id = ? AND kind = 'received' AND cycle_key = ?`, [
    card.id,
    cycleKey,
  ]);
  if (units === null || !card.program) return;
  await addRewardEntry({
    card_id: card.id,
    kind: 'received',
    cycle_key: cycleKey,
    units,
    amount: card.program.kind === 'points' ? units * card.program.pointValue : units,
    note: null,
  });
};

export const deleteRewardEntry = async (id: string) => {
  await db.execute('DELETE FROM reward_entries WHERE id = ?', [id]);
};

export interface CardRewardContext {
  card: CreditCard;
  /** Everything on the card, for reward math that has to honour caps and thresholds. */
  txns: RewardTxn[];
}

/** Null when the card row is gone (deleted since the transaction was linked). */
export const loadCardRewardContext = async (cardId: string): Promise<CardRewardContext | null> => {
  const card = await getCreditCard(cardId);
  return card ? { card, txns: await loadCardTxns(card.id) } : null;
};

export interface TransactionRewardInfo {
  card: CreditCard;
  program: RewardProgram;
  /** The tier in effect: the one picked for it, else autoTierId. */
  tier: RewardTier;
  /** What merchant keywords / the card default give it when nothing is picked. */
  autoTierId: string;
  isExplicit: boolean;
  /** Null when the engine skips the spend (zero amount, unreadable date). */
  reward: TxnReward | null;
  /** What the spend would earn on each tier, caps and thresholds applied; empty when skipped. */
  byTier: Map<string, TxnReward>;
}

/**
 * Reward for one transaction, computed against the card's full history so caps and thresholds are honoured.
 * Shared by the transaction detail sheet and the Review tab so both label and value a spend the same way.
 * If the card has no statement_day set, computeRewards falls back to calendar-month cycles for cap bucketing
 * (see CALENDAR_MONTH in engine.ts) — sensible until the user fills in a real statement day.
 */
export const rewardInfoFor = (card: CreditCard, txns: RewardTxn[], txnId: string): TransactionRewardInfo | null => {
  const program = card.program;
  if (!program) return null;
  const txn = txns.find(t => t.id === txnId);
  if (!txn || txn.type !== 'debit') return null;
  const tier = resolveTier(program, txn);
  const autoTier = resolveTier(program, { ...txn, reward_tier: null });
  if (!tier || !autoTier) return null;
  // Valuing the spend on its own tier is the same as computeRewards on the untouched history.
  const byTier = rewardsByTier(program, card.statement_day, txns, txnId);
  return {
    card,
    program,
    tier,
    autoTierId: autoTier.id,
    isExplicit: !!txn.reward_tier && tier.id === txn.reward_tier,
    reward: byTier.get(tier.id) || null,
    byTier,
  };
};

export const getTransactionReward = async (txnId: string, cardId: string): Promise<TransactionRewardInfo | null> => {
  const ctx = await loadCardRewardContext(cardId);
  return ctx ? rewardInfoFor(ctx.card, ctx.txns, txnId) : null;
};
