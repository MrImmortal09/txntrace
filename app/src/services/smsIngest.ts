import { Platform } from 'react-native';
import SharedSMSStore from 'shared-sms-store';
import { processSMSBatch, ingestManualSMS, previewParsedSMS } from '../parsers/sms';
import { convertPendingForeignAmounts } from './exchangeRates';

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
      // Foreign spends that arrived while no exchange rate was known sit at ₹0
      // until a rate turns up. Separate catch: a rate failure isn't a message failure.
      await convertPendingForeignAmounts().catch(e => console.warn('Could not price foreign spends:', e));
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
