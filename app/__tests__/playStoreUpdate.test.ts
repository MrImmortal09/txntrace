import {
  checkForPlayStoreUpdate,
  startImmediateUpdate,
  startFlexibleUpdate,
  completeUpdate,
  checkForAppUpdate,
  getUpdateStatus,
  promptMandatoryUpdateFallback,
  promptUpdateDownloaded,
  openPlayStore,
  updateEventEmitter,
  _resetInternalState,
  AppUpdateInfo,
  InstallStatus,
  CRITICAL_UPDATE_PRIORITY,
  PLAY_STORE_MARKET_URL,
  PLAY_STORE_WEB_URL,
} from '../src/services/playStoreUpdate';
import { getSetting, setSetting } from '../src/services/appSettings';
import { NativeModules, Platform, Alert, BackHandler, Linking } from 'react-native';

jest.mock('../src/services/appSettings', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}));

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

const DAY_MS = 24 * 60 * 60 * 1000;

const updateInfo = (overrides: Partial<AppUpdateInfo> = {}): AppUpdateInfo => ({
  updateAvailable: true,
  developerTriggeredUpdateInProgress: false,
  availableVersionCode: 105,
  installStatus: InstallStatus.UNKNOWN,
  immediateAllowed: true,
  flexibleAllowed: true,
  updatePriority: 0,
  clientVersionStalenessDays: 0,
  ...overrides,
});

