import { Platform } from 'react-native';
import SharedSMSStore from 'shared-sms-store';
import { processSMSBatch, ingestManualSMS, previewParsedSMS } from '../parsers/sms';

export { ingestManualSMS, previewParsedSMS };

let activeCheck: Promise<{ error: string | null; count: number }> | null = null;

/**
 * Drains the shared App Group inbox (written by the Shortcuts automation /
 * filter extension) on iOS and processes whatever's there.
 *
 * Prevents concurrent overlapping checks via in-flight Promise deduplication,
 * ensuring callers (like screen focus effects) always wait until batch insertion
 * finishes before querying the local database.
 */
export const checkNewMessages = async (): Promise<{ error: string | null; count: number }> => {
  if (activeCheck) {
    return activeCheck;
  }

  activeCheck = (async () => {
    try {
      let count = 0;
      if (Platform.OS === 'ios') {
        const messages = await SharedSMSStore.readNewMessages();
        if (Array.isArray(messages) && messages.length > 0) {
          await processSMSBatch(messages);
          count = messages.length;
        }
      }
      return { error: null, count };
    } catch (error: any) {
      console.error('Error reading SMS store:', error);
      return { error: 'Could not read incoming messages. Check SMS setup in Settings.', count: 0 };
    } finally {
      activeCheck = null;
    }
  })();

  return activeCheck;
};
