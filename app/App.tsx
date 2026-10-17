/**
 * TxnTrace - Personal Finance Tracker
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View, Text, AppState, TouchableOpacity, Platform, PermissionsAndroid } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { TabNavigator } from './src/screens/TabNavigator';
import { setupDatabase } from './src/db/schema';
import { checkNewMessages } from './src/services/smsIngest';
import { checkForAppUpdate } from './src/services/playStoreUpdate';
import { rematchAfterMatcherUpdate } from './src/services/creditCards';
import { hasSeenTutorial, markTutorialSeen } from './src/services/onboarding';
import OnboardingTutorial from './src/components/onboarding/OnboardingTutorial';

import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

const requestPermissions = async () => {
  if (Platform.OS === 'android') {
    try {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      ]);
    } catch (err) {
      console.warn(err);
    }
  }
};

function MainApp() {
  const { isDark, colors } = useTheme();
  const [dbInitialized, setDbInitialized] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);

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
        // permission prompts wait until it's done. If the flag can't be read,
        // don't hold the app up with a tutorial.
        const seenTutorial = await hasSeenTutorial().catch(() => true);
        if (seenTutorial) {
          await requestPermissions();
        } else {
          setShowTutorial(true);
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

  const finishTutorial = () => {
    setShowTutorial(false);
    markTutorialSeen().catch(e => console.error('Failed to save tutorial progress:', e));
    requestPermissions();
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
      <NavigationContainer>
        <TabNavigator />
      </NavigationContainer>
      <OnboardingTutorial visible={showTutorial} onDone={finishTutorial} />
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
