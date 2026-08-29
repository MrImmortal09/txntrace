import SharedSMSStore from 'shared-sms-store';
import { processSMSBatch } from '../parsers/sms';

/**
 * Drains the shared App Group inbox (written by the Shortcuts automation /
 * filter extension) and processes whatever's there.
 *
 * There's no way for iOS to wake this app in the background when the
 * automation fires — App.tsx only calls this on launch and on an actual
 * background→active transition, which never happens if the user was already
 * inside the app when the SMS arrived. Screens that show SMS-derived data
 * (Daily, Logs) call this on focus too, so switching to that tab is enough
 * to pull in anything new, without needing a real app-state transition.
 */
export const checkNewMessages = async (): Promise<{ error: string | null }> => {
  try {
    const messages = await SharedSMSStore.readNewMessages();
    if (messages && messages.length > 0) {
      await processSMSBatch(messages);
    }
    return { error: null };
  } catch (error: any) {
    console.error('Error reading SMS store:', error);
    return { error: 'Could not read incoming messages. Check SMS setup in Settings.' };
  }
};
