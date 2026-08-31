import { setupDatabase } from '../db/schema';
import { processSMSBatch } from '../parsers/sms';

export default async (taskData: { sender: string; body: string; receivedAt: string }) => {
  try {
    // 1. Initialize the SQLite DB if it isn't already initialized
    // op-sqlite is synchronous and JSI-based, so it runs very fast.
    await setupDatabase();

    console.log(`[Headless JS] Received SMS from ${taskData.sender}`);

    // 2. Process the single message using the batch parser
    await processSMSBatch([
      {
        id: `android_${Date.now()}`,
        sender: taskData.sender,
        body: taskData.body,
        receivedAt: taskData.receivedAt,
        source: 'filter' // using 'filter' or 'android' as source
      }
    ]);

    console.log(`[Headless JS] Successfully processed SMS from ${taskData.sender}`);
  } catch (err) {
    console.error('[Headless JS] Error processing SMS', err);
  }
};
