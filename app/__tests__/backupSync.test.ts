import {
  checkServerBackupStatus,
  backupLocalToServer,
  restoreFromServer,
  syncFromServer,
  syncSplitsFromServer,
  syncSettlementsFromServer,
  setAuthToken,
} from '../src/services/webSync';
import { db } from '../src/db/schema';
import { setSetting } from '../src/services/appSettings';

// Mock react-native-contacts
jest.mock('react-native-contacts', () => ({
  __esModule: true,
  default: {
    checkPermission: jest.fn(async () => 'authorized'),
    getAll: jest.fn(async () => []),
  },
  checkPermission: jest.fn(async () => 'authorized'),
  getAll: jest.fn(async () => []),
}));

// Mock appSettings
const settingsStore: Record<string, string> = {};
jest.mock('../src/services/appSettings', () => ({
  getSetting: jest.fn(async (key: string) => settingsStore[key] || null),
  setSetting: jest.fn(async (key: string, value: string) => {
    settingsStore[key] = value;
  }),
}));

// Mock DB store
const dbStore: Record<string, any[]> = {
  transactions: [],
  splits: [],
  settlements: [],
  cards: [],
};

jest.mock('../src/db/schema', () => ({
  db: {
    execute: jest.fn(async (query: string, params: any[] = []) => {
      const q = query.trim().toUpperCase();
      const normalizedQ = q.replace(/\s+/g, ' ');

      if (normalizedQ.startsWith('SELECT * FROM TRANSACTIONS')) {
        return { rows: { _array: [...dbStore.transactions] } };
      }
      if (normalizedQ.startsWith('SELECT S.ID, S.TRANSACTION_ID')) {
        return { rows: { _array: [...dbStore.splits] } };
      }
      if (normalizedQ.startsWith('SELECT * FROM SETTLEMENTS')) {
        return { rows: { _array: [...dbStore.settlements] } };
      }
      if (normalizedQ.startsWith('SELECT * FROM CARDS')) {
        return { rows: { _array: [...dbStore.cards] } };
      }
      if (normalizedQ.startsWith('DELETE FROM CARDS')) {
        dbStore.cards = [];
        return { rowsAffected: 1 };
      }
      if (normalizedQ.startsWith('INSERT INTO TRANSACTIONS')) {
        const id = params[0];
        const existingIdx = dbStore.transactions.findIndex(t => t.id === id);
        const item = {
          id: params[0],
          bank: params[1],
          amount: params[2],
          type: params[3],
          merchant_raw: params[4],
          date: params[5],
          source: params[6],
          category: params[7],
          note: params[8],
          reviewed: params[9],
          created_at: params[10],
          updated_at: params[11],
          reference: params[12],
          account_last4: params[13],
          balance: params[14],
          sender: params[15],
          sms_body: params[16],
          needs_contact_match: params[17],
          card_id: params[18],
        };
        if (existingIdx >= 0) {
          dbStore.transactions[existingIdx] = item;
        } else {
          dbStore.transactions.push(item);
        }
        return { rowsAffected: 1 };
      }
      if (normalizedQ.startsWith('INSERT INTO SPLITS')) {
        const id = params[0];
        const existingIdx = dbStore.splits.findIndex(s => s.id === id);
        const item = {
          id: params[0],
          transaction_id: params[1],
          contact_id: params[2],
          contact_name: params[3],
          amount_owed: params[4],
          original_amount: params[5],
          settled: params[6],
        };
        if (existingIdx >= 0) {
          dbStore.splits[existingIdx] = item;
        } else {
          dbStore.splits.push(item);
        }
        return { rowsAffected: 1 };
      }
      if (normalizedQ.startsWith('INSERT INTO SETTLEMENTS')) {
        const id = params[0];
        const existingIdx = dbStore.settlements.findIndex(s => s.id === id);
        const item = {
          id: params[0],
          contact_id: params[1],
          contact_name: params[2],
          amount: params[3],
          unapplied_amount: params[4],
          transaction_id: params[5],
          matched_split_id: params[6],
          date: params[7],
          created_at: params[8],
        };
        if (existingIdx >= 0) {
          dbStore.settlements[existingIdx] = item;
        } else {
          dbStore.settlements.push(item);
        }
        return { rowsAffected: 1 };
      }
      if (normalizedQ.startsWith('INSERT INTO CARDS')) {
        const item = {
          id: params[0],
          name: params[1],
          bank: params[2],
          last4: params[3],
          credit_limit: params[4],
          is_credit_card: params[5],
          custom_pattern: params[6],
          created_at: params[7],
        };
        dbStore.cards.push(item);
        return { rowsAffected: 1 };
      }

      return { rows: { _array: [] }, rowsAffected: 0 };
    }),
  },
}));

