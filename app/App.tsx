/**
 * TxnTrace - Personal Finance Tracker
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View, Text, AppState, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { TabNavigator } from './src/screens/TabNavigator';
import { setupDatabase } from './src/db/schema';
import { checkNewMessages } from './src/services/smsIngest';
import { checkForAppUpdate } from './src/services/playStoreUpdate';
import { rematchAfterMatcherUpdate } from './src/services/creditCards';
import { markTutorialSeen, shouldShowTutorial } from './src/services/onboarding';
import { requestContactsAccess, requestSmsAccess } from './src/services/permissions';
import OnboardingTutorial from './src/components/onboarding/OnboardingTutorial';
import { TutorialContext } from './src/components/onboarding/TutorialContext';
import { PermissionSheetHost } from './src/components/PermissionSheet';
import { AppResetContext } from './src/components/AppResetContext';
import { resetAppData } from './src/services/dataReset';

import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

function MainApp() {
  const { isDark, colors, setThemePreference } = useTheme();
  const [dbInitialized, setDbInitialized] = useState(false);
  // Bumped by Reset App so every screen remounts and reloads from scratch.
  const [generation, setGeneration] = useState(0);
  const [smsError, setSmsError] = useState<string | null>(null);
  // A replay from Settings just closes; only the first-run tour also records
  // that it was seen and asks for permissions.
  const [tutorial, setTutorial] = useState<'hidden' | 'firstRun' | 'replay'>('hidden');

  useEffect(() => {
    // Check for Google Play updates on launch and foreground resume
    checkForAppUpdate();
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkForAppUpdate();
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const initDb = async () => {
      try {
        await setupDatabase();
        // First launch: the tutorial explains why SMS access is needed, so the
        // one permission prompt waits until it's done. Later launches never
        // prompt; Home and Daily show a banner while SMS access is off, and
        // contacts are asked for when a split first needs them. If the flag
        // can't be read, don't hold the app up with a tutorial.
        if (await shouldShowTutorial().catch(() => false)) {
          setTutorial('firstRun');
        }
        setDbInitialized(true);
        // In the background: a big SMS backlog shouldn't hold up launch, and a
        // failure isn't fatal — spends just stay unlinked until a card is re-saved.
        rematchAfterMatcherUpdate().catch(e => console.error('Failed to rematch card transactions:', e));
      } catch (error) {
        console.error('Failed to initialize database:', error);
      }
    };
    initDb();
  }, []);

  useEffect(() => {
    if (!dbInitialized) return;
    const runCheck = () => checkNewMessages().then(({ error }) => setSmsError(error));
    runCheck();
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        runCheck();
      }
    });
    return () => { subscription.remove(); };
  }, [dbInitialized]);

  const replayTutorial = useCallback(() => setTutorial('replay'), []);

  // After the wipe, start over as a new install would: default theme, every
  // screen reloaded from the now-empty database, and the first-run tour,
  // which saves that it was seen and asks for permissions again.
  const resetApp = useCallback(async () => {
    await resetAppData();
    setThemePreference('system');
    setSmsError(null);
    setGeneration(g => g + 1);
    setTutorial('firstRun');
  }, [setThemePreference]);

  const finishTutorial = () => {
    setTutorial('hidden');
    if (tutorial !== 'firstRun') return;
    markTutorialSeen().catch(e => console.error('Failed to save tutorial progress:', e));
    // One after the other, each with its reason. Contacts now rather than at
    // the first split, so a payer whose name matches a contact is matched
    // without picking them (the Friends slide says this is coming).
    requestSmsAccess()
      .then(() => requestContactsAccess())
      .catch(e => console.warn('Permission requests after the tutorial failed:', e));
  };

  if (!dbInitialized) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Initializing Database...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        {...(Platform.OS === 'android' ? { backgroundColor: colors.background } : null)}
      />
      {smsError && (
        <View style={[styles.banner, { backgroundColor: colors.danger }]}>
          <Text style={styles.bannerText}>{smsError}</Text>
          <TouchableOpacity onPress={() => setSmsError(null)}>
            <Text style={styles.bannerDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      <AppResetContext.Provider value={resetApp}>
        <TutorialContext.Provider value={replayTutorial}>
          <NavigationContainer key={generation}>
            <TabNavigator />
          </NavigationContainer>
        </TutorialContext.Provider>
      </AppResetContext.Provider>
      <OnboardingTutorial visible={tutorial !== 'hidden'} firstRun={tutorial === 'firstRun'} onDone={finishTutorial} />
      <PermissionSheetHost />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  banner: {
    padding: 12,
    paddingTop: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerText: { color: 'white', fontSize: 14, fontWeight: 'bold', flex: 1 },
  bannerDismiss: { color: 'white', fontSize: 18, fontWeight: 'bold', marginLeft: 10, padding: 4 },
});

export default function App() {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
}
