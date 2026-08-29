import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Linking, Platform, ScrollView } from 'react-native';
import SharedSMSStore from 'shared-sms-store';
import { db } from '../db/schema';
import { getServerUrl, setServerUrl, syncFromServer, syncCardsFromServer } from '../services/webSync';

const SettingsScreen = () => {
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [serverUrl, setServerUrlInput] = useState('');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    getServerUrl().then(url => { if (url) setServerUrlInput(url); });
  }, []);

  const openShortcuts = () => {
    Linking.openURL('shortcuts://').catch(() => {
      Linking.openURL('https://apps.apple.com/app/shortcuts/id915249334').catch(() => {});
    });
  };

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

    // Step 3: Per-path ingestion health
    try {
      const stats = await (SharedSMSStore as any).getIngestStats();
      log(`Shortcut last ran: ${stats.shortcutLastRun}`);
      log(`Pending from Shortcut: ${stats.pendingFromShortcut}`);
      log(`Extension last ran: ${stats.extensionLastRun}`);
      log(`Pending from Extension: ${stats.pendingFromExtension}`);
      log(`Inbox file exists: ${stats.inboxExists ? 'yes ✅' : 'no'}`);
      if (stats.shortcutLastRun === 'never') {
        log('→ Automation has never fired. Check the Shortcuts setup above.');
      }
    } catch (e: any) {
      log(`getIngestStats FAILED: ${e.message}`);
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
      const res = await db.execute('SELECT COUNT(*) as count FROM transactions');
      const rows: any = res.rows;
      const arr = rows?._array || rows || [];
      log(`Transactions in DB: ${arr[0]?.count ?? 'unknown'}`);
    } catch (e: any) {
      log(`DB check FAILED: ${e.message}`);
    }

    log('--- Diagnostics done ---');
  };

  const handleSync = async () => {
    if (!serverUrl.trim()) {
      log('Enter your server URL first (e.g. http://192.168.1.10:8000).');
      return;
    }
    setSyncing(true);
    try {
      await setServerUrl(serverUrl.trim());
      const { imported } = await syncFromServer();
      const { count } = await syncCardsFromServer();
      log(`Synced from web ✅ — ${imported} new transaction(s), ${count} card(s)/account(s).`);
    } catch (e: any) {
      log(`Sync FAILED ❌: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const clearDb = async () => {
    try {
      await db.execute('DELETE FROM transactions');
      log('DB cleared ✅');
    } catch (e: any) {
      log(`Clear DB FAILED: ${e.message}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>SMS Tracking</Text>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Shortcuts automation</Text>
        <Text style={styles.hint}>The main way TxnTrace sees your bank SMS</Text>
        <Text style={styles.description}>
          iOS has no API for reading messages, so you hand them to TxnTrace with a
          one-time automation. It runs in the background — nothing opens, nothing
          is sent anywhere.
        </Text>

        <Text style={styles.instructions}>
          1. Open Shortcuts → Automation tab{'\n'}
          2. Tap + → Message{'\n'}
          3. Leave Sender and Message empty to catch every bank{'\n'}
          4. Turn on Run Immediately, turn off Notify When Run{'\n'}
          5. New Blank Automation → add action “Save Transaction SMS”{'\n'}
          6. Set its Message field to the Shortcut Input variable
        </Text>

        <Text style={styles.warn}>
          Only messages received after setup are captured — there is no way to
          import your SMS history.
        </Text>

        <TouchableOpacity style={styles.button} onPress={openShortcuts}>
          <Text style={styles.buttonText}>Open Shortcuts</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { marginTop: 16 }]}>
        <Text style={styles.sectionTitle}>2. Message filter (backup)</Text>
        <Text style={styles.hint}>Optional — kept for the upcoming server-side path</Text>
        <Text style={styles.description}>
          The filter extension sits in the message delivery path, so it misses less
          than an automation. It cannot store anything on-device yet, so leave this
          off unless you are helping test.
        </Text>

        <Text style={styles.instructions}>
          1. Open the Settings app{'\n'}
          2. Go to Messages{'\n'}
          3. Tap on Unknown & Spam{'\n'}
          4. Enable TxnTraceSMSFilter under SMS Filtering
        </Text>

        <TouchableOpacity style={[styles.button, { backgroundColor: '#8e8e93' }]} onPress={openMessagesSettings}>
          <Text style={styles.buttonText}>Open Messages Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { marginTop: 16 }]}>
        <Text style={styles.sectionTitle}>3. Sync from web</Text>
        <Text style={styles.hint}>Pulls in statements you've imported and sorted on the web app</Text>
        <TextInput
          style={styles.input}
          placeholder="http://192.168.1.10:8000"
          autoCapitalize="none"
          autoCorrect={false}
          value={serverUrl}
          onChangeText={setServerUrlInput}
        />
        <TouchableOpacity style={styles.button} onPress={handleSync} disabled={syncing}>
          <Text style={styles.buttonText}>{syncing ? 'Syncing…' : 'Sync from Web'}</Text>
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
  warn: {
    fontSize: 13,
    color: '#8a6d3b',
    backgroundColor: '#fcf8e3',
    padding: 10,
    borderRadius: 6,
    lineHeight: 19,
    marginBottom: 16,
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
  input: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
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
