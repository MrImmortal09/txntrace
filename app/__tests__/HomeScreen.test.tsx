import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import HomeScreen from '../src/screens/HomeScreen';
import TransactionDetailModal from '../src/components/TransactionDetailModal';

// Mocks
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn() })),
}));

jest.mock('../src/db/schema', () => {
  const store: {
    transactions: any[];
    splits: any[];
  } = {
    transactions: [],
    splits: [],
  };

  return {
    db: {
      execute: jest.fn(async (query: string, _params: any[] = []) => {
        const q = query.trim().toUpperCase().replace(/\s+/g, ' ');

        if (q.includes('SELECT SUM(AMOUNT_OWED) AS TOTAL FROM SPLITS WHERE SETTLED = 0')) {
          const total = store.splits
            .filter(s => s.settled === 0)
            .reduce((sum, s) => sum + (s.amount_owed || 0), 0);
          return { rows: { _array: [{ total }] } };
        }

        if (q.includes('FROM TRANSACTIONS') && q.includes("TYPE = 'DEBIT'") && q.includes('REVIEWED = 1')) {
          // Exclude transactions in splits
          const splitTxnIds = new Set(store.splits.map(s => s.transaction_id));
          const mine = store.transactions.filter(
            t => t.type === 'debit' && t.reviewed === 1 && !splitTxnIds.has(t.id)
          );
          return { rows: { _array: mine } };
        }

        return { rows: { _array: [] } };
      }),
    },
    __setMockData: (txns: any[], splits: any[]) => {
      store.transactions = [...txns];
      store.splits = [...splits];
    },
  };
});

jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useFocusEffect: (cb: any) => {
      R.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

jest.mock('../src/components/BankIcon', () => {
  const { View } = require('react-native');
  return ({ bank }: any) => <View testID={`bank-icon-${bank}`} />;
});

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F9FAFB',
      surface: '#FFFFFF',
      text: '#111827',
      textSecondary: '#6B7280',
      primary: '#2563EB',
      accent: '#10B981',
      border: '#E5E7EB',
      danger: '#EF4444',
      warning: '#F59E0B',
      success: '#10B981',
      cardShadow: 'rgba(0, 0, 0, 0.05)',
      tabBarBg: '#FFFFFF',
      tabBarActive: '#2563EB',
      tabBarInactive: '#9CA3AF',
    },
    isDark: false,
  }),
}));

