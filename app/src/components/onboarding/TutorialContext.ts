import { createContext, useContext } from 'react';

/**
 * Opens the app tutorial again. App owns the only OnboardingTutorial, so a
 * replay from Settings and the first-run tour share one instance.
 */
export const TutorialContext = createContext<() => void>(() => {});

export const useShowTutorial = () => useContext(TutorialContext);
