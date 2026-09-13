import { NativeModules, Platform, Alert, BackHandler, Linking } from 'react-native';

const { PlayStoreUpdateModule } = NativeModules;

export interface AppUpdateInfo {
  updateAvailable: boolean;
  developerTriggeredUpdateInProgress: boolean;
  availableVersionCode: number;
  immediateAllowed: boolean;
  flexibleAllowed: boolean;
  updatePriority: number;
  clientVersionStalenessDays: number;
}

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.chanakya.txntrace';

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
 * Launches Google Play's full-screen immediate update flow.
 * Google Play completely blocks the app UI until the update is downloaded and installed.
 */
export const startImmediateUpdate = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PlayStoreUpdateModule) {
    return false;
  }

  try {
    const success: boolean = await PlayStoreUpdateModule.startImmediateUpdate();
    return success;
  } catch (error) {
    console.error('[PlayStoreUpdate] Failed to start immediate update flow:', error);
    throw error;
  }
};

/**
 * Launches Google Play's background flexible update flow.
 */
export const startFlexibleUpdate = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PlayStoreUpdateModule) {
    return false;
  }

  try {
    const success: boolean = await PlayStoreUpdateModule.startFlexibleUpdate();
    return success;
  } catch (error) {
    console.error('[PlayStoreUpdate] Failed to start flexible update flow:', error);
    throw error;
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
        return await startFlexibleUpdate();
      } catch (err) {
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
};

/**
 * Blocking dialog that prevents the user from using outdated app versions
 * when an update is mandatory.
 */
export const promptMandatoryUpdateFallback = () => {
  Alert.alert(
    'Update Required',
    'A new version of TxnTrace is required to continue. Please update the app via Google Play.',
    [
      {
        text: 'Exit App',
        style: 'destructive',
        onPress: () => {
          BackHandler.exitApp();
        },
      },
      {
        text: 'Update Now',
        onPress: () => {
          Linking.openURL(PLAY_STORE_URL).catch(() => {
            // If opening market URL fails, try to re-trigger in-app flow
            checkAndEnforceImmediateUpdate();
          });
        },
      },
    ],
    { cancelable: false }
  );
};
