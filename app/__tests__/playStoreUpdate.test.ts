import {
  checkForPlayStoreUpdate,
  startImmediateUpdate,
  startFlexibleUpdate,
  completeUpdate,
  checkAndEnforceImmediateUpdate,
  promptMandatoryUpdateFallback,
  openPlayStore,
  _resetInternalState,
  PLAY_STORE_MARKET_URL,
  PLAY_STORE_WEB_URL,
} from '../src/services/playStoreUpdate';
import { NativeModules, Platform, Alert, BackHandler, Linking } from 'react-native';

const mockEventEmitterInstance = {
  addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  removeAllListeners: jest.fn(),
  emit: jest.fn(),
};

jest.mock('react-native', () => {
  class MockNativeEventEmitter {
    addListener = jest.fn().mockReturnValue({ remove: jest.fn() });
    removeAllListeners = jest.fn();
    emit = jest.fn();
  }

  return {
    NativeModules: {
      PlayStoreUpdateModule: {
        checkForUpdate: jest.fn(),
        startImmediateUpdate: jest.fn(),
        startFlexibleUpdate: jest.fn(),
        completeUpdate: jest.fn(),
      },
    },
    NativeEventEmitter: MockNativeEventEmitter,
    Platform: {
      OS: 'android',
      select: jest.fn((obj: any) => obj.android || obj.default),
    },
    Alert: {
      alert: jest.fn(),
    },
    BackHandler: {
      exitApp: jest.fn(),
    },
    Linking: {
      openURL: jest.fn().mockResolvedValue(true),
      canOpenURL: jest.fn().mockResolvedValue(true),
    },
  };
});

