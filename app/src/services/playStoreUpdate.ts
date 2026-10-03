import { useSyncExternalStore } from 'react';
import { NativeModules, NativeEventEmitter, Platform, Alert, BackHandler, Linking } from 'react-native';
import { getSetting, setSetting } from './appSettings';

const { PlayStoreUpdateModule } = NativeModules;

export const updateEventEmitter =
  Platform.OS === 'android' && PlayStoreUpdateModule
    ? new NativeEventEmitter(PlayStoreUpdateModule)
    : null;

export interface AppUpdateInfo {
  updateAvailable: boolean;
  developerTriggeredUpdateInProgress: boolean;
  availableVersionCode: number;
  installStatus?: number;
  bytesDownloaded?: number;
  totalBytesToDownload?: number;
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

/**
 * Where a background (flexible) update currently stands. Once it is `ready`, the native side
 * installs it silently the next time the phone is idle (see UpdateInstallJobService).
 */
export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; percent: number | null }
  | { phase: 'ready' };

export const PLAY_STORE_MARKET_URL = 'market://details?id=com.chanakya.txntrace';
export const PLAY_STORE_WEB_URL = 'https://play.google.com/store/apps/details?id=com.chanakya.txntrace';

/**
 * Play in-app update priority (0-5, set per release when uploading) from which an update is
 * mandatory and blocks the app. Anything lower downloads in the background.
 */
export const CRITICAL_UPDATE_PRIORITY = 4;

// After "No thanks" on Play's update prompt, don't offer that same version again for this long.
const DECLINE_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const DECLINED_UPDATE_KEY = 'declined_app_update';

// How long Play gets to start reporting a download the user has just accepted.
const ACCEPT_GRACE_MS = 60 * 1000;

const IDLE: UpdateStatus = { phase: 'idle' };

let isFallbackAlertVisible = false;
let isDownloadedAlertVisible = false;
let activeCheckPromise: Promise<boolean> | null = null;
// Whether the in-flight check was asked for by the user, and so should report its outcome
let isManualCheck = false;
let isUpdateFlowActive = false;
let flexibleAcceptedAt = 0;
// The update on offer is critical, so it must be restarted into as soon as it has downloaded
let isRestartMandatory = false;
// Mirrors the persisted decline, which can't be saved before the first database setup
let declinedVersionCode: number | null = null;
let updateStatus: UpdateStatus = IDLE;
const statusListeners = new Set<() => void>();

export const getUpdateStatus = (): UpdateStatus => updateStatus;

const subscribeToUpdateStatus = (listener: () => void) => {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
};

/** Re-renders the calling component whenever the background update makes progress. */
export const useUpdateStatus = (): UpdateStatus => useSyncExternalStore(subscribeToUpdateStatus, getUpdateStatus);

const setUpdateStatus = (next: UpdateStatus) => {
  const unchanged =
    next.phase === updateStatus.phase &&
    (next.phase !== 'downloading' || next.percent === (updateStatus as typeof next).percent);
  if (unchanged) {
    return;
  }
  updateStatus = next;
  statusListeners.forEach(listener => listener());
};

const statusFromInstallState = (installStatus?: number, bytesDownloaded = 0, totalBytes = 0): UpdateStatus => {
  switch (installStatus) {
    case InstallStatus.PENDING:
    case InstallStatus.DOWNLOADING:
      return {
        phase: 'downloading',
        percent: totalBytes > 0 ? Math.floor((bytesDownloaded / totalBytes) * 100) : null,
      };
    case InstallStatus.DOWNLOADED:
    case InstallStatus.INSTALLING:
      return { phase: 'ready' };
    default:
      return IDLE;
  }
};

/**
 * Folds the install state returned by a check into `updateStatus`. The install listener is the
 * live source, so a check must not undo something the listener reported more recently.
 */
const reconcileUpdateStatus = (reported: UpdateStatus) => {
  // Play can take a moment to report a download the user has only just accepted
  const justAccepted = Date.now() - flexibleAcceptedAt < ACCEPT_GRACE_MS;
  if (reported.phase === 'idle' && updateStatus.phase === 'downloading' && justAccepted) {
    return;
  }
  // A check that was already in flight when the download finished still says "downloading"
  if (reported.phase === 'downloading' && updateStatus.phase === 'ready') {
    return;
  }
  setUpdateStatus(reported);
};

