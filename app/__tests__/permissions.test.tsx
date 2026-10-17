import React from 'react';
import { AppState, Linking, PermissionsAndroid, Platform, Text } from 'react-native';
import ReactTestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import { PermissionSheetHost } from '../src/components/PermissionSheet';
import { requestContactsAccess, requestSmsAccess, useSmsAccess } from '../src/services/permissions';

jest.mock('react-native-contacts', () => ({
  checkPermission: jest.fn(async () => 'authorized'),
  requestPermission: jest.fn(async () => 'authorized'),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn() })),
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

const originalOS = Platform.OS;
let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

const mountHost = async () => {
  await act(async () => {
    renderer = ReactTestRenderer.create(<PermissionSheetHost />);
  });
  return renderer!.root;
};

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.restoreAllMocks();
});

describe('SMS access', () => {
  test('iOS never asks: SMS arrives through Shortcuts', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const check = jest.spyOn(PermissionsAndroid, 'check');
    await expect(requestSmsAccess()).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  describe('on Android', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    });

    test('explains why before showing Android’s prompt, and resolves once allowed', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
      const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
      const root = await mountHost();

      let result: Promise<boolean> | undefined;
      await act(async () => {
        result = requestSmsAccess();
      });
      expect(hasText(root, 'Let TxnTrace see bank SMS')).toBe(true);
      expect(request).not.toHaveBeenCalled();

      await press(root, 'Allow SMS access');
      expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      await expect(result).resolves.toBe(true);
      expect(hasText(root, 'Let TxnTrace see bank SMS')).toBe(false);
    });

    test('once Android stops asking, walks through turning it on in settings', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
      jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('never_ask_again');
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
      const root = await mountHost();

      let result: Promise<boolean> | undefined;
      await act(async () => {
        result = requestSmsAccess();
      });
      await press(root, 'Allow SMS access');

      expect(hasText(root, 'Turn on SMS in Android settings')).toBe(true);
      expect(hasText(root, 'Tap Permissions')).toBe(true);
      expect(hasText(root, 'Tap SMS, then Allow')).toBe(true);
      await press(root, 'Open settings');
      expect(openSettings).toHaveBeenCalled();

      await press(root, 'Not now');
      await expect(result).resolves.toBe(false);
    });

    // Contacts rather than SMS: the test above leaves SMS remembered as
    // blocked for the rest of the session, as it would be in the app.
    test('a plain refusal offers Android’s prompt again', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
      const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('denied');
      const root = await mountHost();

      await act(async () => {
        requestContactsAccess();
      });
      expect(hasText(root, 'Pick friends from your contacts')).toBe(true);
      await press(root, 'Allow contacts');
      expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
      expect(hasText(root, 'It wasn’t allowed. Tap below to see Android’s prompt again.')).toBe(true);
      expect(hasText(root, 'Try again')).toBe(true);
    });

    test('an answer that arrives after a newer request took over leaves that request alone', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
      let answerFirst: (result: string) => void = () => {};
      jest
        .spyOn(PermissionsAndroid, 'request')
        .mockImplementationOnce(() => new Promise<any>(resolve => (answerFirst = resolve)));
      const root = await mountHost();

      let first: Promise<boolean> | undefined;
      let secondSettled = false;
      await act(async () => {
        first = requestContactsAccess();
      });
      // Android's prompt is up for the first request...
      const allow = root.findAll(n => typeof n.props.onPress === 'function' && textOf(n) === 'Allow contacts');
      act(() => {
        allow[allow.length - 1].props.onPress();
      });
      // ...when a second request takes over the sheet.
      await act(async () => {
        requestContactsAccess().then(() => (secondSettled = true));
      });
      // The newer request's button doesn't wait on the earlier prompt.
      const allowSecond = root.findAll(n => typeof n.props.onPress === 'function' && textOf(n) === 'Allow contacts');
      expect(allowSecond[allowSecond.length - 1].props.disabled).toBe(false);
      await act(async () => answerFirst('granted'));

      await expect(first).resolves.toBe(false);
      expect(secondSettled).toBe(false);
      expect(hasText(root, 'Pick friends from your contacts')).toBe(true);
    });

    test('closing Android’s prompt without answering isn’t taken as “never ask again”', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
      // Android reports a dismissed prompt as never_ask_again too; what gives
      // it away is that a person took a while to close it.
      jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('never_ask_again');
      let now = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => (now += 2000));
      const root = await mountHost();

      await act(async () => {
        requestContactsAccess();
      });
      await press(root, 'Allow contacts');
      expect(hasText(root, 'It wasn’t allowed. Tap below to see Android’s prompt again.')).toBe(true);
      expect(hasText(root, 'Turn on Contacts in Android settings')).toBe(false);
    });

    test('a request still on the sheet when it goes away is answered no', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
      await mountHost();
      let result: Promise<boolean> | undefined;
      await act(async () => {
        result = requestContactsAccess();
      });
      act(() => renderer?.unmount());
      renderer = null;
      await expect(result).resolves.toBe(false);
    });

    test('screens showing the SMS banner share one foreground listener', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
      // The preset's AppState is already a shared jest.fn, so drop earlier tests' calls.
      const addListener = jest.spyOn(AppState, 'addEventListener');
      addListener.mockClear();
      const Probe = () => <Text>{String(useSmsAccess())}</Text>;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <>
            <Probe />
            <Probe />
          </>
        );
      });
      expect(addListener.mock.calls.filter(([event]) => event === 'change')).toHaveLength(1);
    });

    test('already allowed: no sheet at all', async () => {
      jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
      const root = await mountHost();
      await expect(requestSmsAccess()).resolves.toBe(true);
      expect(hasText(root, 'Let TxnTrace see bank SMS')).toBe(false);
    });
  });
});
