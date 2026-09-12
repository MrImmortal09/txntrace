import { normalizeName, applySettlement, createSplit, settleDebtToFriend, autoMatchCreditTransaction, markTransactionAsMine } from '../src/services/settlements';
import { db } from '../src/db/schema';

// Mock SQLite db
jest.mock('../src/db/schema', () => {
  const store: Record<string, any[]> = {
    transactions: [],
    splits: [],
    settlements: [],
    contact_aliases: [],
  };

  return {
    db: {
      execute: jest.fn(async (query: string, params: any[] = []) => {
        const q = query.trim().toUpperCase();

        if (q.startsWith('SELECT')) {
          if (q.includes('FROM SPLITS') && q.includes('ORDER BY T.DATE ASC')) {
            const contactId = params[0];
            const openSplits = store.splits.filter(s => s.contact_id === contactId && s.settled === 0);
            return { rows: { _array: openSplits } };
          }
          if (q.includes('FROM SETTLEMENTS') && q.includes('UNAPPLIED_AMOUNT > 0')) {
            const contactId = params[0];
            const credits = store.settlements.filter(s => s.contact_id === contactId && (s.unapplied_amount || 0) > 0);
            return { rows: { _array: credits } };
          }
          if (q.includes('FROM CONTACT_ALIASES WHERE NORMALIZED_NAME = ?')) {
            const norm = params[0];
            const found = store.contact_aliases.filter(a => a.normalized_name === norm);
            return { rows: { _array: found } };
          }
          if (q.includes('FROM ( SELECT CONTACT_ID, CONTACT_NAME FROM CONTACT_ALIASES')) {
            const norm = params[0];
            const foundAlias = store.contact_aliases.find(a => a.normalized_name === norm);
            if (foundAlias) return { rows: { _array: [foundAlias] } };
            const foundSplit = store.splits.find(s => (s.contact_name || '').toUpperCase() === norm);
            if (foundSplit) return { rows: { _array: [foundSplit] } };
            const foundSettle = store.settlements.find(s => (s.contact_name || '').toUpperCase() === norm);
            if (foundSettle) return { rows: { _array: [foundSettle] } };
            return { rows: { _array: [] } };
          }
          if (q.includes('FROM TRANSACTIONS WHERE NEEDS_CONTACT_MATCH = 1')) {
            const raw = params[0];
            const txns = store.transactions.filter(t => t.needs_contact_match === 1 && t.merchant_raw === raw && t.type === 'credit');
            return { rows: { _array: txns } };
          }
        }

        if (q.startsWith('INSERT INTO SETTLEMENTS')) {
          const [id, contact_id, contact_name, amount, unapplied_amount, transaction_id, matched_split_id, date, created_at] = params;
          store.settlements.push({
            id, contact_id, contact_name, amount, unapplied_amount, transaction_id, matched_split_id, date, created_at
          });
          return { rowsAffected: 1 };
        }

        if (q.startsWith('INSERT INTO SPLITS')) {
          const [id, transaction_id, contact_id, contact_name, amount_owed, original_amount, settled] = params;
          store.splits.push({
            id, transaction_id, contact_id, contact_name, amount_owed, original_amount, settled
          });
          return { rowsAffected: 1 };
        }

        if (q.startsWith('INSERT OR REPLACE INTO CONTACT_ALIASES')) {
          const [id, normalized_name, raw_name, contact_id, contact_name, created_at] = params;
          const idx = store.contact_aliases.findIndex(a => a.normalized_name === normalized_name);
          const row = { id, normalized_name, raw_name, contact_id, contact_name, created_at };
          if (idx >= 0) store.contact_aliases[idx] = row;
          else store.contact_aliases.push(row);
          return { rowsAffected: 1 };
        }

        if (q.startsWith('UPDATE SPLITS')) {
          if (q.includes('SET SETTLED = 1, AMOUNT_OWED = 0')) {
            const splitId = params[0];
            const split = store.splits.find(s => s.id === splitId);
            if (split) { split.settled = 1; split.amount_owed = 0; }
          } else if (q.includes('SET AMOUNT_OWED = ?')) {
            const [newOwed, splitId] = params;
            const split = store.splits.find(s => s.id === splitId);
            if (split) { split.amount_owed = newOwed; }
          }
          return { rowsAffected: 1 };
        }

        if (q.startsWith('UPDATE SETTLEMENTS')) {
          if (q.includes('SET UNAPPLIED_AMOUNT = ? WHERE ID = ?')) {
            const [val, id] = params;
            const item = store.settlements.find(s => s.id === id);
            if (item) item.unapplied_amount = val;
          } else if (q.includes('SET UNAPPLIED_AMOUNT = 0 WHERE ID = ?')) {
            const [id] = params;
            const item = store.settlements.find(s => s.id === id);
            if (item) item.unapplied_amount = 0;
          }
          return { rowsAffected: 1 };
        }

        if (q.startsWith('UPDATE TRANSACTIONS')) {
          const txnId = params[params.length - 1];
          const txn = store.transactions.find(t => t.id === txnId);
          if (txn) {
            if (q.includes('REVIEWED = 1')) txn.reviewed = 1;
            if (q.includes('NEEDS_CONTACT_MATCH = 0')) txn.needs_contact_match = 0;
          }
          return { rowsAffected: 1 };
        }

        return { rows: { _array: [] }, rowsAffected: 1 };
      }),
      _store: store,
    },
  };
});

