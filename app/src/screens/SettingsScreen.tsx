import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform, ScrollView } from 'react-native';
import SharedSMSStore from 'shared-sms-store';
import { db } from '../db/schema';

const SettingsScreen = () => {
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const openMessagesSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('App-Prefs:root=MESSAGES').catch(() => {
        Linking.openSettings();
      });
    }
  };

  const log = (msg: string) => {
    console.log('[TxnTrace Debug]', msg);
    setDebugLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const runDiagnostics = async () => {
    setDebugLog([]);
    log('--- Starting diagnostics ---');

    // Step 1: Test native module exists
    try {
      log(`SharedSMSStore module: ${SharedSMSStore ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
    } catch (e: any) {
      log(`SharedSMSStore ERROR: ${e.message}`);
    }

    // Step 2: Write/read test to confirm App Group works from main app
    try {
      const result = await (SharedSMSStore as any).writeTestValue();
      log(`App Group write/read: ${result} ✅`);
    } catch (e: any) {
      log(`App Group FAILED ❌: ${e.message}`);
    }

    // Step 3: Check if extension has ever run
    try {
      const lastRun = await (SharedSMSStore as any).getExtensionLastRun();
      log(`Extension last ran: ${lastRun}`);
    } catch (e: any) {
      log(`getExtensionLastRun FAILED: ${e.message}`);
    }

    // Step 4: Peek at messages WITHOUT clearing them
    try {
      const messages = await (SharedSMSStore as any).peekMessages();
      log(`Messages in store (peek): ${JSON.stringify(messages)}`);
      log(`Message count: ${Array.isArray(messages) ? messages.length : 'NOT AN ARRAY'}`);
    } catch (e: any) {
      log(`peekMessages FAILED: ${e.message}`);
    }

    // Step 5: Check DB
    try {
      const res = await db.executeAsync('SELECT COUNT(*) as count FROM transactions');
      const rows: any = res.rows;
      const arr = rows?._array || rows || [];
      log(`Transactions in DB: ${arr[0]?.count ?? 'unknown'}`);
    } catch (e: any) {
      log(`DB check FAILED: ${e.message}`);
    }

    log('--- Diagnostics done ---');
  };

  const clearDb = async () => {
    try {
      await db.executeAsync('DELETE FROM transactions');
      log('DB cleared ✅');
    } catch (e: any) {
      log(`Clear DB FAILED: ${e.message}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>SMS Tracking</Text>
      <View style={styles.card}>
        <Text style={styles.description}>
          To automatically track transactions from your bank via SMS, you need to enable the TxnTrace filter extension in your device settings.
        </Text>

        <Text style={styles.instructions}>
          1. Open the Settings app{'\n'}
          2. Go to Messages{'\n'}
          3. Tap on Unknown & Spam{'\n'}
          4. Enable TxnTraceSMSFilter under SMS Filtering
        </Text>

        <TouchableOpacity style={styles.button} onPress={openMessagesSettings}>
          <Text style={styles.buttonText}>Open Messages Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { marginTop: 16 }]}>
        <Text style={styles.sectionTitle}>🔧 Diagnostics</Text>
        <Text style={styles.hint}>Tap after receiving a bank SMS to debug the pipeline</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: '#FF9500', marginBottom: 10 }]} onPress={runDiagnostics}>
          <Text style={styles.buttonText}>Run Diagnostics</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, { backgroundColor: '#FF3B30' }]} onPress={clearDb}>
          <Text style={styles.buttonText}>Clear DB (for testing)</Text>
        </TouchableOpacity>

        {debugLog.length > 0 && (
          <View style={styles.logBox}>
            {debugLog.map((line, i) => (
              <Text key={i} style={styles.logLine}>{line}</Text>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
    color: '#333',
  },
  hint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 14,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { height: 2, width: 0 },
    elevation: 2,
  },
  description: {
    fontSize: 16,
    color: '#444',
    lineHeight: 22,
    marginBottom: 16,
  },
  instructions: {
    fontSize: 14,
    color: '#666',
    lineHeight: 24,
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 6,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  logBox: {
    marginTop: 14,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    padding: 10,
  },
  logLine: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: '#4cd964',
    lineHeight: 18,
  },
});

export default SettingsScreen;
