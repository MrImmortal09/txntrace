import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Permission, PermissionsAndroid, Platform } from 'react-native';
import Contacts from 'react-native-contacts';

/**
 * Runtime permissions, asked for only when they're needed and always with the
 * reason first. Android's own dialog never says why an app wants something,
 * and once it's been refused twice it stops appearing at all, so on Android
 * every request goes through PermissionSheet: the reason, the system prompt,
 * and if Android won't ask any more, the steps to turn it on in settings.
 * iOS shows the reason from Info.plist inside its own dialog.
 */

export type PermissionKind = 'sms' | 'contacts';

export const ANDROID_PERMISSIONS: Record<PermissionKind, Permission> = {
  sms: PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  contacts: PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
};

// iOS 18 can grant access to only some contacts, which is enough to split with them.
const isContactsAllowed = (status: string) => status === 'authorized' || status === 'limited';

// PermissionSheetHost, mounted once in App, registers here so a request from
// any screen can open the sheet and wait for how it ends.
type Prompt = (kind: PermissionKind) => Promise<boolean>;
let prompt: Prompt | null = null;
export const registerPermissionPrompt = (fn: Prompt | null) => {
  prompt = fn;
};

const requestAndroid = async (kind: PermissionKind): Promise<boolean> => {
  const permission = ANDROID_PERMISSIONS[kind];
  if (await PermissionsAndroid.check(permission)) return true;
  if (prompt) return prompt(kind);
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
};

// Screens showing the SMS banner hear about a grant made from any of them.
const smsListeners = new Set<(granted: boolean) => void>();

const refreshSmsAccess = async () => {
  if (Platform.OS !== 'android') return;
  const granted = await PermissionsAndroid.check(ANDROID_PERMISSIONS.sms);
  smsListeners.forEach(listener => listener(granted));
};

/** Android only: new bank SMS reach the app only with RECEIVE_SMS. iOS uses Shortcuts instead. */
export const requestSmsAccess = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;
  try {
    return await requestAndroid('sms');
  } catch (error) {
    console.warn('SMS permission request failed:', error);
    return false;
  } finally {
    refreshSmsAccess().catch(() => {});
  }
};

/** Whether SMS can arrive automatically. Always true on iOS. */
export const useSmsAccess = () => {
  const [granted, setGranted] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    smsListeners.add(setGranted);
    refreshSmsAccess().catch(() => {});
    // Coming back from system settings is the usual way it changes.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshSmsAccess().catch(() => {});
    });
    return () => {
      smsListeners.delete(setGranted);
      sub.remove();
    };
  }, []);

  return granted;
};

/**
 * Asks for contacts at the moment they're needed. On Android this can't use
 * react-native-contacts' own request: it never hears the answer, because
 * MainActivity doesn't forward permission results to it.
 */
export const requestContactsAccess = async (): Promise<boolean> => {
  try {
    if (Platform.OS === 'android') return await requestAndroid('contacts');

    // iOS shows its dialog only once; after "Don't Allow", Settings is the
    // only way back, so say how to get there.
    if ((await Contacts.checkPermission()) === 'denied') {
      Alert.alert(
        'Contacts access is off',
        'Contacts let you pick who you’re splitting a spend with, and match money a friend sends you to the right person.\n\n' +
          'To turn it on: tap Open Settings, tap Contacts, then choose Full Access.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }
    return isContactsAllowed(await Contacts.requestPermission());
  } catch (error) {
    console.warn('Contacts permission request failed:', error);
    return false;
  }
};

/** Checks without asking, for background work like sync that shouldn't prompt. */
export const hasContactsAccess = async (): Promise<boolean> => {
  try {
    if (Platform.OS === 'android') return await PermissionsAndroid.check(ANDROID_PERMISSIONS.contacts);
    return isContactsAllowed(await Contacts.checkPermission());
  } catch {
    return false;
  }
};
