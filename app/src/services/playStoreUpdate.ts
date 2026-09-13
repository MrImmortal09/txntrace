import { NativeModules, NativeEventEmitter, Platform, Alert, BackHandler, Linking } from 'react-native';

const { PlayStoreUpdateModule } = NativeModules;

export const updateEventEmitter =
  Platform.OS === 'android' && PlayStoreUpdateModule
    ? new NativeEventEmitter(PlayStoreUpdateModule)
    : null;

export interface AppUpdateInfo {
  updateAvailable: boolean;
  developerTriggeredUpdateInProgress: boolean;
  availableVersionCode: number;
  immediateAllowed: boolean;
  flexibleAllowed: boolean;
  updatePriority: number;
  clientVersionStalenessDays: number;
}

export enum InstallStatus {
  UNKNOWN = 0,
  PENDING = 1,
  DOWNLOADING = 2,
  INSTALLING = 3,
  INSTALLED = 4,
  FAILED = 5,
  CANCELED = 6,
  DOWNLOADED = 11,
}

export interface InstallStateEvent {
  installStatus: number;
  installErrorCode: number;
  bytesDownloaded: number;
  totalBytesToDownload: number;
}

export const PLAY_STORE_MARKET_URL = 'market://details?id=com.chanakya.txntrace';
export const PLAY_STORE_WEB_URL = 'https://play.google.com/store/apps/details?id=com.chanakya.txntrace';

let isFallbackAlertVisible = false;
let activeCheckPromise: Promise<boolean> | null = null;
let isUpdateFlowActive = false;

// Set up automatic listener for flexible update completion
if (updateEventEmitter) {
  try {
    updateEventEmitter.addListener('onInstallStateChanged', (rawEvent: any) => {
      const event = rawEvent as InstallStateEvent;
      if (event && event.installStatus === InstallStatus.DOWNLOADED) {
        Alert.alert(
          'Update Downloaded',
          'An update has been downloaded. Restart the app now to complete the update.',
          [
            {
              text: 'Restart Now',
              onPress: () => {
                completeUpdate();
              },
            },
          ],
          { cancelable: false }
        );
      }
    });
  } catch (err) {
    console.warn('[PlayStoreUpdate] Failed to attach install state listener:', err);
  }
}

/**
 * Checks with the Google Play Store if a higher versionCode is available for this app.
 * Returns null on non-Android platforms or when the native module is unavailable.
 */
export const checkForPlayStoreUpdate = async (): Promise<AppUpdateInfo | null> => {
  if (Platform.OS !== 'android' || !PlayStoreUpdateModule) {
    return null;
  }

  try {
    const info: AppUpdateInfo = await PlayStoreUpdateModule.checkForUpdate();
    return info;
  } catch (error) {
    console.warn('[PlayStoreUpdate] Failed to check for update:', error);
    return null;
  }
};

/**
 * Opens the Google Play Store app page directly via market scheme,
 * falling back to the standard web URL if market scheme cannot be handled.
 */
export const openPlayStore = async (): Promise<boolean> => {
  try {
    const canOpen = await Linking.canOpenURL(PLAY_STORE_MARKET_URL);
    if (canOpen) {
      await Linking.openURL(PLAY_STORE_MARKET_URL);
      return true;
    }
  } catch {
    // Fall back to web URL
  }

  try {
    await Linking.openURL(PLAY_STORE_WEB_URL);
    return true;
  } catch (err) {
    console.error('[PlayStoreUpdate] Failed to open Play Store:', err);
    return false;
  }
};

/**
 * Launches Google Play's full-screen immediate update flow.
 * Google Play completely blocks the app UI until the update is downloaded and installed.
 */
export const startImmediateUpdate = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PlayStoreUpdateModule) {
    return false;
  }

  isUpdateFlowActive = true;
  try {
    const success: boolean = await PlayStoreUpdateModule.startImmediateUpdate();
    return success;
  } catch (error) {
    console.error('[PlayStoreUpdate] Failed to start immediate update flow:', error);
    throw error;
  } finally {
    isUpdateFlowActive = false;
  }
};

/**
 * Launches Google Play's background flexible update flow.
 */