describe('Settlement Balance & Overpayment Tracking', () => {
  const mockDb = (db as any)._store;

  beforeEach(() => {
    mockDb.transactions = [];
    mockDb.splits = [];
    mockDb.settlements = [];
    mockDb.contact_aliases = [];
    jest.clearAllMocks();
  });

  test('Friend owes ₹410, sends ₹1000 -> remaining ₹590 is recorded as owed to friend', async () => {
    // 1. Initial split of ₹410 owed by friend Anurag
    mockDb.splits.push({
      id: 'split_1',
      transaction_id: 'txn_exp_1',
      contact_id: 'c1',
      contact_name: 'Anurag',
      amount_owed: 410,
      original_amount: 410,
      settled: 0,
    });

    // 2. Settlement of ₹1000 arrives from Anurag
    const result = await applySettlement('c1', 'Anurag', 1000, 'txn_credit_1');

    // Split 1 should be fully settled
    expect(mockDb.splits[0].settled).toBe(1);
    expect(mockDb.splits[0].amount_owed).toBe(0);

    // Settlement should record ₹590 unapplied
    expect(result.unappliedAmount).toBe(590);
    expect(mockDb.settlements[0].unapplied_amount).toBe(590);

    // Net balance: open splits (0) - unapplied settlements (590) = -590 (you owe ₹590)
    const openSplits = mockDb.splits.filter((s: any) => !s.settled).reduce((acc: number, s: any) => acc + s.amount_owed, 0);
    const unapplied = mockDb.settlements.reduce((acc: number, s: any) => acc + (s.unapplied_amount || 0), 0);
    const netBalance = openSplits - unapplied;
    expect(netBalance).toBe(-590);
  });

  test('Subsequent expense split of ₹200 offsets existing credit balance from ₹590 to ₹390', async () => {
    // Start with ₹590 unapplied settlement (you owe friend ₹590)
    mockDb.settlements.push({
      id: 'settle_1',
      contact_id: 'c1',
      contact_name: 'Anurag',
      amount: 1000,
      unapplied_amount: 590,
      transaction_id: 'txn_credit_1',
      matched_split_id: null,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    // New split created for ₹200
    const splitResult = await createSplit('txn_exp_2', 'c1', 'Anurag', 200);

    // The ₹200 should be immediately settled
    expect(splitResult.settled).toBe(true);
    expect(splitResult.amountOwed).toBe(0);

    // Settlement unapplied amount reduced to 390
    expect(mockDb.settlements[0].unapplied_amount).toBe(390);

    // Net balance is -390 (you owe ₹390)
    const openSplits = mockDb.splits.filter((s: any) => !s.settled).reduce((acc: number, s: any) => acc + s.amount_owed, 0);
    const unapplied = mockDb.settlements.reduce((acc: number, s: any) => acc + (s.unapplied_amount || 0), 0);
    expect(openSplits - unapplied).toBe(-390);
  });

  test('Subsequent expense split of ₹500 consumes remaining ₹390 and leaves ₹110 owed by friend', async () => {
    // Start with ₹390 unapplied settlement
    mockDb.settlements.push({
      id: 'settle_1',
      contact_id: 'c1',
      contact_name: 'Anurag',
      amount: 1000,
      unapplied_amount: 390,
      transaction_id: 'txn_credit_1',
      matched_split_id: null,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    // New split for ₹500
    const splitResult = await createSplit('txn_exp_3', 'c1', 'Anurag', 500);

    // It should have ₹110 remaining owed and not settled
    expect(splitResult.settled).toBe(false);
    expect(splitResult.amountOwed).toBe(110);

    // Settlement unapplied amount should now be 0
    expect(mockDb.settlements[0].unapplied_amount).toBe(0);

    // Net balance: 110 - 0 = +110 (friend owes you ₹110)
    const openSplits = mockDb.splits.filter((s: any) => !s.settled).reduce((acc: number, s: any) => acc + s.amount_owed, 0);
    const unapplied = mockDb.settlements.reduce((acc: number, s: any) => acc + (s.unapplied_amount || 0), 0);
    expect(openSplits - unapplied).toBe(110);
  });

  test('settleDebtToFriend clears unapplied debt when user repays friend', async () => {
    mockDb.settlements.push({
      id: 'settle_1',
      contact_id: 'c1',
      contact_name: 'Anurag',
      amount: 1000,
      unapplied_amount: 590,
      transaction_id: 'txn_credit_1',
      matched_split_id: null,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    await settleDebtToFriend('c1', 'Anurag', 590, 'txn_repay_1');
    expect(mockDb.settlements[0].unapplied_amount).toBe(0);
  });

  test('autoMatchCreditTransaction matches known contact and applies settlement', async () => {
    mockDb.contact_aliases.push({
      id: 'ANURAG YADAV',
      normalized_name: 'ANURAG YADAV',
      raw_name: 'Mr Anurag Yadav',
      contact_id: 'c1',
      contact_name: 'Anurag',
      created_at: new Date().toISOString(),
    });

    const txn = { id: 'txn_10k', merchant_raw: 'Mr Anurag Yadav', amount: 10000 };
    const result = await autoMatchCreditTransaction(txn);

    expect(result.matched).toBe(true);
    expect(result.contactId).toBe('c1');
    expect(result.contactName).toBe('Anurag');
    expect(result.unappliedAmount).toBe(10000);
    expect(mockDb.settlements.length).toBe(1);
    expect(mockDb.settlements[0].amount).toBe(10000);
    expect(mockDb.settlements[0].unapplied_amount).toBe(10000);
  });

  test('markTransactionAsMine sets reviewed = 1 and needs_contact_match = 0', async () => {
    mockDb.transactions.push({
      id: 'txn_mine',
      amount: 10000,
      type: 'credit',
      reviewed: 0,
      needs_contact_match: 1,
    });

    await markTransactionAsMine('txn_mine');
    expect(mockDb.transactions[0].reviewed).toBe(1);
    expect(mockDb.transactions[0].needs_contact_match).toBe(0);
  });
});
