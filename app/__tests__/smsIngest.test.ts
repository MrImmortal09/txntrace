import { Platform } from 'react-native';
import { processSMSBatch } from '../src/parsers/sms';
import { extractReference, extractTransactionAmount } from '../src/parsers/sms/utils';
import { priceInRupees } from '../src/services/exchangeRates';
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
let mockAliases: any[] = [];

jest.mock('../src/db/schema', () => ({
  db: {
    execute: jest.fn(async (query: string, params: any[] = []) => {
      mockExecutedQueries.push({ query, params });
      const q = query.trim().toUpperCase();

      if (q.startsWith('SELECT * FROM CARDS')) {
        return { rows: { _array: mockCards } };
      }

      if (q.includes('FROM CONTACT_ALIASES')) {
        return { rows: { _array: mockAliases } };
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

// Rates come from the server; tests set them directly.
let mockRates: Record<string, number> = {};
jest.mock('../src/services/exchangeRates', () => ({
  ...jest.requireActual('../src/services/exchangeRates'),
  getExchangeRates: jest.fn(async () => mockRates),
  convertPendingForeignAmounts: jest.fn(async () => 0),
}));

// Credits look payers up in contacts; with access off that step is skipped.
jest.mock('react-native-contacts', () => ({
  checkPermission: jest.fn(async () => 'denied'),
  getAll: jest.fn(async () => []),
}));

describe('SMS Ingestion and Batch Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecutedQueries.length = 0;
    mockCards = [];
    mockInsertRowsAffected = 1;
    mockRates = {};
    mockAliases = [];
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

  it('links an HDFC card alert with bare digits to that card, among several cards', async () => {
    mockCards = [
      { id: 'card_sbi', last4: '9684', custom_pattern: null },
      { id: 'card_hdfc', last4: '0904', custom_pattern: null },
      { id: 'card_icici', last4: '3008', custom_pattern: null },
    ];
    await processSMSBatch([
      {
        id: 'msg-hdfc-0904',
        sender: 'AD-HDFCBK',
        body: 'Spent Rs.460 On HDFC Bank Card 0904 At PTM*SWIGGY IN On 2026-10-12:01:55:33.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 0904 to 7308080808',
        receivedAt: '2026-10-12T01:55:40.000Z',
      },
    ]);

    const txnInsert = mockExecutedQueries.find(e => e.query.includes('INSERT OR IGNORE INTO transactions'));
    expect(txnInsert).toBeDefined();
    const params = txnInsert!.params;
    expect(params[2]).toBe(460);
    expect(params[3]).toBe('debit');
    expect(params[4]).toBe('PTM*SWIGGY IN');
    expect(params[10]).toBe('card_hdfc');
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

  it('does not treat a card-due reminder as a transaction, but still logs it', async () => {
    await processSMSBatch([
      {
        id: 'msg-due',
        sender: 'AX-ICICIT',
        body: 'Total Amount of INR 36,483.00 is due on ICICI Bank Credit Card XX5008. Amount will be debited from Savings Account XX577 on 10-Nov-26. Please ignore if paid.',
        receivedAt: '2026-11-08T10:00:00.000Z',
      },
    ]);

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

  it('still parses a real debit that mentions a later reversal', async () => {
    await processSMSBatch([
      {
        id: 'msg-reversal',
        sender: 'AX-ICICIT',
        body: 'ICICI Bank Acct XX577 debited for Rs 500.00 on 12-Nov-26; UPI txn failed. Amount will be credited back within 3 days.',
        receivedAt: '2026-11-12T10:00:00.000Z',
      },
    ]);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    expect(txnInsert!.params[2]).toBe(500);
    expect(txnInsert!.params[3]).toBe('debit');
  });

  const IDFC_USD_SPEND =
    'Transaction Successful! USD 1.00 spent on your IDFC FIRST Bank Credit Card ending XX2113 at WWW HEROKUCHARGE COM on 29 OCT 2026 at 12:47 PM Avbl Limit: INR 79622.02 If not done by you, call 180010888 for dispute or to block your card SMS CCBLOCK 2113 to 5676732';

  it('reads a foreign-currency spend as that currency, not the available limit', () => {
    expect(extractTransactionAmount(IDFC_USD_SPEND)).toEqual({ amount: 1, currency: 'USD' });
    // The rupee figure comes first, so it's what was billed.
    expect(extractTransactionAmount('INR 8,312.00 (USD 100.00) spent on Card XX1234 at AMAZON')).toEqual({
      amount: 8312,
      currency: 'INR',
    });
    expect(extractTransactionAmount('Spent Rs. 450.00 at Starbucks. Avl Bal: INR 12,000.00')).toEqual({
      amount: 450,
      currency: 'INR',
    });
    expect(extractTransactionAmount('EUR1,250.50 spent at HOTEL ROMA')).toEqual({ amount: 1250.5, currency: 'EUR' });
    // Words ending in "rs" aren't rupee amounts.
    expect(
      extractTransactionAmount('Dear Cardmembers, USD 10.00 spent on your card XX1234 at AMAZON at 14:05 Hrs, Avl Lmt INR 5000.00')
    ).toEqual({ amount: 10, currency: 'USD' });
    // The bank's own conversion beats an estimate.
    expect(extractTransactionAmount('Transaction of USD 100.00 (INR 8,400.00) on your SBI Card ending 1234')).toEqual({
      amount: 8400,
      currency: 'INR',
    });
    expect(extractTransactionAmount('Txn of USD 100.00 (approx. INR 8,400.00) on SBI Card')).toEqual({
      amount: 8400,
      currency: 'INR',
    });
    // A bracketed figure later in the message doesn't replace the rupee amount that comes first.
    expect(extractTransactionAmount('Rs.2,000.00 debited from A/c XX12 incl. markup on USD 23.00 (Rs 70.00)')).toEqual({
      amount: 2000,
      currency: 'INR',
    });
  });

  it('prices a foreign spend at the rate plus the card markup', () => {
    expect(priceInRupees(1, 'USD', { USD: 90 }, 3.5)).toEqual({
      amount: 93.15,
      original_currency: 'USD',
      original_amount: 1,
      fx_rate: 90,
      fx_markup: 3.5,
    });
    expect(priceInRupees(500, 'INR', { USD: 90 }, 3.5).amount).toBe(500);
    // No rate yet: held at ₹0 until one arrives.
    expect(priceInRupees(1, 'USD', {}, 3.5)).toMatchObject({ amount: 0, fx_rate: null, original_amount: 1 });
  });

  it('stores a USD card spend in rupees with the card forex markup', async () => {
    mockRates = { USD: 90 };
    mockCards = [
      { id: 'card_idfc', name: 'IDFC FIRST', bank: 'IDFC FIRST Bank', last4: '2113', credit_limit: 80000, is_credit_card: 1, custom_pattern: null, forex_markup: 3.5 },
    ];

    await processSMSBatch([
      { id: 'msg-usd', sender: 'AX-IDFCFB', body: IDFC_USD_SPEND, receivedAt: '2026-10-29T07:17:00.000Z' },
    ]);

    const txnInsert = mockExecutedQueries.find(e => e.query.includes('INSERT OR IGNORE INTO transactions'));
    expect(txnInsert).toBeDefined();
    // [..., card_id(10), location, lat, lng, original_currency(14), original_amount, fx_rate, fx_markup]
    const params = txnInsert!.params;
    expect(params[2]).toBe(93.15);
    expect(params[3]).toBe('debit');
    expect(params[4]).toBe('WWW HEROKUCHARGE COM');
    expect(params[10]).toBe('card_idfc');
    expect(params.slice(14, 18)).toEqual(['USD', 1, 90, 3.5]);
  });

  it('holds a foreign spend at ₹0 when no exchange rate is known yet', async () => {
    await processSMSBatch([
      { id: 'msg-usd-norate', sender: 'AX-IDFCFB', body: IDFC_USD_SPEND, receivedAt: '2026-10-29T07:17:00.000Z' },
    ]);

    const params = mockExecutedQueries.find(e => e.query.includes('INSERT OR IGNORE INTO transactions'))!.params;
    expect(params[2]).toBe(0);
    expect(params.slice(14, 18)).toEqual(['USD', 1, null, 0]);
  });

  it('logs the foreign amount as the message gave it', async () => {
    mockRates = { USD: 90 };
    await processSMSBatch([
      { id: 'msg-usd-log', sender: 'AX-IDFCFB', body: IDFC_USD_SPEND, receivedAt: '2026-10-29T07:17:00.000Z' },
    ]);
    const log = mockExecutedQueries.find(e => e.query.includes('INSERT OR IGNORE INTO sms_log'))!.params;
    // [..., amount(7), type, merchant, reference, logged_at, location, currency(13)]
    expect(log[7]).toBe(1);
    expect(log[13]).toBe('USD');
  });

  it('does not settle a foreign credit from a friend while it has no rupee amount', async () => {
    mockAliases = [{ contact_id: 'c1', contact_name: 'John Smith' }];
    await processSMSBatch([
      {
        id: 'msg-usd-credit',
        sender: 'AX-ICICIT',
        body: 'Dear Customer, Acct XX577 is credited with USD 20.00 on 29-Oct-26 from JOHN SMITH. UPI:123456789012',
        receivedAt: '2026-10-29T07:17:00.000Z',
      },
    ]);
    expect(mockExecutedQueries.some(e => e.query.includes('INSERT INTO settlements'))).toBe(false);
    const flagged = mockExecutedQueries.find(e => e.query.includes('needs_contact_match = 1'));
    expect(flagged).toBeDefined();
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

  it('checkNewMessages deduplicates concurrent in-flight calls', async () => {
    let resolveStore: (val: any) => void = () => {};
    const pendingPromise = new Promise(resolve => {
      resolveStore = resolve;
    });

    (SharedSMSStore.readNewMessages as jest.Mock).mockReturnValue(pendingPromise);

    const call1 = checkNewMessages();
    const call2 = checkNewMessages();

    expect(SharedSMSStore.readNewMessages).toHaveBeenCalledTimes(1);

    resolveStore([
      {
        id: 'ios-concurrent',
        sender: 'AD-HDFCBK',
        body: 'Spent Rs. 50.00 at Tea on HDFC Bank Card ending 1234. UPI:999888777666',
        receivedAt: '2026-09-14T10:00:00.000Z',
      },
    ]);

    const [res1, res2] = await Promise.all([call1, call2]);
    expect(res1).toEqual(res2);
    expect(res1.error).toBeNull();
    expect(res1.count).toBe(1);
    expect(SharedSMSStore.readNewMessages).toHaveBeenCalledTimes(1);
  });

  it('populates location as lat, lng string when coordinates are given but location is omitted', async () => {
    const rawSms = [
      {
        id: 'msg-coord-only',
        sender: 'AXISBK',
        body: 'INR 220.00 spent on Axis Bank Card ending 1111 at Coffee on 14-Sep-26. Ref: 123123123123',
        receivedAt: '2026-09-14T10:00:00.000Z',
        latitude: 19.0760,
        longitude: 72.8777,
      },
    ];

    await processSMSBatch(rawSms);

    const txnInsert = mockExecutedQueries.find(e =>
      e.query.includes('INSERT OR IGNORE INTO transactions')
    );
    expect(txnInsert).toBeDefined();
    expect(txnInsert!.params[11]).toBe('19.076, 72.8777');
    expect(txnInsert!.params[12]).toBe(19.0760);
    expect(txnInsert!.params[13]).toBe(72.8777);
  });

  it('extractReference parses multiple bank reference formats accurately', () => {
    expect(extractReference('Spent Rs 100 UPI:123456789012')).toBe('123456789012');
    expect(extractReference('Debited INR 500 RRN:987654321098')).toBe('987654321098');
    expect(extractReference('Paid Rs 250 Ref no: 456789012345')).toBe('456789012345');
    expect(extractReference('Paid Rs 300 UPI Ref no. 112233445566')).toBe('112233445566');
    expect(extractReference('Paid Rs 300 UPI txn no 778899001122')).toBe('778899001122');
    expect(extractReference('Paid Rs 150 Ref-UPI/660730856024/')).toBe('660730856024');
    expect(extractReference('Plain message with no reference')).toBeNull();
  });
});