export const startFlexibleUpdate = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PlayStoreUpdateModule) {
    return false;
  }

  isUpdateFlowActive = true;
  try {
    const success: boolean = await PlayStoreUpdateModule.startFlexibleUpdate();
    return success;
  } catch (error) {
    console.error('[PlayStoreUpdate] Failed to start flexible update flow:', error);
    throw error;
  } finally {
    isUpdateFlowActive = false;
  }
};

/**
 * Completes a flexible update by restarting the app.
 */
export const completeUpdate = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PlayStoreUpdateModule) {
    return false;
  }

  try {
    const success: boolean = await PlayStoreUpdateModule.completeUpdate();
    return success;
  } catch (error) {
    console.error('[PlayStoreUpdate] Failed to complete update:', error);
    return false;
  }
};

/**
 * Checks for updates and enforces a mandatory update if one is available.
 * If the user backs out or cancels Google Play's prompt, a blocking dialog is shown
 * allowing only "Update Now" or "Exit App".
 *
 * Concurrent calls are deduplicated so only one check/update runs at a time.
 */
export const checkAndEnforceImmediateUpdate = async (options?: { manual?: boolean }): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    if (options?.manual) {
      Alert.alert('In-App Updates', 'Google Play In-App Updates are only available on Android devices.');
    }
    return false;
  }

  if (!PlayStoreUpdateModule) {
    if (options?.manual) {
      Alert.alert('Unavailable', 'Play Store update module is not available.');
    }
    return false;
  }

  // If an update UI flow is already active on screen, do not initiate another check
  if (isUpdateFlowActive) {
    return true;
  }

  // If a check is already in-flight, reuse it
  if (activeCheckPromise) {
    return activeCheckPromise;
  }

  activeCheckPromise = (async () => {
    try {
      const info = await checkForPlayStoreUpdate();

      if (!info) {
        if (options?.manual) {
          Alert.alert('Check Failed', 'Could not check for updates. Please check your internet connection.');
        }
        return false;
      }

      const isUpdateNeeded = info.updateAvailable || info.developerTriggeredUpdateInProgress;

      if (isUpdateNeeded) {
        if (info.immediateAllowed) {
          try {
            const result = await startImmediateUpdate();
            if (!result) {
              // User cancelled the prompt
              promptMandatoryUpdateFallback();
            }
            return result;
          } catch (err) {
            console.error('[PlayStoreUpdate] Error starting immediate update:', err);
            promptMandatoryUpdateFallback();
            return false;
          }
        } else if (info.flexibleAllowed) {
          try {
            const result = await startFlexibleUpdate();
            if (!result) {
              promptMandatoryUpdateFallback();
            }
            return result;
          } catch (err) {
            console.error('[PlayStoreUpdate] Error starting flexible update:', err);
            promptMandatoryUpdateFallback();
            return false;
          }
        } else {
          promptMandatoryUpdateFallback();
          return false;
        }
      } else {
        if (options?.manual) {
          Alert.alert('Up to Date', 'TxnTrace is already at the latest version.');
        }
        return false;
      }
    } finally {
      activeCheckPromise = null;
    }
  })();

  return activeCheckPromise;
};

/**
 * Blocking dialog that prevents the user from using outdated app versions
 * when an update is mandatory.
 */
export const promptMandatoryUpdateFallback = () => {
  if (isFallbackAlertVisible) {
    return;
  }
  isFallbackAlertVisible = true;

  Alert.alert(
    'Update Required',
    'A new version of TxnTrace is required to continue. Please update the app via Google Play.',
    [
      {
        text: 'Exit App',
        style: 'destructive',
        onPress: () => {
          isFallbackAlertVisible = false;
          BackHandler.exitApp();
        },
      },
      {
        text: 'Update Now',
        onPress: () => {
          isFallbackAlertVisible = false;
          openPlayStore().then(success => {
            if (!success) {
              checkAndEnforceImmediateUpdate();
            }
          });
        },
      },
    ],
    { cancelable: false }
  );
};

/**
 * Resets internal flags. Used for unit test isolation.
 */
export const _resetInternalState = () => {
  isFallbackAlertVisible = false;
  activeCheckPromise = null;
  isUpdateFlowActive = false;
};