// Global fetch mock
const originalFetch = (global as any).fetch;

describe('Cloud Backup & Server Conflict Resolution', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    Object.keys(settingsStore).forEach(k => delete settingsStore[k]);
    dbStore.transactions = [];
    dbStore.splits = [];
    dbStore.settlements = [];
    dbStore.cards = [];
    await setAuthToken('test_jwt_token');
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it('checkServerBackupStatus correctly detects existing server data and counts', async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/backup/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            exists: true,
            transaction_count: 42,
            split_count: 5,
            settlement_count: 2,
            card_count: 3,
            contact_count: 10,
            last_updated: '2026-09-12T10:00:00Z',
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const status = await checkServerBackupStatus();
    expect(status.exists).toBe(true);
    expect(status.transactionCount).toBe(42);
    expect(status.splitCount).toBe(5);
    expect(status.settlementCount).toBe(2);
    expect(status.cardCount).toBe(3);
    expect(status.contactCount).toBe(10);
    expect(status.lastUpdated).toBe('2026-09-12T10:00:00Z');
  });

  it('checkServerBackupStatus returns exists=false when server has no data', async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/backup/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            exists: false,
            transaction_count: 0,
            split_count: 0,
            settlement_count: 0,
            card_count: 0,
            contact_count: 0,
            last_updated: null,
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const status = await checkServerBackupStatus();
    expect(status.exists).toBe(false);
    expect(status.transactionCount).toBe(0);
  });

  it('backupLocalToServer sends local transactions, splits, settlements, and cards with overwrite flag', async () => {
    // Populate local dbStore
    dbStore.transactions.push({
      id: 'tx_1',
      bank: 'HDFC',
      amount: 450,
      type: 'debit',
      merchant_raw: 'Swiggy',
      date: '2026-09-12T12:00:00Z',
      source: 'sms',
      category: 'Food',
      note: 'Dinner',
      reviewed: 1,
      created_at: '2026-09-12T12:00:00Z',
      updated_at: '2026-09-12T12:00:00Z',
    });
    dbStore.splits.push({
      id: 'sp_1',
      transaction_id: 'tx_1',
      contact_id: 'c_1',
      contact_name: 'Rahul',
      amount_owed: 225,
      original_amount: 225,
      settled: 0,
    });
    dbStore.settlements.push({
      id: 'st_1',
      contact_id: 'c_1',
      contact_name: 'Rahul',
      amount: 225,
      unapplied_amount: 0,
      transaction_id: 'tx_credit_1',
      matched_split_id: 'sp_1',
      date: '2026-09-12T13:00:00Z',
      created_at: '2026-09-12T13:00:00Z',
    });

    let uploadedPayload: any = null;
    (global as any).fetch = jest.fn(async (url: string, opts: any) => {
      if (url.endsWith('/api/backup/upload')) {
        uploadedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            transactions_count: 1,
            splits_count: 1,
            settlements_count: 1,
            cards_count: 0,
            contacts_count: 0,
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const res = await backupLocalToServer({ overwrite: true });

    expect(res.success).toBe(true);
    expect(res.transactions).toBe(1);
    expect(res.splits).toBe(1);
    expect(res.settlements).toBe(1);

    expect(uploadedPayload).toBeDefined();
    expect(uploadedPayload.overwrite).toBe(true);
    expect(uploadedPayload.transactions.length).toBe(1);
    expect(uploadedPayload.transactions[0].id).toBe('tx_1');
    expect(uploadedPayload.splits.length).toBe(1);
    expect(uploadedPayload.splits[0].id).toBe('sp_1');
    expect(uploadedPayload.settlements.length).toBe(1);
    expect(uploadedPayload.settlements[0].id).toBe('st_1');
  });

  it('restoreFromServer pulls all remote transactions, cards, splits, and settlements into local DB', async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes('/api/transactions/export')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            transactions: [
              {
                id: 'tx_server_1',
                bank: 'ICICI',
                amount: 1200,
                type: 'debit',
                merchant_raw: 'Amazon',
                date: '2026-09-11T15:00:00Z',
                created_at: '2026-09-11T15:00:00Z',
                updated_at: '2026-09-11T15:00:00Z',
                reviewed: 1,
              },
            ],
          }),
        } as any;
      }
      if (url.endsWith('/api/cards/export')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cards: [
              {
                id: 'card_1',
                name: 'HDFC Millennia',
                bank: 'HDFC',
                last4: '1234',
                credit_limit: 100000,
                is_credit_card: 1,
                created_at: '2026-09-10T00:00:00Z',
              },
            ],
          }),
        } as any;
      }
      if (url.includes('/api/splits/export')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            splits: [
              {
                id: 'split_server_1',
                transaction_id: 'tx_server_1',
                contact_id: 'c_2',
                contact_name: 'Ananya',
                amount_owed: 600,
                original_amount: 600,
                settled: 0,
                created_at: '2026-09-11T15:05:00Z',
              },
            ],
          }),
        } as any;
      }
      if (url.includes('/api/settlements/export')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            settlements: [
              {
                id: 'settle_server_1',
                contact_id: 'c_2',
                contact_name: 'Ananya',
                amount: 300,
                unapplied_amount: 0,
                transaction_id: 'tx_credit_2',
                matched_split_id: 'split_server_1',
                date: '2026-09-12T09:00:00Z',
                created_at: '2026-09-12T09:00:00Z',
              },
            ],
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const result = await restoreFromServer();

    expect(result.transactions).toBe(1);
    expect(result.cards).toBe(1);
    expect(result.splits).toBe(1);
    expect(result.settlements).toBe(1);

    expect(dbStore.transactions.some(t => t.id === 'tx_server_1')).toBe(true);
    expect(dbStore.cards.some(c => c.id === 'card_1')).toBe(true);
    expect(dbStore.splits.some(s => s.id === 'split_server_1')).toBe(true);
    expect(dbStore.settlements.some(st => st.id === 'settle_server_1')).toBe(true);
  });

  it('conflict resolution decision: when server data is found, user can choose pull (keep server) or overwrite with local', async () => {
    // Simulate server having existing records
    (global as any).fetch = jest.fn(async (url: string, opts?: any) => {
      if (url.endsWith('/api/backup/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            exists: true,
            transaction_count: 10,
            split_count: 2,
            settlement_count: 1,
          }),
        } as any;
      }
      if (url.endsWith('/api/backup/upload')) {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            transactions_count: body.transactions.length,
            splits_count: body.splits.length,
            settlements_count: body.settlements.length,
          }),
        } as any;
      }
      if (url.includes('/api/transactions/export')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ transactions: [{ id: 'server_tx' }] }),
        } as any;
      }
      if (url.endsWith('/api/cards/export')) {
        return { ok: true, status: 200, json: async () => ({ cards: [] }) } as any;
      }
      if (url.includes('/api/splits/export')) {
        return { ok: true, status: 200, json: async () => ({ splits: [] }) } as any;
      }
      if (url.includes('/api/settlements/export')) {
        return { ok: true, status: 200, json: async () => ({ settlements: [] }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    // 1. Check status
    const status = await checkServerBackupStatus();
    expect(status.exists).toBe(true);

    // Decision A: User chooses "Keep Server Data" (pull server)
    const pullResult = await restoreFromServer();
    expect(pullResult.transactions).toBe(1);

    // Decision B: User chooses "Overwrite with Local"
    dbStore.transactions = [{ id: 'my_local_tx', amount: 500, created_at: '2026-09-12' }];
    const overwriteResult = await backupLocalToServer({ overwrite: true });
    expect(overwriteResult.success).toBe(true);
    expect(overwriteResult.transactions).toBe(1);
  });

  it('backupLocalToServer updates last sync cursors to latest backed up timestamps', async () => {
    dbStore.transactions = [
      { id: 'tx_1', created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-12T15:30:00Z' },
    ];
    dbStore.splits = [
      { id: 'sp_1', transaction_id: 'tx_1', contact_id: 'c1', contact_name: 'A', amount_owed: 100, settled: 0, created_at: '2026-09-12T14:00:00Z' },
    ];
    dbStore.settlements = [
      { id: 'st_1', contact_id: 'c1', contact_name: 'A', amount: 50, date: '2026-09-12', created_at: '2026-09-12T16:00:00Z' },
    ];

    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        transactions_count: 1,
        splits_count: 1,
        settlements_count: 1,
        cards_count: 0,
        contacts_count: 0,
      }),
    } as any));

    await backupLocalToServer({ overwrite: false });

    expect(settingsStore['web_sync_last_created_at']).toBe('2026-09-12T15:30:00Z');
    expect(settingsStore['web_sync_last_split_created_at']).toBe('2026-09-12T14:00:00Z');
    expect(settingsStore['web_sync_last_settlement_created_at']).toBe('2026-09-12T16:00:00Z');
  });
});
