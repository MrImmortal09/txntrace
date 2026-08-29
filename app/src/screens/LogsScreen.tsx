import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../db/schema';

interface SmsLogEntry {
  id: string;
  sender: string;
  body: string;
  received_at: string;
  source: string;
  status: 'parsed' | 'unparsed';
  bank: string | null;
  amount: number | null;
  type: string | null;
  merchant: string | null;
  reference: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  shortcut: 'Shortcut',
  filter: 'Filter',
  unknown: 'Unknown',
};

const LogsScreen = () => {
  const [logs, setLogs] = useState<SmsLogEntry[]>([]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await db.execute('SELECT * FROM sms_log ORDER BY received_at DESC LIMIT 300');
      const rows: any = res.rows;
      setLogs(rows?._array || rows || []);
    } catch (error) {
      console.error('Failed to load SMS logs:', error);
    }
  }, []);

  // Messages arrive in the background (foreground AppState listener in App.tsx),
  // so logs need to refresh every time this tab is opened, not just on mount.
  useFocusEffect(
    useCallback(() => {
      loadLogs();
    }, [loadLogs])
  );

  const clearLogs = () => {
    Alert.alert('Clear Logs', 'Delete all SMS log entries? This does not affect saved transactions.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            await db.execute('DELETE FROM sms_log');
            setLogs([]);
          } catch (error) {
            console.error('Failed to clear SMS logs:', error);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: SmsLogEntry }) => {
    const isParsed = item.status === 'parsed';
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.sender} numberOfLines={1}>{item.sender || '(no sender)'}</Text>
          <View style={[styles.statusBadge, isParsed ? styles.statusParsed : styles.statusUnparsed]}>
            <Text style={styles.statusText}>{isParsed ? 'Parsed' : 'Unparsed'}</Text>
          </View>
        </View>

        <Text style={styles.meta}>
          {SOURCE_LABEL[item.source] || item.source} · {new Date(item.received_at).toLocaleString()}
        </Text>

        <Text style={styles.label}>Message</Text>
        <Text style={styles.body}>{item.body}</Text>

        {isParsed && (
          <>
            <Text style={styles.label}>Parsed</Text>
            <Text style={styles.parsed}>
              {item.bank} · {item.type === 'credit' ? '+' : '-'}
              {item.amount} · {item.merchant}
            </Text>
          </>
        )}

        {item.reference && (
          // Two log rows sharing this value are the same real transaction reported
          // twice in different wording — they collapse to one row in Transactions.
          <Text style={styles.reference}>Ref: {item.reference}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>SMS Logs</Text>
        <TouchableOpacity onPress={clearLogs}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {logs.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No messages logged yet.</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  clearText: { color: '#FF3B30', fontWeight: '600', fontSize: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#888' },
  listContent: { padding: 16, paddingTop: 4 },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { height: 2, width: 0 },
    elevation: 2,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sender: { fontSize: 15, fontWeight: '700', color: '#333', flex: 1, marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusParsed: { backgroundColor: '#e2f7e9' },
  statusUnparsed: { backgroundColor: '#fdecea' },
  statusText: { fontSize: 11, fontWeight: '700', color: '#333' },
  meta: { fontSize: 12, color: '#999', marginTop: 2, marginBottom: 10 },
  label: { fontSize: 11, fontWeight: '700', color: '#aaa', textTransform: 'uppercase', marginBottom: 3 },
  body: { fontSize: 13, color: '#444', lineHeight: 18, marginBottom: 10 },
  parsed: { fontSize: 14, color: '#222', fontWeight: '600' },
  reference: { fontSize: 11, color: '#bbb', marginTop: 6 },
});

export default LogsScreen;