describe('HomeScreen Spends Dashboard', () => {
  const setMockData = (require('../src/db/schema') as any).__setMockData;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders dashboard with current month spends and displays notes instead of merchant name', async () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    // ISO date for 10th of current month
    const currentDate = new Date(currentYear, currentMonth, 10, 14, 30).toISOString();
    // Date from previous year/month
    const pastDate = new Date(currentYear - 1, 5, 10, 12, 0).toISOString();

    setMockData(
      [
        {
          id: 'txn_1',
          bank: 'hdfc',
          amount: 450,
          type: 'debit',
          merchant_raw: 'SWIGGY BANGALORE IND',
          date: currentDate,
          category: 'food',
          note: 'Dinner with team',
          reviewed: 1,
        },
        {
          id: 'txn_2',
          bank: 'icici',
          amount: 1200,
          type: 'debit',
          merchant_raw: 'AMAZON RETAIL INDIA',
          date: currentDate,
          category: 'shopping',
          note: '',
          reviewed: 1,
        },
        {
          id: 'txn_past',
          bank: 'sbi',
          amount: 999,
          type: 'debit',
          merchant_raw: 'OLD STORE',
          date: pastDate,
          category: 'other',
          note: 'Old spend',
          reviewed: 1,
        },
        {
          id: 'txn_unreviewed',
          bank: 'hdfc',
          amount: 500,
          type: 'debit',
          merchant_raw: 'UNREVIEWED CAFE',
          date: currentDate,
          category: 'food',
          note: null,
          reviewed: 0, // Not marked as mine
        },
      ],
      [
        { id: 's1', transaction_id: 'txn_split_friend', amount_owed: 300, settled: 0 },
      ]
    );

    let renderer: any;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<HomeScreen />);
      await Promise.resolve();
    });

    const root = renderer.root;

    // 1. Title
    const texts = root.findAllByType('Text').map((t: any) => t.props.children);
    const flattenedTexts = texts.flat().join(' ');

    expect(flattenedTexts).toContain('Dashboard');
    expect(flattenedTexts).toContain('My Spends');
    expect(flattenedTexts).toContain('Owed to you');
    expect(flattenedTexts).toContain('Spend by Category');
    expect(flattenedTexts).toContain('All Spends (Mine)');

    // 2. Note-first display verification:
    // txn_1 has note "Dinner with team" -> "Dinner with team" must be visible
    expect(flattenedTexts).toContain('Dinner with team');
    // txn_1 merchant_raw "SWIGGY BANGALORE IND" must NOT be rendered
    expect(flattenedTexts).not.toContain('SWIGGY BANGALORE IND');

    // txn_2 has NO note -> merchant_raw "AMAZON RETAIL INDIA" MUST be visible
    expect(flattenedTexts).toContain('AMAZON RETAIL INDIA');

    // txn_past is not in current month -> not visible in current month view
    expect(flattenedTexts).not.toContain('Old spend');

    // txn_unreviewed (reviewed = 0) must NOT be shown
    expect(flattenedTexts).not.toContain('UNREVIEWED CAFE');

    // 3. Spends total should equal 450 + 1200 = 1650.00
    expect(flattenedTexts).toContain('1650.00');
  });

  test('clicking a transaction opens TransactionDetailModal with full info', async () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const currentDate = new Date(currentYear, currentMonth, 12, 10, 0).toISOString();

    setMockData(
      [
        {
          id: 'txn_click',
          bank: 'axis',
          amount: 320,
          type: 'debit',
          merchant_raw: 'STARBUCKS COFFEE',
          date: currentDate,
          category: 'food',
          note: 'Morning coffee',
          reviewed: 1,
        },
      ],
      []
    );

    let renderer: any;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<HomeScreen />);
      await Promise.resolve();
    });

    const root = renderer.root;

    // Find the touchable row for txn_click
    const txnTouchable = root.find(
      (n: any) => n.props.accessibilityLabel && n.props.accessibilityLabel.includes('Morning coffee')
    );
    expect(txnTouchable).toBeDefined();

    // Tap the transaction
    await ReactTestRenderer.act(async () => {
      txnTouchable.props.onPress();
      await Promise.resolve();
    });

    // TransactionDetailModal should now receive the selected transaction
    const modal = root.findByType(TransactionDetailModal);
    expect(modal.props.transaction).toBeDefined();
    expect(modal.props.transaction.merchant_raw).toBe('STARBUCKS COFFEE');
    expect(modal.props.transaction.note).toBe('Morning coffee');
    expect(modal.props.transaction.amount).toBe(320);
  });

  test('sort options can be toggled between category, date, and amount', async () => {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const d1 = new Date(currentYear, currentMonth, 5).toISOString();
    const d2 = new Date(currentYear, currentMonth, 10).toISOString();

    setMockData(
      [
        {
          id: 't1',
          bank: 'hdfc',
          amount: 100,
          type: 'debit',
          merchant_raw: 'A Cafe',
          date: d1,
          category: 'Food',
          note: '',
          reviewed: 1,
        },
        {
          id: 't2',
          bank: 'icici',
          amount: 900,
          type: 'debit',
          merchant_raw: 'Z Store',
          date: d2,
          category: 'Shopping',
          note: '',
          reviewed: 1,
        },
      ],
      []
    );

    let renderer: any;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<HomeScreen />);
      await Promise.resolve();
    });

    const root = renderer.root;

    // Toggle to Date sort
    const sortDateBtn = root.find(
      (n: any) => n.props.accessibilityLabel === 'Sort by Date'
    );
    expect(sortDateBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      sortDateBtn.props.onPress();
      await Promise.resolve();
    });

    // Toggle to Amount sort
    const sortAmountBtn = root.find(
      (n: any) => n.props.accessibilityLabel === 'Sort by Amount'
    );
    expect(sortAmountBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      sortAmountBtn.props.onPress();
      await Promise.resolve();
    });
  });

  test('date navigation arrows step through months', async () => {
    let renderer: any;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<HomeScreen />);
      await Promise.resolve();
    });

    const root = renderer.root;

    const prevMonthBtn = root.find(
      (n: any) => n.props.accessibilityLabel === 'Previous month'
    );
    expect(prevMonthBtn).toBeDefined();

    // Tap previous month
    await ReactTestRenderer.act(async () => {
      prevMonthBtn.props.onPress();
      await Promise.resolve();
    });

    // "Back to Current Month" button should appear
    const texts = root.findAllByType('Text').map((t: any) => t.props.children).flat().join(' ');
    expect(texts).toContain('Back to Current Month');

    // Tap reset to current month
    const resetBtn = root.find(
      (n: any) => {
        const text = (n.findAllByType?.('Text') || []).map((x: any) => x.props.children).flat().join(' ');
        return text.includes('Back to Current Month') && typeof n.props.onPress === 'function';
      }
    );
    expect(resetBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      resetBtn.props.onPress();
      await Promise.resolve();
    });

    const textsAfterReset = root.findAllByType('Text').map((t: any) => t.props.children).flat().join(' ');
    expect(textsAfterReset).not.toContain('Back to Current Month');
  });
});
