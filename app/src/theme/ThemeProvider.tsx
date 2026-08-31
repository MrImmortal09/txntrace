import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { lightTheme, darkTheme, ThemeColors } from './colors';
import { db } from '../db/schema';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextType {
  isDark: boolean;
  colors: ThemeColors;
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  colors: lightTheme,
  themePreference: 'system',
  setThemePreference: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [dbLoaded, setDbLoaded] = useState(false);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const res = await db.execute('SELECT value FROM app_settings WHERE key = ?', ['theme_preference']);
        const rows: any = res.rows;
        const arr = rows?._array || rows || [];
        if (arr.length > 0) {
          const val = arr[0].value;
          if (val === 'light' || val === 'dark' || val === 'system') {
            setThemePreferenceState(val);
          }
        }
      } catch (e) {
        // Table might not exist on very first render before schema setup, ignore
      } finally {
        setDbLoaded(true);
      }
    };
    loadTheme();
  }, []);

  const setThemePreference = async (pref: ThemePreference) => {
    setThemePreferenceState(pref);
    try {
      await db.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', ['theme_preference', pref]);
    } catch (e) {
      console.error('Failed to save theme preference', e);
    }
  };

  // Determine actual active theme based on preference and system
  const isDark = themePreference === 'system' 
    ? systemColorScheme === 'dark' 
    : themePreference === 'dark';

  const theme = {
    isDark,
    colors: isDark ? darkTheme : lightTheme,
    themePreference,
    setThemePreference,
  };

  // Optionally wait for DB to load before rendering so we don't flash default light theme on startup
  if (!dbLoaded) {
    return null; 
  }

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
