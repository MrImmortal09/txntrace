import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Contacts from 'react-native-contacts';
import SharedSMSStore from 'shared-sms-store';
import { db } from '../db/schema';
import {
  syncFromServer,
  syncCardsFromServer,
  syncContactsToServer,
  syncSplitsFromServer,
  syncSplitsToServer,
  syncSettlementsToServer,
  syncSettlementsFromServer,
  checkServerBackupStatus,
  backupLocalToServer,
  restoreFromServer,
  getAuthToken,
} from '../services/webSync';
import { reparseStoredMessages } from '../services/reparseMessages';
import { useTheme } from '../theme/ThemeProvider';
import { OTPLoginModal } from '../components/OTPLoginModal';

const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const { colors, themePreference, setThemePreference } = useTheme();
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [reparsing, setReparsing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<'sync' | 'backup' | null>(null);

  useEffect(() => {
    // No need to load serverUrl anymore
  }, []);



  const openShortcuts = () => {
    Linking.openURL('shortcuts://').catch(() => {
      log('Could not open Shortcuts app — open it manually from your home screen.');
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

    if (Platform.OS === 'ios') {
      // Step 1: Write/read test to confirm App Group works from main app
      try {
        const result = await SharedSMSStore.writeTestValue();
        log(`App Group write/read: ${result} ✅`);
      } catch (e: any) {
        log(`App Group FAILED ❌: ${e.message}`);
      }

      // Step 2: Per-path ingestion health
      try {
        const stats = await SharedSMSStore.getIngestStats();
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

      // Step 3: Peek at messages WITHOUT clearing them
      try {
        const messages = await SharedSMSStore.peekMessages();
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
    }

    // Step 4: Check DB
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
    const token = await getAuthToken();
    if (!token) {
      setPendingAction('sync');
      setShowLoginModal(true);
      return;
    }
    
    setSyncing(true);
    try {
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

      // Pushed up before pulling down, so the web's Friends page reflects
      // splits/settlements from SMS-matching and the app's own manual-
      // expense flow, not just whatever was created directly on the web.
      const { count: splitsPushed } = await syncSplitsToServer();
      const { count: settlementsPushed } = await syncSettlementsToServer();
      const { imported: splitsImported } = await syncSplitsFromServer();
      const { imported: settlementsImported } = await syncSettlementsFromServer();
      log(
        `Synced from web ✅ — ${imported} new transaction(s), ${count} card(s)/account(s)${contactsMsg}, ` +
          `${splitsImported} new split(s), ${settlementsImported} new settlement(s), ` +
          `${splitsPushed} split(s) + ${settlementsPushed} settlement(s) pushed.`
      );
    } catch (e: any) {
      log(`Sync FAILED ❌: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const executePullServer = async () => {
    setRestoring(true);
    try {
      const res = await restoreFromServer();
      Alert.alert(
        'Server Data Restored',
        `Successfully pulled server data:\n• ${res.transactions} transaction(s)\n• ${res.splits} split(s)\n• ${res.settlements} settlement(s)\n• ${res.cards} card(s)`,
      );
      log(
        `Server data pulled ✅ — ${res.transactions} txn(s), ${res.splits} split(s), ` +
          `${res.settlements} settlement(s), ${res.cards} card(s)`
      );
    } catch (e: any) {
      Alert.alert('Pull Failed', e.message || 'Failed to pull server data.');
      log(`Pull server FAILED ❌: ${e.message}`);
    } finally {
      setRestoring(false);
    }
  };

  const executeBackupToServer = async (isOverwrite = true) => {
    setBackingUp(true);
    try {
      let contactsPayload: { id: string; name: string }[] = [];
      try {
        const permission = await Contacts.requestPermission();
        if (permission === 'authorized') {
          const all = await Contacts.getAll();
          contactsPayload = all.map(c => ({
            id: c.recordID,
            name: c.displayName || `${c.givenName} ${c.familyName}`.trim(),
          }));
        }
      } catch (e: any) {
        log(`Contacts skipped during backup: ${e.message}`);
      }

      const res = await backupLocalToServer({
        overwrite: isOverwrite,
        contacts: contactsPayload,
      });

      Alert.alert(
        'Backup Successful',
        `Local data backed up to server:\n• ${res.transactions} transaction(s)\n• ${res.splits} split(s)\n• ${res.settlements} settlement(s)\n• ${res.cards} card(s)`,
      );
      log(
        `Backup to server ✅ — ${res.transactions} transaction(s), ${res.splits} split(s), ` +
          `${res.settlements} settlement(s), ${res.cards} card(s)`
      );
    } catch (e: any) {
      Alert.alert('Backup Failed', e.message || 'Failed to backup to server.');
      log(`Backup FAILED ❌: ${e.message}`);
    } finally {
      setBackingUp(false);
    }
  };

  const handleBackup = async () => {
    const token = await getAuthToken();
    if (!token) {
      setPendingAction('backup');
      setShowLoginModal(true);
      return;
    }

    setBackingUp(true);
    try {
      const status = await checkServerBackupStatus();
      if (status.exists) {
        setBackingUp(false);
        Alert.alert(
          'Server Data Found',
          `Existing data was found on the server (${status.transactionCount} transaction(s), ${status.splitCount} split(s), ${status.settlementCount} settlement(s)).\n\nDo you want to keep the server data or overwrite it with your local data?`,
          [
            {
              text: 'Keep Server Data',
              onPress: () => executePullServer(),
            },
            {
              text: 'Overwrite with Local',
              style: 'destructive',
              onPress: () => executeBackupToServer(true),
            },
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => setBackingUp(false),
            },
          ],
          { cancelable: true, onDismiss: () => setBackingUp(false) }
        );
      } else {
        await executeBackupToServer(false);
      }
    } catch (e: any) {
      setBackingUp(false);
      Alert.alert('Backup Error', e.message || 'Could not verify server backup status.');
      log(`Backup check FAILED ❌: ${e.message}`);
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

  const runReparse = async () => {
    setReparsing(true);
    log('--- Re-parsing stored messages ---');
    try {
      const { updated, matched } = await reparseStoredMessages();
      log(`Done ✅ — ${updated} transaction(s) corrected, ${matched} newly matched to a friend.`);
    } catch (e: any) {
      log(`Re-parse FAILED ❌: ${e.message}`);
    } finally {
      setReparsing(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.contentContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

      <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Appearance</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Choose your preferred app theme</Text>
        <View style={styles.themeSelectorRow}>
          <TouchableOpacity
            style={[styles.themeOption, themePreference === 'system' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => setThemePreference('system')}
          >
            <Text style={[styles.themeOptionText, themePreference === 'system' ? { color: '#fff' } : { color: colors.text }]}>System</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.themeOption, themePreference === 'light' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => setThemePreference('light')}
          >
            <Text style={[styles.themeOptionText, themePreference === 'light' ? { color: '#fff' } : { color: colors.text }]}>Light</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.themeOption, themePreference === 'dark' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => setThemePreference('dark')}
          >
            <Text style={[styles.themeOptionText, themePreference === 'dark' ? { color: '#fff' } : { color: colors.text }]}>Dark</Text>
          </TouchableOpacity>
        </View>
      </View>

      {Platform.OS === 'ios' && (
        <>
          <View style={[styles.card, styles.cardSpacing, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>1. Shortcuts automation</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>The main way TxnTrace sees your bank SMS</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              iOS has no API for reading messages directly, so you hand them to TxnTrace with a
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
              than an automation.
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
        </>
      )}



      <View style={[styles.card, styles.cardSpacing, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Cloud Backup & Sync</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Backup all your local transactions and activity to the server, or pull existing server data. Also syncs statements and splits with the web app.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleBackup}
          disabled={backingUp || restoring || syncing}
        >
          <Text style={styles.buttonText}>
            {restoring ? 'Restoring…' : backingUp ? 'Backing up…' : 'Backup to Server'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, { borderColor: colors.border, marginTop: 10 }]}
          onPress={handleSync}
          disabled={backingUp || restoring || syncing}
        >
          <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>{syncing ? 'Syncing…' : 'Sync with Web'}</Text>
        </TouchableOpacity>
      </View>

      <OTPLoginModal 
        visible={showLoginModal} 
        onClose={() => {
          setShowLoginModal(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          setShowLoginModal(false);
          if (pendingAction === 'backup') {
            setPendingAction(null);
            handleBackup();
          } else {
            setPendingAction(null);
            handleSync();
          }
        }}
      />

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
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, styles.buttonSpacing, { borderColor: colors.border }]}
          onPress={runReparse}
          disabled={reparsing}
        >
          <Text style={[styles.buttonSecondaryText, { color: colors.text }]}>
            {reparsing ? 'Re-parsing…' : 'Re-parse Stored Messages'}
          </Text>
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
  themeSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  themeOption: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  themeOptionText: {
    fontSize: 14,
    fontWeight: '600',
  }
});

export default SettingsScreen;