/**
 * Prompts the user to restart the app when an update has completed downloading.
 * Blocking by default (used for mandatory updates); pass `dismissible` to let the user put it
 * off, in which case the update installs once the phone is idle.
 * Guarded to prevent duplicate dialogs.
 */
export const promptUpdateDownloaded = (options?: { dismissible?: boolean }) => {
  if (isDownloadedAlertVisible) {
    return;
  }
  isDownloadedAlertVisible = true;

  const restart = {
    text: 'Restart Now',
    onPress: () => {
      isDownloadedAlertVisible = false;
      completeUpdate();
    },
  };

  if (options?.dismissible) {
    const dismiss = () => {
      isDownloadedAlertVisible = false;
    };
    Alert.alert(
      'Update Ready',
      'The update has been downloaded and will install when your phone is idle. Restart now to use it straight away.',
      [{ text: 'Later', style: 'cancel', onPress: dismiss }, restart],
      { cancelable: true, onDismiss: dismiss }
    );
    return;
  }

  Alert.alert(
    'Update Downloaded',
    'An update has been downloaded. Restart the app now to complete the update.',
    [restart],
    { cancelable: false }
  );
};

// Keep the update status in step with Play's download progress
if (updateEventEmitter) {
  try {
    updateEventEmitter.addListener('onInstallStateChanged', (rawEvent: any) => {
      const event = rawEvent as InstallStateEvent;
      if (!event) {
        return;
      }
      setUpdateStatus(statusFromInstallState(event.installStatus, event.bytesDownloaded, event.totalBytesToDownload));
      if (event.installStatus === InstallStatus.DOWNLOADED && isRestartMandatory) {
        promptUpdateDownloaded();
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
 * Launches Google Play's background flexible update flow. Resolves true once the user accepts
 * Play's prompt (the download then carries on in the background), false if they decline it.
 */
export const startFlexibleUpdate = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !PlayStoreUpdateModule) {
    return false;
  }

  isUpdateFlowActive = true;
  try {
    const success: boolean = await PlayStoreUpdateModule.startFlexibleUpdate();
    if (success) {
      flexibleAcceptedAt = Date.now();
      if (updateStatus.phase === 'idle') {
        setUpdateStatus({ phase: 'downloading', percent: null });
      }
    }
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

const wasRecentlyDeclined = async (versionCode: number): Promise<boolean> => {
  if (declinedVersionCode === versionCode) {
    return true;
  }
  try {
    const raw = await getSetting(DECLINED_UPDATE_KEY);
    if (!raw) {
      return false;
    }
    const declined = JSON.parse(raw);
    return declined.versionCode === versionCode && Date.now() - declined.at < DECLINE_SNOOZE_MS;
  } catch {
    // app_settings doesn't exist until the first database setup has run; nothing declined yet.
    return false;
  }
};

const rememberDeclined = async (versionCode: number) => {
  declinedVersionCode = versionCode;
  try {
    await setSetting(DECLINED_UPDATE_KEY, JSON.stringify({ versionCode, at: Date.now() }));
  } catch (err) {
    console.warn('[PlayStoreUpdate] Failed to remember declined update:', err);
  }
};

/**
 * Mandatory path for critical releases: Play's blocking immediate flow, and a blocking
 * "Update Now / Exit App" dialog if the user backs out of it.
 */
const enforceCriticalUpdate = async (info: AppUpdateInfo): Promise<boolean> => {
  if (updateStatus.phase === 'ready') {
    promptUpdateDownloaded();
    return true;
  }
  if (!info.immediateAllowed && updateStatus.phase === 'downloading') {
    // Already coming down through the flexible flow; the install listener insists on the
    // restart as soon as it lands.
    return true;
  }

  const startUpdate = info.immediateAllowed
    ? startImmediateUpdate
    : info.flexibleAllowed
      ? startFlexibleUpdate
      : null;
  try {
    if (startUpdate && (await startUpdate())) {
      return true;
    }
  } catch {
    // Already logged by the start function
  }
  promptMandatoryUpdateFallback();
  return false;
};

/**
 * Default path: let Play download the update in the background while the user carries on.
 * Nothing here blocks the app, and a declined update isn't offered again for a few days.
 */
const offerBackgroundUpdate = async (info: AppUpdateInfo): Promise<boolean> => {
  if (updateStatus.phase === 'ready') {
    if (isManualCheck) {
      promptUpdateDownloaded({ dismissible: true });
    }
    return true;
  }

  if (updateStatus.phase === 'downloading') {
    if (isManualCheck) {
      Alert.alert(
        'Update Downloading',
        'An update is downloading in the background. It will install when your phone is idle.'
      );
    }
    return true;
  }

  if (!info.flexibleAllowed) {
    if (isManualCheck) {
      Alert.alert('Update Available', 'A new version of TxnTrace is available on Google Play.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Open Play Store', onPress: () => openPlayStore() },
      ]);
    }
    return false;
  }

  const declined = await wasRecentlyDeclined(info.availableVersionCode);
  if (declined && !isManualCheck) {
    return false;
  }

  try {
    const accepted = await startFlexibleUpdate();
    if (!accepted) {
      await rememberDeclined(info.availableVersionCode);
    }
    return accepted;
  } catch {
    if (isManualCheck) {
      Alert.alert('Update Failed', 'Could not start the update. Please try again later.');
    }
    return false;
  }
};

/**
 * Checks Google Play for a newer version and keeps the app up to date with as little
 * interruption as possible:
 *
 * - Normal releases download in the background (flexible flow) and are installed silently
 *   by the native side once the phone is idle.
 * - Releases published with in-app update priority >= CRITICAL_UPDATE_PRIORITY are mandatory
 *   and go through Play's blocking immediate flow.
 *
 * Resolves true when an update is underway. Pass `manual` for a user-initiated check, which
 * reports the outcome and ignores an earlier "No thanks".
 * Concurrent calls are deduplicated so only one check/update runs at a time.
 */
export const checkForAppUpdate = async (options?: { manual?: boolean }): Promise<boolean> => {
  const manual = !!options?.manual;

  if (Platform.OS !== 'android') {
    if (manual) {
      Alert.alert('In-App Updates', 'Google Play In-App Updates are only available on Android devices.');
    }
    return false;
  }

  if (!PlayStoreUpdateModule) {
    if (manual) {
      Alert.alert('Unavailable', 'Play Store update module is not available.');
    }
    return false;
  }

  // If the mandatory fallback alert is already visible, do not trigger another check
  if (isFallbackAlertVisible) {
    return false;
  }

  // If an update UI flow is already active on screen, do not initiate another check
  if (isUpdateFlowActive) {
    return true;
  }

  // If a check is already in-flight, reuse it, and have it answer the user if they asked
  if (activeCheckPromise) {
    isManualCheck = isManualCheck || manual;
    return activeCheckPromise;
  }

  isManualCheck = manual;
  activeCheckPromise = (async () => {
    try {
      const info = await checkForPlayStoreUpdate();

      if (!info) {
        if (isManualCheck) {
          Alert.alert('Check Failed', 'Could not check for updates. Please check your internet connection.');
        }
        return false;
      }

      reconcileUpdateStatus(
        statusFromInstallState(info.installStatus, info.bytesDownloaded, info.totalBytesToDownload)
      );
      isRestartMandatory = info.updatePriority >= CRITICAL_UPDATE_PRIORITY;

      if (info.installStatus === InstallStatus.INSTALLING) {
        return true;
      }

      const updateUnderway = updateStatus.phase !== 'idle';
      if (!updateUnderway && !info.updateAvailable && !info.developerTriggeredUpdateInProgress) {
        if (isManualCheck) {
          Alert.alert('Up to Date', 'TxnTrace is already at the latest version.');
        }
        return false;
      }

      return isRestartMandatory ? await enforceCriticalUpdate(info) : await offerBackgroundUpdate(info);
    } finally {
      activeCheckPromise = null;
      isManualCheck = false;
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
              checkForAppUpdate();
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
  isDownloadedAlertVisible = false;
  activeCheckPromise = null;
  isManualCheck = false;
  isUpdateFlowActive = false;
  flexibleAcceptedAt = 0;
  isRestartMandatory = false;
  declinedVersionCode = null;
  updateStatus = IDLE;
};
