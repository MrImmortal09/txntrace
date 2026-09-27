import { db } from '../db/schema';
import { Card, matchCard } from './cardMatching';
import {
  buildCardOverview,
  CardOverview,
  computeRewards,
  RewardEntry,
  RewardProgram,
  RewardTier,
  RewardTxn,
  resolveTier,
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
      await db.execute('UPDATE transactions SET card_id = ? WHERE id = ?', [card.id, txn.id]);
      matched++;
    }
  }
  return matched;
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
    await rematchCardTransactions(input.id);
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
  await rematchCardTransactions();
  return id;
};

export const deleteCreditCard = async (id: string): Promise<void> => {
  await db.execute('DELETE FROM cards WHERE id = ?', [id]);
  await db.execute('UPDATE transactions SET card_id = NULL, reward_tier = NULL WHERE card_id = ?', [id]);
  await db.execute('DELETE FROM reward_entries WHERE card_id = ?', [id]);
  await db.execute('DELETE FROM card_statements WHERE card_id = ?', [id]);
  // Another card may share the same digits now that this one is gone.
  await rematchCardTransactions();
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

export interface TransactionRewardInfo {
  card: CreditCard;
  program: RewardProgram;
  tier: RewardTier;
  isExplicit: boolean;
  reward: TxnReward | null;
}

/** Reward for one transaction, computed against the card's full history so caps and thresholds are honoured. */
export const getTransactionReward = async (txnId: string, cardId: string): Promise<TransactionRewardInfo | null> => {
  const card = await getCreditCard(cardId);
  if (!card?.program) return null;
  const txns = await loadCardTxns(card.id);
  const txn = txns.find(t => t.id === txnId);
  if (!txn || txn.type !== 'debit') return null;
  const tier = resolveTier(card.program, txn);
  if (!tier) return null;
  const rewards = computeRewards(card.program, card.statement_day, txns);
  return {
    card,
    program: card.program,
    tier,
    isExplicit: !!txn.reward_tier && tier.id === txn.reward_tier,
    reward: rewards.get(txnId) || null,
  };
};
