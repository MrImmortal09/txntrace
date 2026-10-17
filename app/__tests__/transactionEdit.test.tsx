import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import TransactionDetailModal, { TransactionRow } from '../src/components/TransactionDetailModal';
import { clearTransactionData } from '../src/services/dataReset';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn() })),
}));

const mockQueries: { sql: string; params: any[] }[] = [];
let mockCategoriesFail = false;
jest.mock('../src/db/schema', () => ({
  db: {
    execute: jest.fn(async (sql: string, params: any[] = []) => {
      mockQueries.push({ sql, params });
      if (sql.includes('FROM categories')) {
        if (mockCategoriesFail) throw new Error('categories unavailable');
        return {
          rows: [
            { id: 'bills', name: 'Bills' },
            { id: 'food', name: 'Food' },
            { id: 'other', name: 'Other' },
          ],
        };
      }
      return { rows: [] };
    }),
    transaction: jest.fn(async (fn: (tx: any) => Promise<void>) =>
      fn({ execute: async (sql: string) => mockQueries.push({ sql, params: [] }) })
    ),
  },
}));

const textOf = (node: ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');

const hasText = (root: ReactTestInstance, text: string) =>
  root.findAll(node => (node.type as unknown) === 'Text' && textOf(node) === text).length > 0;

const press = async (root: ReactTestInstance, label: string) => {
  const matches = root.findAll(node => typeof node.props.onPress === 'function' && textOf(node) === label);
  expect(matches.length).toBeGreaterThan(0);
  await act(async () => {
    matches[matches.length - 1].props.onPress();
  });
};

const spend: TransactionRow = {
  id: 'txn_1',
  bank: 'HDFC Bank',
  amount: 349,
  type: 'debit',
  merchant_raw: 'SWIGGY',
  date: '2026-10-17T13:42:00',
  source: 'sms',
  category: null,
  note: null,
  reference: null,
  account_last4: '1234',
  balance: null,
  sender: 'VM-HDFCBK',
  sms_body: null,
  card_id: null,
};

let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  mockQueries.length = 0;
  mockCategoriesFail = false;
  jest.restoreAllMocks();
});

const openEditor = async (transaction: TransactionRow, onClose = jest.fn()) => {
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <TransactionDetailModal transaction={transaction} onClose={onClose} onEdited={jest.fn()} />
    );
  });
  const root = renderer!.root;
  await press(root, 'Edit');
  return { root, onClose };
};

const typeNote = (root: ReactTestInstance, text: string) =>
  act(async () => root.find(node => node.props.placeholder === 'What was this for?').props.onChangeText(text));

describe('editing a cleared spend', () => {
  test('saves a category and note, and hands back the updated row', async () => {
    const onEdited = jest.fn();
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <TransactionDetailModal transaction={spend} onClose={jest.fn()} onEdited={onEdited} />
      );
    });
    const root = renderer!.root;

    await press(root, 'Edit');
    await press(root, 'Food');
    const noteInput = root.find(node => node.props.placeholder === 'What was this for?');
    await act(async () => noteInput.props.onChangeText('  Lunch with the team  '));
    await press(root, 'Save');

    const update = mockQueries.find(q => q.sql.startsWith('UPDATE transactions SET category'));
    expect(update?.params.slice(0, 2)).toEqual(['food', 'Lunch with the team']);
    expect(update?.params[3]).toBe('txn_1');
    expect(onEdited).toHaveBeenCalledWith({ ...spend, category: 'food', note: 'Lunch with the team' });
  });

  test('no Edit button where the caller doesn’t allow editing', async () => {
    await act(async () => {
      renderer = ReactTestRenderer.create(<TransactionDetailModal transaction={spend} onClose={jest.fn()} />);
    });
    expect(hasText(renderer!.root, 'Edit')).toBe(false);
  });

  test('picks out a category stored by name on older rows', async () => {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <TransactionDetailModal transaction={{ ...spend, category: 'Bills' }} onClose={jest.fn()} onEdited={jest.fn()} />
      );
    });
    const root = renderer!.root;
    await press(root, 'Edit');
    const billsChip = root.findAll(
      node => typeof node.props.onPress === 'function' && textOf(node) === 'Bills'
    );
    expect(billsChip[billsChip.length - 1].props.accessibilityState).toEqual({ selected: true });
  });
});

describe('editing keeps what it shouldn’t touch', () => {
  test('a save when categories couldn’t load keeps the saved category', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCategoriesFail = true;
    const { root } = await openEditor({ ...spend, category: 'food' });
    await typeNote(root, 'Team lunch');
    await press(root, 'Save');

    const update = mockQueries.find(q => q.sql.startsWith('UPDATE transactions SET category'));
    expect(update?.params.slice(0, 2)).toEqual(['food', 'Team lunch']);
  });

  test('a note longer than 300 characters isn’t cut short', async () => {
    const longNote = 'x'.repeat(500);
    const { root } = await openEditor({ ...spend, note: longNote });
    const input = root.find(node => node.props.placeholder === 'What was this for?');
    expect(input.props.maxLength).toBeUndefined();
    expect(input.props.value).toBe(longNote);
  });
});

describe('leaving an edit', () => {
  test('✕ with unsaved changes asks before discarding them', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { root, onClose } = await openEditor(spend);
    await typeNote(root, 'Changed my mind');
    await press(root, '✕');

    expect(onClose).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Discard changes?', expect.any(String), expect.any(Array));
    const discard = alert.mock.calls[0][2]!.find(b => b.text === 'Discard');
    await act(async () => discard!.onPress!());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('✕ with nothing changed closes straight away', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { root, onClose } = await openEditor(spend);
    await press(root, '✕');
    expect(alert).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a tap outside the card doesn’t close it mid-edit', async () => {
    const { root, onClose } = await openEditor(spend);
    await typeNote(root, 'Half typed');
    const backdrop = root.findAll(node => node.props.activeOpacity === 1 && typeof node.props.onPress === 'function');
    await act(async () => backdrop[0].props.onPress());
    expect(onClose).not.toHaveBeenCalled();
    expect(root.find(node => node.props.placeholder === 'What was this for?').props.value).toBe('Half typed');
  });

  test('Android back steps out of editing instead of closing', async () => {
    const { root, onClose } = await openEditor(spend);
    const modal = root.find(node => typeof node.props.onRequestClose === 'function');
    await act(async () => modal.props.onRequestClose());
    expect(onClose).not.toHaveBeenCalled();
    expect(hasText(root, 'Edit')).toBe(true);
  });
});

describe('Delete All Transactions', () => {
  test('also clears the splits, settlements and payer names built on them', async () => {
    await clearTransactionData();
    expect(mockQueries.map(q => q.sql)).toEqual([
      'DELETE FROM splits',
      'DELETE FROM settlements',
      'DELETE FROM contact_aliases',
      'DELETE FROM transactions',
    ]);
  });
});