describe('playStoreUpdate service', () => {
  const mockModule = NativeModules.PlayStoreUpdateModule;
  // Registered when the service module loads, so grab it before beforeEach clears the mock
  const emitInstallState = (updateEventEmitter!.addListener as jest.Mock).mock.calls[0][1];

  beforeEach(() => {
    jest.clearAllMocks();
    _resetInternalState();
    Platform.OS = 'android';
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    (Linking.openURL as jest.Mock).mockResolvedValue(true);
    (getSetting as jest.Mock).mockResolvedValue(null);
    (setSetting as jest.Mock).mockResolvedValue(undefined);
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

  describe('checkForAppUpdate', () => {
    test('does nothing on non-Android platform', async () => {
      Platform.OS = 'ios';
      const result = await checkForAppUpdate();
      expect(result).toBe(false);
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    test('shows alert on non-Android platform when checked manually', async () => {
      Platform.OS = 'ios';
      const result = await checkForAppUpdate({ manual: true });
      expect(result).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        'In-App Updates',
        expect.stringContaining('only available on Android')
      );
    });

    test('shows up to date alert when checked manually and no update available', async () => {
      mockModule.checkForUpdate.mockResolvedValue(updateInfo({ updateAvailable: false }));

      const result = await checkForAppUpdate({ manual: true });
      expect(result).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith('Up to Date', expect.stringContaining('already at the latest version'));
    });

    test('deduplicates concurrent checks so only one check is initiated', async () => {
      mockModule.checkForUpdate.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(updateInfo()), 50))
      );
      mockModule.startFlexibleUpdate.mockResolvedValue(true);

      const [res1, res2] = await Promise.all([checkForAppUpdate(), checkForAppUpdate()]);

      expect(res1).toBe(true);
      expect(res2).toBe(true);
      expect(mockModule.checkForUpdate).toHaveBeenCalledTimes(1);
      expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
    });

    test('a manual check that joins an automatic one still reports the outcome', async () => {
      mockModule.checkForUpdate.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(updateInfo({ updateAvailable: false })), 50))
      );

      const automatic = checkForAppUpdate();
      const manual = checkForAppUpdate({ manual: true });
      await Promise.all([automatic, manual]);

      expect(mockModule.checkForUpdate).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalledWith('Up to Date', expect.any(String));
    });

    test('a manual check that joins an automatic one overrides an earlier decline', async () => {
      (getSetting as jest.Mock).mockResolvedValue(JSON.stringify({ versionCode: 105, at: Date.now() }));
      mockModule.checkForUpdate.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(updateInfo({ availableVersionCode: 105 })), 50))
      );
      mockModule.startFlexibleUpdate.mockResolvedValue(true);

      await Promise.all([checkForAppUpdate(), checkForAppUpdate({ manual: true })]);

      expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
    });

    test('a later automatic check does not inherit an earlier manual one', async () => {
      mockModule.checkForUpdate.mockResolvedValue(updateInfo({ updateAvailable: false }));

      await checkForAppUpdate({ manual: true });
      (Alert.alert as jest.Mock).mockClear();
      await checkForAppUpdate();

      expect(Alert.alert).not.toHaveBeenCalled();
    });

    test('does nothing while Play is installing the update', async () => {
      mockModule.checkForUpdate.mockResolvedValue(
        updateInfo({ developerTriggeredUpdateInProgress: true, installStatus: InstallStatus.INSTALLING })
      );

      expect(await checkForAppUpdate({ manual: true })).toBe(true);
      expect(mockModule.startFlexibleUpdate).not.toHaveBeenCalled();
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    test('does not initiate check if fallback alert is currently visible', async () => {
      promptMandatoryUpdateFallback();
      expect(Alert.alert).toHaveBeenCalledTimes(1);

      const result = await checkForAppUpdate();
      expect(result).toBe(false);
      expect(mockModule.checkForUpdate).not.toHaveBeenCalled();
    });

    describe('normal updates download in the background', () => {
      test('starts the flexible flow instead of the blocking immediate flow', async () => {
        mockModule.checkForUpdate.mockResolvedValue(updateInfo());
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
        expect(mockModule.startImmediateUpdate).not.toHaveBeenCalled();
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(getUpdateStatus()).toEqual({ phase: 'downloading', percent: null });
      });

      test('stays out of the way when the user declines, and remembers the version', async () => {
        mockModule.checkForUpdate.mockResolvedValue(updateInfo({ availableVersionCode: 105 }));
        mockModule.startFlexibleUpdate.mockResolvedValue(false);

        const result = await checkForAppUpdate();
        expect(result).toBe(false);
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(BackHandler.exitApp).not.toHaveBeenCalled();
        expect(setSetting).toHaveBeenCalledTimes(1);
        const [, saved] = (setSetting as jest.Mock).mock.calls[0];
        expect(JSON.parse(saved).versionCode).toBe(105);
        expect(getUpdateStatus()).toEqual({ phase: 'idle' });
      });

      test('does not prompt again for a version that was declined recently', async () => {
        (getSetting as jest.Mock).mockResolvedValue(JSON.stringify({ versionCode: 105, at: Date.now() - DAY_MS }));
        mockModule.checkForUpdate.mockResolvedValue(updateInfo({ availableVersionCode: 105 }));

        const result = await checkForAppUpdate();
        expect(result).toBe(false);
        expect(mockModule.startFlexibleUpdate).not.toHaveBeenCalled();
        expect(Alert.alert).not.toHaveBeenCalled();
      });

      test('prompts again once a newer version is out', async () => {
        (getSetting as jest.Mock).mockResolvedValue(JSON.stringify({ versionCode: 105, at: Date.now() - DAY_MS }));
        mockModule.checkForUpdate.mockResolvedValue(updateInfo({ availableVersionCode: 106 }));
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        await checkForAppUpdate();
        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
      });

      test('prompts again once the decline has gone stale', async () => {
        (getSetting as jest.Mock).mockResolvedValue(JSON.stringify({ versionCode: 105, at: Date.now() - 4 * DAY_MS }));
        mockModule.checkForUpdate.mockResolvedValue(updateInfo({ availableVersionCode: 105 }));
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        await checkForAppUpdate();
        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
      });

      test('a manual check ignores an earlier decline', async () => {
        (getSetting as jest.Mock).mockResolvedValue(JSON.stringify({ versionCode: 105, at: Date.now() }));
        mockModule.checkForUpdate.mockResolvedValue(updateInfo({ availableVersionCode: 105 }));
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        const result = await checkForAppUpdate({ manual: true });
        expect(result).toBe(true);
        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
      });

      test('still offers the update when the settings table cannot be read', async () => {
        (getSetting as jest.Mock).mockRejectedValue(new Error('no such table: app_settings'));
        mockModule.checkForUpdate.mockResolvedValue(updateInfo());
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
      });

      test('remembers a decline even when the settings table cannot be written yet', async () => {
        (getSetting as jest.Mock).mockRejectedValue(new Error('no such table: app_settings'));
        (setSetting as jest.Mock).mockRejectedValue(new Error('no such table: app_settings'));
        mockModule.checkForUpdate.mockResolvedValue(updateInfo());
        mockModule.startFlexibleUpdate.mockResolvedValue(false);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await checkForAppUpdate();
        await checkForAppUpdate();

        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
      });

      test('never forces the immediate flow when flexible is not allowed', async () => {
        mockModule.checkForUpdate.mockResolvedValue(updateInfo({ flexibleAllowed: false }));

        const result = await checkForAppUpdate();
        expect(result).toBe(false);
        expect(mockModule.startImmediateUpdate).not.toHaveBeenCalled();
        expect(mockModule.startFlexibleUpdate).not.toHaveBeenCalled();
        expect(Alert.alert).not.toHaveBeenCalled();
      });

      test('a manual check offers the Play Store when flexible is not allowed', async () => {
        mockModule.checkForUpdate.mockResolvedValue(updateInfo({ flexibleAllowed: false }));

        await checkForAppUpdate({ manual: true });
        expect(Alert.alert).toHaveBeenCalledWith('Update Available', expect.any(String), expect.any(Array));

        const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
        buttons.find((b: any) => b.text === 'Open Play Store').onPress();
        expect(Linking.canOpenURL).toHaveBeenCalledWith(PLAY_STORE_MARKET_URL);
      });

      test('reports a failed flow only on a manual check', async () => {
        mockModule.checkForUpdate.mockResolvedValue(updateInfo());
        mockModule.startFlexibleUpdate.mockRejectedValue(new Error('Update failed'));
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(await checkForAppUpdate()).toBe(false);
        expect(Alert.alert).not.toHaveBeenCalled();

        expect(await checkForAppUpdate({ manual: true })).toBe(false);
        expect(Alert.alert).toHaveBeenCalledWith('Update Failed', expect.any(String));
        errorSpy.mockRestore();
      });

      test('leaves a download that is already running alone', async () => {
        mockModule.checkForUpdate.mockResolvedValue(
          updateInfo({
            updateAvailable: false,
            developerTriggeredUpdateInProgress: true,
            installStatus: InstallStatus.DOWNLOADING,
            bytesDownloaded: 250,
            totalBytesToDownload: 1000,
          })
        );

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
        expect(mockModule.startFlexibleUpdate).not.toHaveBeenCalled();
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(getUpdateStatus()).toEqual({ phase: 'downloading', percent: 25 });
      });

      test('does not prompt twice if Play has not registered an accepted update yet', async () => {
        mockModule.checkForUpdate.mockResolvedValue(updateInfo());
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        await checkForAppUpdate();
        const result = await checkForAppUpdate();

        expect(result).toBe(true);
        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
      });

      test('offers the update again if Play never started the accepted download', async () => {
        mockModule.checkForUpdate.mockResolvedValue(updateInfo());
        mockModule.startFlexibleUpdate.mockResolvedValue(true);
        const start = Date.now();
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);

        await checkForAppUpdate();
        nowSpy.mockReturnValue(start + 5 * 60 * 1000);
        await checkForAppUpdate();

        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(2);
        nowSpy.mockRestore();
      });

      test('a stale check does not roll a finished download back to downloading', async () => {
        emitInstallState({ installStatus: InstallStatus.DOWNLOADED, bytesDownloaded: 1000, totalBytesToDownload: 1000 });
        mockModule.checkForUpdate.mockResolvedValue(
          updateInfo({
            updateAvailable: false,
            developerTriggeredUpdateInProgress: true,
            installStatus: InstallStatus.DOWNLOADING,
            bytesDownloaded: 970,
            totalBytesToDownload: 1000,
          })
        );

        expect(await checkForAppUpdate()).toBe(true);
        expect(getUpdateStatus()).toEqual({ phase: 'ready' });
        expect(mockModule.startFlexibleUpdate).not.toHaveBeenCalled();
      });

      test('waits silently once the update has downloaded', async () => {
        mockModule.checkForUpdate.mockResolvedValue(
          updateInfo({ updateAvailable: false, installStatus: InstallStatus.DOWNLOADED })
        );

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(getUpdateStatus()).toEqual({ phase: 'ready' });
      });

      test('a manual check offers a dismissible restart once the update has downloaded', async () => {
        mockModule.checkForUpdate.mockResolvedValue(
          updateInfo({ updateAvailable: false, installStatus: InstallStatus.DOWNLOADED })
        );
        mockModule.completeUpdate.mockResolvedValue(true);

        await checkForAppUpdate({ manual: true });
        expect(Alert.alert).toHaveBeenCalledWith(
          'Update Ready',
          expect.stringContaining('will install when your phone is idle'),
          [expect.objectContaining({ text: 'Later' }), expect.objectContaining({ text: 'Restart Now' })],
          expect.objectContaining({ cancelable: true })
        );

        const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
        buttons.find((b: any) => b.text === 'Restart Now').onPress();
        expect(mockModule.completeUpdate).toHaveBeenCalledTimes(1);
      });
    });

    describe('critical updates are mandatory', () => {
      const criticalInfo = (overrides: Partial<AppUpdateInfo> = {}) =>
        updateInfo({ updatePriority: CRITICAL_UPDATE_PRIORITY, ...overrides });

      const expectUpdateRequiredAlert = () =>
        expect(Alert.alert).toHaveBeenCalledWith(
          'Update Required',
          expect.stringContaining('A new version of TxnTrace is required to continue'),
          expect.any(Array),
          { cancelable: false }
        );

      test('enforces the immediate flow', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo());
        mockModule.startImmediateUpdate.mockResolvedValue(true);

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
        expect(mockModule.startImmediateUpdate).toHaveBeenCalledTimes(1);
        expect(mockModule.startFlexibleUpdate).not.toHaveBeenCalled();
        expect(Alert.alert).not.toHaveBeenCalled();
      });

      test('resumes a stalled immediate flow', async () => {
        mockModule.checkForUpdate.mockResolvedValue(
          criticalInfo({
            updateAvailable: false,
            developerTriggeredUpdateInProgress: true,
            installStatus: InstallStatus.DOWNLOADING,
          })
        );
        mockModule.startImmediateUpdate.mockResolvedValue(true);

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
        expect(mockModule.startImmediateUpdate).toHaveBeenCalledTimes(1);
      });

      test('ignores an earlier decline', async () => {
        (getSetting as jest.Mock).mockResolvedValue(JSON.stringify({ versionCode: 105, at: Date.now() }));
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo({ availableVersionCode: 105 }));
        mockModule.startImmediateUpdate.mockResolvedValue(true);

        await checkForAppUpdate();
        expect(mockModule.startImmediateUpdate).toHaveBeenCalledTimes(1);
      });

      test('shows the blocking alert if the user cancels the immediate flow', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo());
        mockModule.startImmediateUpdate.mockResolvedValue(false); // User cancelled prompt

        const result = await checkForAppUpdate();
        expect(result).toBe(false);
        expectUpdateRequiredAlert();
      });

      test('shows the blocking alert if the immediate flow throws', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo());
        mockModule.startImmediateUpdate.mockRejectedValue(new Error('Update failed'));
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const result = await checkForAppUpdate();
        expect(result).toBe(false);
        expectUpdateRequiredAlert();
        errorSpy.mockRestore();
      });

      test('falls back to the flexible flow when immediate is not allowed', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo({ immediateAllowed: false }));
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
      });

      test('insists on a restart as soon as that flexible download lands', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo({ immediateAllowed: false }));
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        await checkForAppUpdate();
        expect(Alert.alert).not.toHaveBeenCalled();

        emitInstallState({ installStatus: InstallStatus.DOWNLOADED, bytesDownloaded: 1000, totalBytesToDownload: 1000 });
        expect(Alert.alert).toHaveBeenCalledWith(
          'Update Downloaded',
          expect.stringContaining('Restart the app now to complete the update'),
          expect.any(Array),
          { cancelable: false }
        );
      });

      test('does not prompt twice while that flexible download is getting started', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo({ immediateAllowed: false }));
        mockModule.startFlexibleUpdate.mockResolvedValue(true);

        await checkForAppUpdate();
        expect(await checkForAppUpdate()).toBe(true);

        expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(1);
        expect(Alert.alert).not.toHaveBeenCalled();
      });

      test('shows the blocking alert if that flexible flow is declined', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo({ immediateAllowed: false }));
        mockModule.startFlexibleUpdate.mockResolvedValue(false);

        const result = await checkForAppUpdate();
        expect(result).toBe(false);
        expectUpdateRequiredAlert();
      });

      test('shows the blocking alert when no update flow is allowed', async () => {
        mockModule.checkForUpdate.mockResolvedValue(criticalInfo({ immediateAllowed: false, flexibleAllowed: false }));

        const result = await checkForAppUpdate();
        expect(result).toBe(false);
        expectUpdateRequiredAlert();
      });

      test('insists on a restart once the update has downloaded', async () => {
        mockModule.checkForUpdate.mockResolvedValue(
          criticalInfo({ updateAvailable: false, installStatus: InstallStatus.DOWNLOADED })
        );

        const result = await checkForAppUpdate();
        expect(result).toBe(true);
        expect(Alert.alert).toHaveBeenCalledWith(
          'Update Downloaded',
          expect.stringContaining('Restart the app now to complete the update'),
          expect.any(Array),
          { cancelable: false }
        );
      });
    });
  });

  describe('install state events', () => {
    test('track download progress without interrupting the user', () => {
      emitInstallState({ installStatus: InstallStatus.PENDING, bytesDownloaded: 0, totalBytesToDownload: 0 });
      expect(getUpdateStatus()).toEqual({ phase: 'downloading', percent: null });

      emitInstallState({ installStatus: InstallStatus.DOWNLOADING, bytesDownloaded: 420, totalBytesToDownload: 1000 });
      expect(getUpdateStatus()).toEqual({ phase: 'downloading', percent: 42 });

      emitInstallState({ installStatus: InstallStatus.DOWNLOADED, bytesDownloaded: 1000, totalBytesToDownload: 1000 });
      expect(getUpdateStatus()).toEqual({ phase: 'ready' });
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    test('a failed download lets the update be offered again', async () => {
      mockModule.checkForUpdate.mockResolvedValue(updateInfo());
      mockModule.startFlexibleUpdate.mockResolvedValue(true);
      await checkForAppUpdate();

      emitInstallState({ installStatus: InstallStatus.FAILED, bytesDownloaded: 0, totalBytesToDownload: 0 });
      expect(getUpdateStatus()).toEqual({ phase: 'idle' });

      await checkForAppUpdate();
      expect(mockModule.startFlexibleUpdate).toHaveBeenCalledTimes(2);
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

  describe('promptUpdateDownloaded', () => {
    test('shows non-cancelable alert and completes update on Restart Now', () => {
      mockModule.completeUpdate.mockResolvedValue(true);
      promptUpdateDownloaded();

      expect(Alert.alert).toHaveBeenCalledWith(
        'Update Downloaded',
        expect.stringContaining('Restart the app now to complete the update'),
        [expect.objectContaining({ text: 'Restart Now' })],
        { cancelable: false }
      );

      const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
      const restartAction = alertCall[2].find((b: any) => b.text === 'Restart Now');
      restartAction.onPress();

      expect(mockModule.completeUpdate).toHaveBeenCalledTimes(1);
    });

    test('prevents multiple stacked downloaded dialogs when called repeatedly', () => {
      promptUpdateDownloaded();
      promptUpdateDownloaded();
      promptUpdateDownloaded();

      expect(Alert.alert).toHaveBeenCalledTimes(1);
    });
  });
});
