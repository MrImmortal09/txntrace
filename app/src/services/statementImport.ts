import { db } from '../db/schema';
import { ParsedTransaction } from '../types';

/**
 * Statement rows are mostly spends the phone already saw as SMS. A row counts
 * as already tracked when an existing transaction on the same card has the
 * same type and amount within this many days — a statement shows the posting
 * date, which can trail the SMS (swipe time) by a day or two.
 */
const MATCH_WINDOW_DAYS = 2;
const DAY_MS = 86400000;

export interface ExistingTxn {
  id: string;
  amount: number;
  type: string;
  date: string;
}

export interface PlannedRow {
  row: ParsedTransaction;
  /** Stable for the same statement line, so re-importing a statement is a no-op. */
  id: string;
  /** The existing transaction this row duplicates, or null if it's new. */
  matchedId: string | null;
}

const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/**
 * Pairs each statement row with at most one existing transaction (closest
 * date wins), so two identical ₹100 spends on the statement only swallow two
 * SMS rows, never the same one twice.
 */
export const planStatementImport = (rows: ParsedTransaction[], existing: ExistingTxn[], scope: string): PlannedRow[] => {
  const used = new Set<string>();
  const seen = new Map<string, number>();
  const candidates = existing.map(e => ({ ...e, when: new Date(e.date).getTime() })).filter(e => !isNaN(e.when));

  return rows.map(row => {
    const base = `${scope}|${dayKey(row.timestamp)}|${row.type}|${row.amount.toFixed(2)}|${row.reference || row.merchant || ''}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    const id = `stmt_${hash(base)}_${n}`;

    let best: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      if (used.has(c.id) || c.type !== row.type || Math.abs(c.amount - row.amount) >= 0.01) continue;
      const gap = Math.abs(c.when - row.timestamp);
      if (gap > MATCH_WINDOW_DAYS * DAY_MS + DAY_MS / 2) continue;
      if (!best || gap < Math.abs(best.when - row.timestamp)) best = c;
    }
    if (best) used.add(best.id);
    return { row, id, matchedId: best?.id ?? null };
  });
};

const rowsOf = (res: any): any[] => {
  const rows: any = res.rows;
  return rows?._array || rows || [];
};

/** Loads what's already tracked for the card (or bank, when not importing onto a card) around the statement's dates. */
export const previewStatementImport = async (
  rows: ParsedTransaction[],
  cardId: string | null,
  bankName: string
): Promise<PlannedRow[]> => {
  if (rows.length === 0) return [];
  const times = rows.map(r => r.timestamp);
  const from = new Date(Math.min(...times) - (MATCH_WINDOW_DAYS + 1) * DAY_MS).toISOString();
  const to = new Date(Math.max(...times) + (MATCH_WINDOW_DAYS + 1) * DAY_MS).toISOString();
  const existing = rowsOf(
    cardId
      ? await db.execute('SELECT id, amount, type, date FROM transactions WHERE card_id = ? AND date BETWEEN ? AND ?', [cardId, from, to])
      : await db.execute('SELECT id, amount, type, date FROM transactions WHERE bank = ? AND card_id IS NULL AND date BETWEEN ? AND ?', [
          bankName,
          from,
          to,
        ])
  );
  return planStatementImport(rows, existing, cardId || bankName);
};

/** Inserts the rows not already tracked. Returns how many were added. */
export const saveStatementImport = async (planned: PlannedRow[], cardId: string | null): Promise<number> => {
  const now = new Date().toISOString();
  let added = 0;
  for (const { row, id, matchedId } of planned) {
    if (matchedId) continue;
    // Statement lines carry a day, not a time — noon keeps them on that local day in any timezone.
    const d = new Date(row.timestamp);
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString();
    const res = await db.execute(
      `INSERT OR IGNORE INTO transactions
        (id, bank, amount, type, merchant_raw, date, source, reference, account_last4, card_id, reviewed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'statement', ?, ?, ?, 0, ?)`,
      [id, row.bankName, row.amount, row.type, row.merchant || '', date, row.reference, row.accountLast4, cardId, now]
    );
    added += res.rowsAffected || 0;
  }
  return added;
};
