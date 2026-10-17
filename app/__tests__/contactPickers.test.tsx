import React from 'react';
import ReactTestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import ContactPickerModal from '../src/components/ContactPickerModal';
import SplitModal from '../src/components/SplitModal';
import { requestContactsAccess } from '../src/services/permissions';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn() })),
}));

jest.mock('../src/db/schema', () => ({
  db: { execute: jest.fn(async () => ({ rows: [] })) },
}));

jest.mock('react-native-contacts', () => ({
  getAll: jest.fn(async () => [{ recordID: 'c1', displayName: 'Priya Patel' }]),
}));

jest.mock('../src/services/permissions', () => ({
  requestContactsAccess: jest.fn(),
  hasContactsAccess: jest.fn(async () => false),
}));

const askForContacts = requestContactsAccess as jest.Mock;

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

const ACCESS_OFF = 'Contacts access is off, so there’s no one to pick from yet.';

let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  askForContacts.mockReset();
});

test('the Daily split sheet offers to allow contacts when access was refused', async () => {
  askForContacts.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SplitModal visible transactionId="txn_1" amount={349} onClose={jest.fn()} onSaved={jest.fn()} />
    );
  });
  const root = renderer!.root;
  expect(hasText(root, ACCESS_OFF)).toBe(true);

  await press(root, 'Allow contacts');
  expect(askForContacts).toHaveBeenCalledTimes(2);
  expect(hasText(root, 'Priya Patel')).toBe(true);
  expect(hasText(root, ACCESS_OFF)).toBe(false);
});

test('reopening the picker shows nothing from last time while it asks again', async () => {
  askForContacts.mockResolvedValueOnce(false);
  const picker = (visible: boolean) => (
    <ContactPickerModal visible={visible} title="Who paid you?" onCancel={jest.fn()} onSelect={jest.fn()} />
  );
  await act(async () => {
    renderer = ReactTestRenderer.create(picker(true));
  });
  const root = renderer!.root;
  expect(hasText(root, ACCESS_OFF)).toBe(true);

  await act(async () => renderer!.update(picker(false)));
  let answer: (granted: boolean) => void = () => {};
  askForContacts.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
  await act(async () => renderer!.update(picker(true)));
  expect(hasText(root, ACCESS_OFF)).toBe(false);

  await act(async () => answer(true));
  expect(hasText(root, 'Priya Patel')).toBe(true);
});
