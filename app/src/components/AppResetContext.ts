import { createContext, useContext } from 'react';

/**
 * Deletes all local data and starts the app over as if just installed. App
 * provides it, since starting over means reloading every screen and showing
 * the first-run tour.
 */
export const AppResetContext = createContext<() => Promise<void>>(async () => {});

export const useResetApp = () => useContext(AppResetContext);
