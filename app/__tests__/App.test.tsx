/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn() })),
}));

jest.mock('../src/db/schema', () => ({
  setupDatabase: jest.fn(async () => {}),
  db: { execute: jest.fn(async () => ({ rows: [] })) },
}));

jest.mock('../src/services/smsIngest', () => ({
  checkNewMessages: jest.fn(async () => ({ error: null })),
  ingestManualSMS: jest.fn(),
  previewParsedSMS: jest.fn(),
}));

jest.mock('react-native-contacts', () => ({
  checkPermission: jest.fn(async () => 'authorized'),
  getAll: jest.fn(async () => []),
}));

jest.mock('shared-sms-store', () => ({}));
jest.mock('txntrace-pdf-extractor', () => ({}));

jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: ({ children }: any) => children,
    useSafeAreaInsets: () => inset,
  };
});

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: any) => children,
  useFocusEffect: jest.fn(),
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('../src/screens/TabNavigator', () => ({
  TabNavigator: () => null,
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });
});

