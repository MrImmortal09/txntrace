import React from 'react';
import Contacts from 'react-native-contacts';
import ReactTestRenderer, { act, ReactTestInstance } from 'react-test-renderer';
import App from '../App';
import OnboardingTutorial from '../src/components/onboarding/OnboardingTutorial';
import { SLIDES } from '../src/components/onboarding/slides';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn() })),
}));

// app_settings, plus whether there's any data yet — the tutorial flag, the
// upgrade check and theme are all these tests touch.
const mockSettings: Record<string, string> = {};
let mockHasData = false;
jest.mock('../src/db/schema', () => ({
  setupDatabase: jest.fn(async () => {}),
  db: {
    execute: jest.fn(async (query: string, params: any[] = []) => {
      if (query.includes('FROM transactions')) {
        return { rows: mockHasData ? [{ 1: 1 }] : [] };
      }
      if (query.includes('SELECT value FROM app_settings')) {
        const value = mockSettings[params[0]];
        return { rows: value === undefined ? [] : [{ value }] };
      }
      if (query.includes('INSERT INTO app_settings')) {
        mockSettings[params[0]] = params[1];
      }
      return { rows: [] };
    }),
  },
}));

jest.mock('../src/services/smsIngest', () => ({
  checkNewMessages: jest.fn(async () => ({ error: null })),
  ingestManualSMS: jest.fn(),
  previewParsedSMS: jest.fn(),
}));

jest.mock('react-native-contacts', () => ({
  checkPermission: jest.fn(async () => 'undefined'),
  requestPermission: jest.fn(async () => 'authorized'),
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

// Stands in for the tabs with just Settings' "Show App Tutorial" button.
jest.mock('../src/screens/TabNavigator', () => {
  const { createElement } = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  const { useShowTutorial } = require('../src/components/onboarding/TutorialContext');
  return {
    TabNavigator: () =>
      createElement(TouchableOpacity, { onPress: useShowTutorial() }, createElement(Text, null, 'Show App Tutorial')),
  };
});

const textOf = (node: ReactTestInstance): string =>
  node.children.map(child => (typeof child === 'string' ? child : textOf(child))).join('');

const hasText = (root: ReactTestInstance, text: string) =>
  root.findAll(node => (node.type as unknown) === 'Text' && textOf(node) === text).length > 0;

const press = async (root: ReactTestInstance, label: string) => {
  // The innermost pressable whose text is exactly the label.
  const matches = root.findAll(node => typeof node.props.onPress === 'function' && textOf(node) === label);
  expect(matches.length).toBeGreaterThan(0);
  await act(async () => {
    matches[matches.length - 1].props.onPress();
  });
};

const wait = (ms: number) =>
  act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
  });
const flush = () => wait(0);

let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

afterEach(() => {
  // Stops the demos' hint loops.
  act(() => renderer?.unmount());
  renderer = null;
  Object.keys(mockSettings).forEach(key => delete mockSettings[key]);
  mockHasData = false;
  jest.clearAllMocks();
});

describe('OnboardingTutorial', () => {
  const open = async (onDone = jest.fn()) => {
    await act(async () => {
      renderer = ReactTestRenderer.create(<OnboardingTutorial visible onDone={onDone} />);
    });
    return { root: renderer!.root, onDone };
  };

  test('steps through every slide with Next and finishes on Get started', async () => {
    const { root, onDone } = await open();
    expect(hasText(root, `1 of ${SLIDES.length}`)).toBe(true);

    for (let i = 1; i < SLIDES.length; i++) {
      await press(root, 'Next');
      expect(hasText(root, `${i + 1} of ${SLIDES.length}`)).toBe(true);
    }

    expect(hasText(root, 'Next')).toBe(false);
    await press(root, 'Get started');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('Back returns to the previous slide', async () => {
    const { root } = await open();
    await press(root, 'Next');
    await press(root, 'Next');
    await press(root, 'Back');
    expect(hasText(root, `2 of ${SLIDES.length}`)).toBe(true);
  });

  test('Skip ends the tour from any slide', async () => {
    const { root, onDone } = await open();
    await press(root, 'Next');
    await press(root, 'Skip');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('opens on the first slide again after being closed partway', async () => {
    const { root, onDone } = await open();
    await press(root, 'Next');
    await press(root, 'Next');
    await act(async () => renderer!.update(<OnboardingTutorial visible={false} onDone={onDone} />));
    await act(async () => renderer!.update(<OnboardingTutorial visible onDone={onDone} />));
    expect(hasText(root, `1 of ${SLIDES.length}`)).toBe(true);
  });

  const openReviewSlide = async () => {
    const opened = await open();
    const review = SLIDES.findIndex(slide => slide.key === 'review');
    for (let i = 0; i < review; i++) await press(opened.root, 'Next');
    return opened;
  };

  test('Review & Next in the practice queue saves the card and moves on', async () => {
    const { root } = await openReviewSlide();
    await press(root, 'Food');
    await press(root, 'Review & Next');
    // The fly-off animation finishes before the sample queue changes.
    await wait(400);
    expect(hasText(root, '1 of 2')).toBe(true);
    expect(hasText(root, '✓ Saved AMAZON under Food. It left the queue, and the next card slid in.')).toBe(true);
  });

  test('a category tapped during the fly-off is ignored', async () => {
    const { root } = await openReviewSlide();
    await press(root, 'Review & Next');
    await press(root, 'Transport');
    expect(hasText(root, 'Transport picked. Now tap Review & Next to save it.')).toBe(false);
    await wait(400);
    expect(hasText(root, '✓ Saved AMAZON. It left the queue, and the next card slid in.')).toBe(true);
  });
});

describe('first launch', () => {
  const launch = async () => {
    await act(async () => {
      renderer = ReactTestRenderer.create(<App />);
    });
    for (let i = 0; i < 5; i++) await flush();
    return renderer!.root;
  };

  test('shows the tutorial once, then remembers it was seen', async () => {
    const root = await launch();
    expect(hasText(root, 'Welcome to TxnTrace')).toBe(true);

    expect(Contacts.requestPermission).not.toHaveBeenCalled();
    await press(root, 'Skip');
    expect(hasText(root, 'Welcome to TxnTrace')).toBe(false);
    expect(mockSettings.tutorial_seen_version).toBe('1');
    // Contacts are asked for once the tour is over, so a payer whose name
    // matches a contact can be matched without picking them.
    await flush();
    expect(Contacts.requestPermission).toHaveBeenCalledTimes(1);

    act(() => renderer?.unmount());
    const relaunched = await launch();
    expect(hasText(relaunched, 'Welcome to TxnTrace')).toBe(false);
  });

  test('skips the tutorial for someone upgrading with existing data', async () => {
    mockHasData = true;
    const root = await launch();
    expect(hasText(root, 'Welcome to TxnTrace')).toBe(false);
    expect(mockSettings.tutorial_seen_version).toBe('1');
  });

  test('Settings can replay the tutorial after it was seen', async () => {
    mockSettings.tutorial_seen_version = '1';
    const root = await launch();
    expect(hasText(root, 'Welcome to TxnTrace')).toBe(false);

    await press(root, 'Show App Tutorial');
    expect(hasText(root, 'Welcome to TxnTrace')).toBe(true);
    await press(root, 'Skip');
    expect(hasText(root, 'Welcome to TxnTrace')).toBe(false);
    // A replay never asks for permissions again.
    await flush();
    expect(Contacts.requestPermission).not.toHaveBeenCalled();
  });
});
