/**
 * TxnTrace - Personal Finance Tracker
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View, Text, AppState, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { TabNavigator } from './src/screens/TabNavigator';
import { setupDatabase } from './src/db/schema';
import SharedSMSStore from 'shared-sms-store';
import { processSMSBatch } from './src/parsers/sms';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [dbInitialized, setDbInitialized] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  useEffect(() => {
    const initDb = async () => {
      try {
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
    checkNewMessages();
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkNewMessages();
      }
    });
    return () => { subscription.remove(); };
  }, [dbInitialized]);

  const checkNewMessages = async () => {
    try {
      const messages = await SharedSMSStore.readNewMessages();
      setSmsError(null);
      if (messages && messages.length > 0) {
        await processSMSBatch(messages);
      }
    } catch (error: any) {
      console.error('Error reading SMS store:', error);
      setSmsError('Message Filter not configured. Please enable TxnTraceSMSFilter in Settings.');
    }
  };

  if (!dbInitialized) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Initializing Database...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {smsError && (
        <View style={styles.banner}>
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
    backgroundColor: '#ff3b30',
    padding: 12,
    paddingTop: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerText: { color: 'white', fontSize: 14, fontWeight: 'bold', flex: 1 },
  bannerDismiss: { color: 'white', fontSize: 18, fontWeight: 'bold', marginLeft: 10, padding: 4 },
});

export default App;