describe('playStoreUpdate service', () => {
  const mockModule = NativeModules.PlayStoreUpdateModule;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetInternalState();
    Platform.OS = 'android';
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    (Linking.openURL as jest.Mock).mockResolvedValue(true);
  });

  describe('checkForPlayStoreUpdate', () => {
    test('returns null on iOS', async () => {
      Platform.OS = 'ios';
      const result = await checkForPlayStoreUpdate();
      expect(result).toBeNull();
      expect(mockModule.checkForUpdate).not.toHaveBeenCalled();
    });

    test('returns update info on Android when update available', async () => {
      const mockInfo = {
        updateAvailable: true,
        developerTriggeredUpdateInProgress: false,
        availableVersionCode: 102,
        immediateAllowed: true,
        flexibleAllowed: false,
        updatePriority: 4,
        clientVersionStalenessDays: 3,
      };
      mockModule.checkForUpdate.mockResolvedValue(mockInfo);

      const result = await checkForPlayStoreUpdate();
      expect(result).toEqual(mockInfo);
      expect(mockModule.checkForUpdate).toHaveBeenCalledTimes(1);
    });

    test('returns null when native call rejects', async () => {
      mockModule.checkForUpdate.mockRejectedValue(new Error('Network error'));
      const result = await checkForPlayStoreUpdate();
      expect(result).toBeNull();
    });
  });

  describe('openPlayStore', () => {
    test('opens market URL directly when supported', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
      const success = await openPlayStore();
      expect(success).toBe(true);
      expect(Linking.canOpenURL).toHaveBeenCalledWith(PLAY_STORE_MARKET_URL);
      expect(Linking.openURL).toHaveBeenCalledWith(PLAY_STORE_MARKET_URL);
    });

    test('falls back to web URL when market scheme is not supported', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
      const success = await openPlayStore();
      expect(success).toBe(true);
      expect(Linking.openURL).toHaveBeenCalledWith(PLAY_STORE_WEB_URL);
    });

    test('falls back to web URL when canOpenURL throws', async () => {
      (Linking.canOpenURL as jest.Mock).mockRejectedValue(new Error('Schema error'));
      const success = await openPlayStore();
      expect(success).toBe(true);
      expect(Linking.openURL).toHaveBeenCalledWith(PLAY_STORE_WEB_URL);
    });
  });

  describe('startImmediateUpdate', () => {
    test('returns false on iOS', async () => {
      Platform.OS = 'ios';
      const result = await startImmediateUpdate();
      expect(result).toBe(false);
      expect(mockModule.startImmediateUpdate).not.toHaveBeenCalled();
    });

    test('calls native module on Android and returns success boolean', async () => {
      mockModule.startImmediateUpdate.mockResolvedValue(true);
      const result = await startImmediateUpdate();
      expect(result).toBe(true);
      expect(mockModule.startImmediateUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('startFlexibleUpdate and completeUpdate', () => {
    test('startFlexibleUpdate delegates to native module on Android', async () => {
      mockModule.startFlexibleUpdate.mockResolvedValue(true);
      const result = await startFlexibleUpdate();
      expect(result).toBe(true);
      expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
    });

    test('completeUpdate delegates to native module on Android', async () => {
      mockModule.completeUpdate.mockResolvedValue(true);
      const result = await completeUpdate();
      expect(result).toBe(true);
      expect(mockModule.completeUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAndEnforceImmediateUpdate', () => {
    test('does nothing on non-Android platform', async () => {
      Platform.OS = 'ios';
      const result = await checkAndEnforceImmediateUpdate();
      expect(result).toBe(false);
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    test('shows alert on non-Android platform when checked manually', async () => {
      Platform.OS = 'ios';
      const result = await checkAndEnforceImmediateUpdate({ manual: true });
      expect(result).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        'In-App Updates',
        expect.stringContaining('only available on Android')
      );
    });

    test('enforces immediate update when update is available and immediateAllowed is true', async () => {
      mockModule.checkForUpdate.mockResolvedValue({
        updateAvailable: true,
        developerTriggeredUpdateInProgress: false,
        availableVersionCode: 105,
        immediateAllowed: true,
        flexibleAllowed: true,
        updatePriority: 5,
        clientVersionStalenessDays: 2,
      });
      mockModule.startImmediateUpdate.mockResolvedValue(true);

      const result = await checkAndEnforceImmediateUpdate();
      expect(result).toBe(true);
      expect(mockModule.startImmediateUpdate).toHaveBeenCalledTimes(1);
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    test('resumes immediate update when developerTriggeredUpdateInProgress is true', async () => {
      mockModule.checkForUpdate.mockResolvedValue({
        updateAvailable: false,
        developerTriggeredUpdateInProgress: true,
        availableVersionCode: 105,
        immediateAllowed: true,
        flexibleAllowed: false,
        updatePriority: 5,
        clientVersionStalenessDays: 2,
      });
      mockModule.startImmediateUpdate.mockResolvedValue(true);

      const result = await checkAndEnforceImmediateUpdate();
      expect(result).toBe(true);
      expect(mockModule.startImmediateUpdate).toHaveBeenCalledTimes(1);
    });

    test('shows mandatory update blocking alert if user cancels immediate update flow', async () => {
      mockModule.checkForUpdate.mockResolvedValue({
        updateAvailable: true,
        developerTriggeredUpdateInProgress: false,
        availableVersionCode: 105,
        immediateAllowed: true,
        flexibleAllowed: false,
        updatePriority: 5,
        clientVersionStalenessDays: 2,
      });
      mockModule.startImmediateUpdate.mockResolvedValue(false); // User cancelled prompt

      const result = await checkAndEnforceImmediateUpdate();
      expect(result).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Update Required',
        expect.stringContaining('A new version of TxnTrace is required to continue'),
        expect.any(Array),
        { cancelable: false }
      );
    });

    test('shows mandatory update blocking alert if immediate update throws error', async () => {
      mockModule.checkForUpdate.mockResolvedValue({
        updateAvailable: true,
        developerTriggeredUpdateInProgress: false,
        availableVersionCode: 105,
        immediateAllowed: true,
        flexibleAllowed: false,
        updatePriority: 5,
        clientVersionStalenessDays: 2,
      });
      mockModule.startImmediateUpdate.mockRejectedValue(new Error('Update failed'));

      const result = await checkAndEnforceImmediateUpdate();
      expect(result).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Update Required',
        expect.stringContaining('A new version of TxnTrace is required to continue'),
        expect.any(Array),
        { cancelable: false }
      );
    });

    test('triggers flexible update when immediateAllowed is false and flexibleAllowed is true', async () => {
      mockModule.checkForUpdate.mockResolvedValue({
        updateAvailable: true,
        developerTriggeredUpdateInProgress: false,
        availableVersionCode: 105,
        immediateAllowed: false,
        flexibleAllowed: true,
        updatePriority: 2,
        clientVersionStalenessDays: 1,
      });
      mockModule.startFlexibleUpdate.mockResolvedValue(true);

      const result = await checkAndEnforceImmediateUpdate();
      expect(result).toBe(true);
      expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
    });

    test('shows mandatory fallback if flexible update is cancelled by user', async () => {
      mockModule.checkForUpdate.mockResolvedValue({
        updateAvailable: true,
        developerTriggeredUpdateInProgress: false,
        availableVersionCode: 105,
        immediateAllowed: false,
        flexibleAllowed: true,
        updatePriority: 2,
        clientVersionStalenessDays: 1,
      });
      mockModule.startFlexibleUpdate.mockResolvedValue(false);

      const result = await checkAndEnforceImmediateUpdate();
      expect(result).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Update Required',
        expect.stringContaining('A new version of TxnTrace is required to continue'),
        expect.any(Array),
        { cancelable: false }
      );
    });

    test('shows up to date alert when checked manually and no update available', async () => {
      mockModule.checkForUpdate.mockResolvedValue({
        updateAvailable: false,
        developerTriggeredUpdateInProgress: false,
        availableVersionCode: 100,
        immediateAllowed: false,
        flexibleAllowed: false,
        updatePriority: 0,
        clientVersionStalenessDays: 0,
      });

      const result = await checkAndEnforceImmediateUpdate({ manual: true });
      expect(result).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith('Up to Date', expect.stringContaining('already at the latest version'));
    });

    test('deduplicates concurrent checks so only one check is initiated', async () => {
      mockModule.checkForUpdate.mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve({
                  updateAvailable: true,
                  developerTriggeredUpdateInProgress: false,
                  availableVersionCode: 105,
                  immediateAllowed: true,
                  flexibleAllowed: false,
                  updatePriority: 5,
                  clientVersionStalenessDays: 2,
                }),
              50
            )
          )
      );
      mockModule.startImmediateUpdate.mockResolvedValue(true);

      const [res1, res2] = await Promise.all([
        checkAndEnforceImmediateUpdate(),
        checkAndEnforceImmediateUpdate(),
      ]);

      expect(res1).toBe(true);
      expect(res2).toBe(true);
      expect(mockModule.checkForUpdate).toHaveBeenCalledTimes(1);
      expect(mockModule.startImmediateUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('promptMandatoryUpdateFallback', () => {
    test('shows non-cancelable alert with Exit App and Update Now actions', () => {
      promptMandatoryUpdateFallback();
      expect(Alert.alert).toHaveBeenCalledWith(
        'Update Required',
        expect.stringContaining('A new version of TxnTrace is required to continue'),
        [
          expect.objectContaining({ text: 'Exit App' }),
          expect.objectContaining({ text: 'Update Now' }),
        ],
        { cancelable: false }
      );

      // Trigger Exit App
      const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
      const exitAction = alertCall[2].find((b: any) => b.text === 'Exit App');
      exitAction.onPress();
      expect(BackHandler.exitApp).toHaveBeenCalledTimes(1);

      // Trigger Update Now
      const updateAction = alertCall[2].find((b: any) => b.text === 'Update Now');
      updateAction.onPress();
      expect(Linking.canOpenURL).toHaveBeenCalledWith(PLAY_STORE_MARKET_URL);
    });

    test('prevents multiple stacked dialogs when called repeatedly', () => {
      promptMandatoryUpdateFallback();
      promptMandatoryUpdateFallback();
      promptMandatoryUpdateFallback();

      expect(Alert.alert).toHaveBeenCalledTimes(1);
    });
  });
});
