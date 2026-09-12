import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { db } from '../db/schema';
import { settleDebtToFriend, clearAllDebtsWithContact } from '../services/settlements';
import TransactionDetailModal, { TransactionRow } from '../components/TransactionDetailModal';
import AddExpenseModal from '../components/AddExpenseModal';
import EditDebtModal, { EditableLedgerEntry } from '../components/EditDebtModal';
import { openLocationInGoogleMaps } from '../utils/maps';
import { useTheme } from '../theme/ThemeProvider';

export type LedgerEntry = EditableLedgerEntry;

const FriendDetailScreen = () => {
  const { colors } = useTheme();
  const route = useRoute<any>();
  const { contactId, contactName } = route.params;
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [selected, setSelected] = useState<TransactionRow | null>(null);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [addVisible, setAddVisible] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const splitsRes = await db.execute(
        `SELECT s.id, s.transaction_id, s.amount_owed, COALESCE(s.original_amount, s.amount_owed, t.amount, 0) as split_amount, s.settled, COALESCE(t.date, datetime('now')) as date, COALESCE(t.merchant_raw, 'Shared Expense') as merchant_raw, t.location, t.latitude, t.longitude
         FROM splits s LEFT JOIN transactions t ON t.id = s.transaction_id
         WHERE s.contact_id = ? ORDER BY COALESCE(t.date, datetime('now')) DESC`,
        [contactId]
      );
      const splitRows: any = splitsRes.rows;
      const splits: LedgerEntry[] = (splitRows?._array || splitRows || []).map((r: any) => ({
        kind: 'split' as const,
        id: r.id,
        transactionId: r.transaction_id,
        date: r.date,
        amount: r.split_amount,
        amountOwed: r.amount_owed,
        merchant: r.merchant_raw,
        settled: !!r.settled,
        location: r.location,
        latitude: r.latitude,
        longitude: r.longitude,
      }));

      const settlementsRes = await db.execute(
        `SELECT s.id, s.transaction_id, s.amount, s.unapplied_amount, s.date, t.location, t.latitude, t.longitude
         FROM settlements s
         LEFT JOIN transactions t ON t.id = s.transaction_id
         WHERE s.contact_id = ? ORDER BY s.date DESC`,
        [contactId]
      );
      const settlementRows: any = settlementsRes.rows;
      const settlements: LedgerEntry[] = (settlementRows?._array || settlementRows || []).map((r: any) => ({
        kind: 'settlement' as const,
        id: r.id,
        transactionId: r.transaction_id,
        date: r.date,
        amount: r.amount,
        unappliedAmount: r.unapplied_amount || 0,
        merchant: null,
        settled: true,
        location: r.location,
        latitude: r.latitude,
        longitude: r.longitude,
      }));

      const combined = [...splits, ...settlements].sort(
        (a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0)
      );
      setEntries(combined);

      const openSplitsTotal = splits
        .filter((s: LedgerEntry) => !s.settled)
        .reduce((sum: number, s: LedgerEntry) => sum + (s.amountOwed ?? 0), 0);
      const unappliedTotal = settlements
        .reduce((sum: number, s: LedgerEntry) => sum + (s.unappliedAmount ?? 0), 0);
      const net = Number((openSplitsTotal - unappliedTotal).toFixed(2));
      setBalance(net);
    } catch (error) {
      console.error('Failed to load friend history:', error);
    }
  }, [contactId]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  const handleSettleUp = () => {
    if (balance >= 0) return;
    const amountToSettle = Math.abs(balance);
    Alert.alert(
      'Settle Debt',
      `Clear debt of ₹${amountToSettle.toFixed(2)} to ${contactName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Settled',
          onPress: async () => {
            try {
              await settleDebtToFriend(contactId, contactName, amountToSettle);
              loadHistory();
            } catch (err) {
              console.error('Failed to settle debt:', err);
            }
          },
        },
      ]
    );
  };

  const handleClearAllDebts = () => {
    Alert.alert(
      'Clear All Debts',
      `Clear all outstanding debts and balances with ${contactName}? All open splits will be marked settled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllDebtsWithContact(contactId);
              loadHistory();
            } catch (err) {
              console.error('Failed to clear debts:', err);
            }
          },
        },
      ]
    );
  };

  const openOriginalMessage = async (transactionId?: string | null) => {
    if (!transactionId) return;
    try {
      const res = await db.execute('SELECT * FROM transactions WHERE id = ?', [transactionId]);
      const rows: any = res.rows;
      const arr = rows?._array || rows || [];
      if (arr[0]) setSelected(arr[0]);
    } catch (error) {
      console.error('Failed to load original transaction:', error);
    }
  };

  const formatDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return dateStr;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <Text style={[styles.name, { color: colors.text }]}>{contactName}</Text>
          <View style={styles.headerActions}>
            {balance < 0 && (
              <TouchableOpacity style={[styles.settleButton, { backgroundColor: colors.success }]} onPress={handleSettleUp}>
                <Text style={styles.settleButtonText}>Settle Up</Text>
              </TouchableOpacity>
            )}
            {balance !== 0 && (
              <TouchableOpacity
                style={[styles.clearButton, { borderColor: colors.border }]}
                onPress={handleClearAllDebts}
              >
                <Text style={[styles.clearButtonText, { color: colors.textSecondary }]}>Clear All</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => setAddVisible(true)}
            >
              <Text style={styles.addButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text
          style={[
            styles.balanceText,
            balance > 0
              ? { color: colors.warning }
              : balance < 0
              ? { color: colors.danger }
              : { color: colors.success },
          ]}
        >
          {balance > 0
            ? `owes you ₹${balance.toFixed(2)}`
            : balance < 0
            ? `you owe ₹${Math.abs(balance).toFixed(2)}`
            : 'settled up'}
        </Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No history with {contactName} yet.</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={item => `${item.kind}_${item.id}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}
              onPress={() => setEditingEntry(item)}
              activeOpacity={0.8}
            >
              <View style={styles.rowInfo}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>
                  {item.kind === 'settlement'
                    ? `${contactName} paid you`
                    : item.merchant?.toLowerCase().startsWith('paid back')
                    ? `You paid back ${contactName}`
                    : `You paid for ${item.merchant || 'a shared expense'}`}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
                  {formatDateTime(item.date)}
                  {item.kind === 'split' && !item.settled ? ` · ₹${(item.amountOwed ?? item.amount).toFixed(2)} outstanding` : ''}
                  {item.kind === 'split' && item.settled ? ' · settled' : ''}
                  {item.kind === 'settlement' && item.unappliedAmount && item.unappliedAmount > 0
                    ? ` · ₹${item.unappliedAmount.toFixed(2)} remaining (you owe)`
                    : ''}
                </Text>
                {item.location ? (
                  <TouchableOpacity
                    style={styles.locationChip}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      openLocationInGoogleMaps(item.location, item.latitude, item.longitude);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={[styles.locationChipText, { color: colors.primary }]} numberOfLines={1}>
                      📍 {item.location} <Text style={styles.mapsLink}>↗</Text>
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.rowRight}>
                <Text style={[styles.rowAmount, { color: item.kind === 'settlement' ? colors.success : colors.danger }]}>
                  {item.kind === 'settlement' ? '+' : '-'}₹{item.amount.toFixed(2)}
                </Text>
                <TouchableOpacity
                  style={[styles.rowEditButton, { borderColor: colors.border }]}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setEditingEntry(item);
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={[styles.rowEditText, { color: colors.primary }]}>Edit</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <EditDebtModal
        visible={!!editingEntry}
        entry={editingEntry}
        contactName={contactName}
        onClose={() => setEditingEntry(null)}
        onSaved={() => {
          setEditingEntry(null);
          loadHistory();
        }}
        onViewTransaction={(txnId) => {
          setTimeout(() => {
            openOriginalMessage(txnId);
          }, 150);
        }}
      />

      <TransactionDetailModal transaction={selected} onClose={() => setSelected(null)} />

      <AddExpenseModal
        visible={addVisible}
        contactId={contactId}
        contactName={contactName}
        onClose={() => setAddVisible(false)}
        onSaved={() => {
          setAddVisible(false);
          loadHistory();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, borderBottomWidth: 1 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 24, fontWeight: 'bold' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settleButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  settleButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  clearButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  clearButtonText: { fontSize: 12, fontWeight: '600' },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '600', lineHeight: 22 },
  balanceText: { fontSize: 16, fontWeight: '600', marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  listContent: { padding: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  rowInfo: { flex: 1, marginRight: 12 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 4 },
  locationChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  locationChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  mapsLink: {
    fontSize: 11,
  },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  rowAmount: { fontSize: 16, fontWeight: 'bold' },
  rowEditButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  rowEditText: { fontSize: 12, fontWeight: '600' },
});

export default FriendDetailScreen;
