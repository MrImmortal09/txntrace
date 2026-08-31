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

import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

function MainApp() {
  const { isDark, colors } = useTheme();
  const [dbInitialized, setDbInitialized] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  useEffect(() => {
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

    const initDb = async () => {
      try {
        await requestPermissions();
        await setupDatabase();
        setDbInitialized(true);
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
