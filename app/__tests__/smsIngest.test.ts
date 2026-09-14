import { Platform } from 'react-native';
import { processSMSBatch } from '../src/parsers/sms';
import { checkNewMessages } from '../src/services/smsIngest';
import SharedSMSStore from 'shared-sms-store';
import { db } from '../src/db/schema';

// Mocks
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn() })),
}));

const mockExecutedQueries: { query: string; params: any[] }[] = [];
let mockCards: any[] = [];
let mockInsertRowsAffected = 1;

jest.mock('../src/db/schema', () => ({
  db: {
    execute: jest.fn(async (query: string, params: any[] = []) => {
      mockExecutedQueries.push({ query, params });
      const q = query.trim().toUpperCase();

      if (q.startsWith('SELECT * FROM CARDS')) {
        return { rows: { _array: mockCards } };
      }

      if (q.startsWith('INSERT OR IGNORE INTO TRANSACTIONS')) {
        return { rowsAffected: mockInsertRowsAffected, insertId: 1 };
      }

      if (q.startsWith('INSERT OR IGNORE INTO SMS_LOG')) {
        return { rowsAffected: 1, insertId: 1 };
      }

      return { rows: { _array: [] }, rowsAffected: 0 };
    }),
  },
}));

jest.mock('shared-sms-store', () => ({
  readNewMessages: jest.fn(),
  peekMessages: jest.fn(),
  writeTestValue: jest.fn(),
  getIngestStats: jest.fn(),
}));

describe('SMS Ingestion and Batch Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecutedQueries.length = 0;
    mockCards = [];
    mockInsertRowsAffected = 1;
    (Platform as any).OS = 'ios';
  });

  it('parses standard bank debit SMS and inserts transaction and log', async () => {
    const rawSms = [
      {
        id: 'msg-1',
        sender: 'AD-HDFCBK',
        body: 'Spent Rs. 450.00 at Starbucks on HDFC Bank Card ending 4321 on 14-Sep-26. Avl Bal: INR 12,000.00. UPI:987654321012',
        receivedAt: '2026-09-14T10:00:00.000Z',
        source: 'shortcut' as const,
      },
    ];

    await processSMSBatch(rawSms);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    // [txnKey, bank, amount, type, merchant, date, source, sender, body, reference, card_id, location, lat, lng]
    const params = txnInsert!.params;
    expect(params[1]).toBe('HDFC Bank');
    expect(params[2]).toBe(450);
    expect(params[3]).toBe('debit');
    expect(params[4]).toBe('Starbucks');
    expect(params[6]).toBe('sms');
    expect(params[7]).toBe('AD-HDFCBK');
    expect(params[9]).toBe('987654321012');

    const logInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO sms_log')
    );
    expect(logInsert).toBeDefined();
    expect(logInsert!.params[5]).toBe('parsed');
  });

  it('extracts sender from prefix when sender parameter is empty', async () => {
    const rawSms = [
      {
        id: 'msg-2',
        sender: '',
        body: 'VM-HDFCBK: Spent Rs. 250 at Cafe Coffee Day on HDFC Bank Card ending 1234 on 14-Sep-26. Ref No: 123456789012',
        receivedAt: '2026-09-14T10:00:00.000Z',
      },
    ];

    await processSMSBatch(rawSms);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    expect(txnInsert!.params[1]).toBe('HDFC Bank');
    expect(txnInsert!.params[2]).toBe(250);
    expect(txnInsert!.params[7]).toBe('VM-HDFCBK'); // Detected sender
  });

  it('normalizes multi-line whitespace and CRLF in SMS body', async () => {
    const rawSms = [
      {
        id: 'msg-3',
        sender: 'SBIINB',
        body: 'Dear Customer,\r\nINR 1,200.00 debited from A/c XX9876 on 14-Sep-26\r\nat AMAZON PAY.\r\nAvl Bal: INR 5,000.00. UPI/123456789012',
        receivedAt: '2026-09-14T10:00:00.000Z',
      },
    ];

    await processSMSBatch(rawSms);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    expect(txnInsert!.params[1]).toBe('SBI');
    expect(txnInsert!.params[2]).toBe(1200);
    expect(txnInsert!.params[3]).toBe('debit');
  });

  it('records location and coordinates when provided as text or numbers', async () => {
    const rawSms = [
      {
        id: 'msg-4',
        sender: 'AXISBK',
        body: 'INR 350.00 spent on Axis Bank Card ending 1111 at SubWay on 14-Sep-26. Ref: 555666777888',
        receivedAt: '2026-09-14T10:00:00.000Z',
        location: '12.9716, 77.5946',
      },
    ];

    await processSMSBatch(rawSms);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    expect(txnInsert!.params[11]).toBe('12.9716, 77.5946');
    expect(txnInsert!.params[12]).toBeCloseTo(12.9716);
    expect(txnInsert!.params[13]).toBeCloseTo(77.5946);
  });

  it('records location coordinates when passed as latitude and longitude numbers', async () => {
    const rawSms = [
      {
        id: 'msg-5',
        sender: 'AXISBK',
        body: 'INR 150.00 spent on Axis Bank Card ending 1111 at Tea Post on 14-Sep-26. Ref: 999888777666',
        receivedAt: '2026-09-14T10:00:00.000Z',
        location: 'Tea Post, MG Road',
        latitude: 28.6139,
        longitude: 77.2090,
      },
    ];

    await processSMSBatch(rawSms);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    expect(txnInsert!.params[11]).toBe('Tea Post, MG Road');
    expect(txnInsert!.params[12]).toBe(28.6139);
    expect(txnInsert!.params[13]).toBe(77.2090);
  });

  it('logs unparsed non-bank SMS as unparsed in sms_log without creating transaction', async () => {
    const rawSms = [
      {
        id: 'msg-6',
        sender: 'FRIEND',
        body: 'Hey are you reaching the coffee shop in 10 minutes?',
        receivedAt: '2026-09-14T10:00:00.000Z',
      },
    ];

    await processSMSBatch(rawSms);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeUndefined();

    const logInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO sms_log')
    );
    expect(logInsert).toBeDefined();
    expect(logInsert!.params[5]).toBe('unparsed');
  });

  it('checkNewMessages drains messages from SharedSMSStore on iOS', async () => {
    const mockMessages = [
      {
        id: 'ios-1',
        sender: 'AD-HDFCBK',
        body: 'Spent Rs. 100.00 at Grocery on HDFC Bank Card ending 1234. UPI:111222333444',
        receivedAt: '2026-09-14T10:00:00.000Z',
      },
    ];

    (SharedSMSStore.readNewMessages as jest.Mock).mockResolvedValue(mockMessages);

    const result = await checkNewMessages();
    expect(result.error).toBeNull();
    expect(SharedSMSStore.readNewMessages).toHaveBeenCalledTimes(1);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    expect(txnInsert!.params[2]).toBe(100);
  });

  it('checkNewMessages gracefully handles non-array / empty store response', async () => {
    (SharedSMSStore.readNewMessages as jest.Mock).mockResolvedValue(null);

    const result = await checkNewMessages();
    expect(result.error).toBeNull();
    expect(mockExecutedQueries.length).toBe(0);
  });

  it('checkNewMessages catches and reports store errors', async () => {
    (SharedSMSStore.readNewMessages as jest.Mock).mockRejectedValue(new Error('App group error'));

    const result = await checkNewMessages();
    expect(result.error).toBe('Could not read incoming messages. Check SMS setup in Settings.');
  });
});
