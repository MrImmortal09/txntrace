import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Linking, Platform, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Contacts from 'react-native-contacts';
import { db } from '../db/schema';
import {
  syncFromServer,
  syncCardsFromServer,
  syncContactsToServer,
  syncSplitsFromServer,
  syncSplitsToServer,
  syncSettlementsToServer,
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
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    // No need to load serverUrl anymore
  }, []);



  const log = (msg: string) => {
    console.log('[TxnTrace Debug]', msg);
    setDebugLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const runDiagnostics = async () => {
    setDebugLog([]);
    log('--- Starting diagnostics ---');

    // Step 1: Check DB
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
      log(
        `Synced from web ✅ — ${imported} new transaction(s), ${count} card(s)/account(s)${contactsMsg}, ` +
          `${splitsImported} new split(s), ${splitsPushed} split(s) + ${settlementsPushed} settlement(s) pushed.`
      );
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



      <View style={[styles.card, styles.cardSpacing, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Sync with Web</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Pulls in statements and splits from the web app, and pushes your contacts and friend activity up so the web's Friends page matches this one</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={handleSync} disabled={syncing}>
          <Text style={styles.buttonText}>{syncing ? 'Syncing…' : 'Sync now'}</Text>
        </TouchableOpacity>
      </View>

      <OTPLoginModal 
        visible={showLoginModal} 
        onClose={() => setShowLoginModal(false)}
        onSuccess={() => {
          setShowLoginModal(false);
          handleSync();
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
