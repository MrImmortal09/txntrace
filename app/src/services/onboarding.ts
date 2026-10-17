import { getSetting, setSetting } from './appSettings';

const TUTORIAL_KEY = 'tutorial_seen_version';
// Bump to show a reworked tutorial once more to people who saw an older one.
const TUTORIAL_VERSION = '1';

export const hasSeenTutorial = async (): Promise<boolean> =>
  (await getSetting(TUTORIAL_KEY)) === TUTORIAL_VERSION;

export const markTutorialSeen = (): Promise<void> => setSetting(TUTORIAL_KEY, TUTORIAL_VERSION);
