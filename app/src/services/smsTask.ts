import { setupDatabase } from '../db/schema';
import { processSMSBatch } from '../parsers/sms';

export default async (taskData: { sender?: string; body?: string; receivedAt?: string }) => {
  try {
    if (!taskData || !taskData.body) {
      console.log('[Headless JS] Missing message body, skipping');
      return;
    }

    // 1. Initialize the SQLite DB if it isn't already initialized
    // op-sqlite is synchronous and JSI-based, so it runs very fast.
    await setupDatabase();

    console.log(`[Headless JS] Received SMS from ${taskData.sender || 'unknown'}`);

    // 2. Process the single message using the batch parser
    await processSMSBatch([
      {
        id: `android_${Date.now()}`,
        sender: taskData.sender || '',
        body: taskData.body,
        receivedAt: taskData.receivedAt || new Date().toISOString(),
        source: 'filter' // using 'filter' or 'android' as source
      }
    ]);

    console.log(`[Headless JS] Successfully processed SMS from ${taskData.sender || 'unknown'}`);
  } catch (err) {
    console.error('[Headless JS] Error processing SMS', err);
  }
};

