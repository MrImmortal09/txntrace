import { db, DEFAULT_CATEGORIES_SQL } from '../db/schema';

// Every table, with rows that point at another table cleared before it.
const TABLES = [
  'splits',
  'settlements',
  'contact_aliases',
  'reward_entries',
  'card_statements',
  'sms_log',
  'transactions',
  'cards',
  'categories',
  'app_settings',
];

/**
 * Reset App: deletes everything stored on this phone. That's every
 * transaction, friend split, settlement and learned payer name, every card
 * with its statements and rewards, the SMS log, custom categories and all
 * settings (so web sync is signed out and the tour shows again). The default
 * categories go back in afterwards. All in one transaction, so a failure
 * leaves everything as it was. Backups already on the server aren't touched.
 */
export const resetAppData = () =>
  db.transaction(async tx => {
    for (const table of TABLES) {
      await tx.execute(`DELETE FROM ${table}`);
    }
    await tx.execute(DEFAULT_CATEGORIES_SQL);
  });
