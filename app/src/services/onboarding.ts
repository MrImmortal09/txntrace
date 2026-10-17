import { db } from '../db/schema';
import { getSetting, setSetting } from './appSettings';

const TUTORIAL_KEY = 'tutorial_seen_version';
// Bump to show a reworked tutorial once more to people who saw an older one.
const TUTORIAL_VERSION = '1';

export const markTutorialSeen = (): Promise<void> => setSetting(TUTORIAL_KEY, TUTORIAL_VERSION);

const hasExistingData = async (): Promise<boolean> => {
  const res = await db.execute(
    'SELECT 1 FROM transactions UNION ALL SELECT 1 FROM sms_log LIMIT 1'
  );
  const rows: any = res.rows;
  return (rows?._array || rows || []).length > 0;
};

/**
 * Whether to open the tutorial on launch. No flag at all on a phone that
 * already has transactions or logged SMS means an upgrade from a build that
 * predates the tutorial, so that person already knows the app: record it as
 * seen instead. A flag from an older tutorial version still shows the new one.
 */
export const shouldShowTutorial = async (): Promise<boolean> => {
  const seen = await getSetting(TUTORIAL_KEY);
  if (seen === TUTORIAL_VERSION) return false;
  if (seen === null && (await hasExistingData())) {
    await markTutorialSeen();
    return false;
  }
  return true;
};
