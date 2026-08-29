import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Linking, Platform, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Contacts from 'react-native-contacts';
import SharedSMSStore from 'shared-sms-store';
import { db } from '../db/schema';
import {
  getServerUrl,
  setServerUrl,
  syncFromServer,
  syncCardsFromServer,
  syncContactsToServer,
  syncSplitsFromServer,
} from '../services/webSync';
import { useTheme } from '../theme/ThemeProvider';

const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
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

    // Step 4: Peek at messages WITHOUT clearing them — printed one per line
    // (not one JSON blob) since this is the actual "did my message really
    // arrive via the automation" check, and a raw stringify is unreadable
    // once there's more than one pending message.
    try {
      const messages = await (SharedSMSStore as any).peekMessages();
      if (!Array.isArray(messages)) {
        log(`Messages in store: NOT AN ARRAY (${JSON.stringify(messages)})`);
      } else if (messages.length === 0) {
        log('Messages in store: none pending — nothing waiting to be drained.');
      } else {
        log(`Messages in store: ${messages.length} pending`);
        messages.forEach((m: any, i: number) => {
          log(`  [${i}] source=${m.source ?? 'unknown'} sender=${m.sender || '(none)'} at=${m.receivedAt || '?'}`);
          log(`      "${(m.body || '').slice(0, 140)}${(m.body || '').length > 140 ? '…' : ''}"`);
        });
      }
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

      // Contacts only push one way (phone -> server), and only if contacts
      // permission is actually granted — the web side just won't have a
      // contact list to split against until it is, everything else still syncs.
      let contactsMsg = '';
      try {
        const permission = await Contacts.requestPermission();
        if (permission === 'authorized') {
          const all = await Contacts.getAll();
          const payload = all.map(c => ({
            id: c.recordID,
            name: c.displayName || `${c.givenName} ${c.familyName}`.trim(),
          }));
          const { count: contactCount } = await syncContactsToServer(payload);
          contactsMsg = `, ${contactCount} contact(s) pushed`;
        }
      } catch (e: any) {
        log(`Contact push skipped: ${e.message}`);
      }

      const { imported: splitsImported } = await syncSplitsFromServer();
      log(`Synced from web ✅ — ${imported} new transaction(s), ${count} card(s)/account(s)${contactsMsg}, ${splitsImported} new split(s).`);
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
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.contentContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

      <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>1. Shortcuts automation</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>The main way TxnTrace sees your bank SMS</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          iOS has no API for reading messages, so you hand them to TxnTrace with a
          one-time automation. It runs in the background — nothing opens, nothing
          is sent anywhere.
        </Text>

        <View style={[styles.instructions, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.instructionsText, { color: colors.textSecondary }]}>
            1. Open Shortcuts → Automation tab{'\n'}
            2. Tap + → Message{'\n'}
            3. Leave Sender and Message empty to catch every bank{'\n'}
            4. Turn on Run Immediately, turn off Notify When Run{'\n'}
            5. New Blank Automation → add action “Save Transaction SMS”{'\n'}
            6. Set its Message field to the Shortcut Input variable
          </Text>
        </View>

        <View style={[styles.callout, { backgroundColor: colors.background, borderLeftColor: colors.danger }]}>
          <Text style={[styles.calloutText, { color: colors.textSecondary }]}>
            Only messages received after setup are captured — there is no way to
            import your SMS history.
          </Text>
        </View>

        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={openShortcuts}>
          <Text style={styles.buttonText}>Open Shortcuts</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, styles.cardSpacing, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>2. Message filter (backup)</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Optional — kept for the upcoming server-side path</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          The filter extension sits in the message delivery path, so it misses less
          than an automation. It cannot store anything on-device yet, so leave this
          off unless you are helping test.
        </Text>

        <View style={[styles.instructions, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.instructionsText, { color: colors.textSecondary }]}>
            1. Open the Settings app{'\n'}
            2. Go to Messages{'\n'}
            3. Tap on Unknown & Spam{'\n'}
            4. Enable TxnTraceSMSFilter under SMS Filtering
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, { borderColor: colors.border }]}
          onPress={openMessagesSettings}
        >
          <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>Open Messages Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, styles.cardSpacing, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>3. Sync from web</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Pulls in statements and splits from the web app, and pushes your contacts up so you can split with them there too</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
          placeholder="http://192.168.1.10:8000"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          value={serverUrl}
          onChangeText={setServerUrlInput}
        />
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={handleSync} disabled={syncing}>
          <Text style={styles.buttonText}>{syncing ? 'Syncing…' : 'Sync from Web'}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, styles.cardSpacing, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Diagnostics</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Tap after receiving a bank SMS to debug the pipeline</Text>

        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, styles.buttonSpacing, { borderColor: colors.border }]}
          onPress={runDiagnostics}
        >
          <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>Run Diagnostics</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, styles.buttonSpacing, { borderColor: colors.border }]}
          onPress={() => navigation.navigate('Logs')}
        >
          <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>View SMS Logs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.danger }]} onPress={clearDb}>
          <Text style={styles.buttonText}>Clear DB (for testing)</Text>
        </TouchableOpacity>

        {debugLog.length > 0 && (
          <View style={[styles.logBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {debugLog.map((line, i) => (
              <Text key={i} style={[styles.logLine, { color: colors.textSecondary }]}>{line}</Text>
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
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    marginBottom: 14,
  },
  callout: {
    borderLeftWidth: 3,
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  calloutText: {
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    borderRadius: 14,
    padding: 18,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { height: 4, width: 0 },
    elevation: 2,
  },
  cardSpacing: {
    marginTop: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  instructions: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  instructionsText: {
    fontSize: 14,
    lineHeight: 23,
  },
  button: {
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonSpacing: {
    marginBottom: 10,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  buttonSecondaryText: {
    fontWeight: '600',
    fontSize: 15,
  },
  logBox: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  logLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    lineHeight: 17,
  },
});

export default SettingsScreen;
