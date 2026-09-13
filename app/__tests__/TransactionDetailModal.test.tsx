import React from 'react';
import { Clipboard } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import TransactionDetailModal, { TransactionRow } from '../src/components/TransactionDetailModal';

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
    },
    isDark: false,
  }),
}));

jest.mock('../src/utils/maps', () => ({
  openLocationInGoogleMaps: jest.fn(),
}));

describe('TransactionDetailModal Hold to Copy', () => {
  const sampleTxn: TransactionRow = {
    id: 'txn_123',
    bank: 'HDFC',
    amount: 850.5,
    type: 'debit',
    merchant_raw: 'SWIGGY BANGALORE',
    date: '2026-09-13T14:30:00.000Z',
    source: 'sms',
    category: 'Food',
    note: 'Dinner with friends',
    reference: 'UPI1234567890',
    account_last4: '4321',
    balance: 24500,
    sender: 'VM-HDFCBK',
    sms_body: 'Rs 850.50 debited from a/c **4321 on 13-09-26 to SWIGGY BANGALORE UPI Ref 1234567890. Avl bal: Rs 24,500.00.',
    card_id: null,
    location: 'Koramangala, Bangalore',
    latitude: 12.9352,
    longitude: 77.6245,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('holding the received SMS message content automatically copies it to clipboard', async () => {
    let renderer: any;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <TransactionDetailModal transaction={sampleTxn} onClose={jest.fn()} />
      );
      await Promise.resolve();
    });

    const root = renderer.root;

    // Find message touchable
    const messageTouchable = root.find(
      (n: any) =>
        n.props.accessibilityLabel &&
        n.props.accessibilityLabel.includes('Received SMS Message')
    );
    expect(messageTouchable).toBeDefined();

    // Trigger onLongPress
    await ReactTestRenderer.act(async () => {
      messageTouchable.props.onLongPress();
      await Promise.resolve();
    });

    // Check Clipboard.setString was called with the exact sms_body
    expect(Clipboard.setString).toHaveBeenCalledWith(sampleTxn.sms_body);

    // Verify toast feedback is displayed
    const texts = root.findAllByType('Text').map((t: any) => t.props.children).flat().join(' ');
    expect(texts).toContain('Copied Message to clipboard');
  });

  test('tapping the message also copies the message content', async () => {
    let renderer: any;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <TransactionDetailModal transaction={sampleTxn} onClose={jest.fn()} />
      );
      await Promise.resolve();
    });

    const root = renderer.root;

    const messageTouchable = root.find(
      (n: any) =>
        n.props.accessibilityLabel &&
        n.props.accessibilityLabel.includes('Received SMS Message')
    );

    await ReactTestRenderer.act(async () => {
      messageTouchable.props.onPress();
      await Promise.resolve();
    });

    expect(Clipboard.setString).toHaveBeenCalledWith(sampleTxn.sms_body);
  });

  test('holding merchant name, amount, or other fields automatically copies them', async () => {
    let renderer: any;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <TransactionDetailModal transaction={sampleTxn} onClose={jest.fn()} />
      );
      await Promise.resolve();
    });

    const root = renderer.root;

    // 1. Merchant name
    const merchantTouchable = root.find(
      (n: any) =>
        n.props.accessibilityLabel &&
        n.props.accessibilityLabel.includes('SWIGGY BANGALORE')
    );
    expect(merchantTouchable).toBeDefined();

    await ReactTestRenderer.act(async () => {
      merchantTouchable.props.onLongPress();
      await Promise.resolve();
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('SWIGGY BANGALORE');

    // 2. Amount
    const amountTouchable = root.find(
      (n: any) =>
        n.props.accessibilityLabel &&
        n.props.accessibilityLabel.includes('850.50')
    );
    expect(amountTouchable).toBeDefined();

    await ReactTestRenderer.act(async () => {
      amountTouchable.props.onLongPress();
      await Promise.resolve();
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('850.50');

    // 3. Reference field
    const refTouchable = root.find(
      (n: any) =>
        n.props.accessibilityLabel &&
        n.props.accessibilityLabel.includes('Reference')
    );
    expect(refTouchable).toBeDefined();

    await ReactTestRenderer.act(async () => {
      refTouchable.props.onLongPress();
      await Promise.resolve();
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('UPI1234567890');
  });

  test('modal returns null when transaction is null', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <TransactionDetailModal transaction={null} onClose={jest.fn()} />
      );
    });
    expect(renderer.toJSON()).toBeNull();
  });
});
