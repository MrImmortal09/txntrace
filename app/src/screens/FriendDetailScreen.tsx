import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { db } from '../db/schema';
import { settleDebtToFriend } from '../services/settlements';
import TransactionDetailModal, { TransactionRow } from '../components/TransactionDetailModal';
import AddExpenseModal from '../components/AddExpenseModal';

interface LedgerEntry {
  kind: 'split' | 'settlement';
  id: string;
  transactionId: string;
  date: string;
  amount: number;
  amountOwed?: number; // splits only — the live remaining balance
  unappliedAmount?: number; // settlements only — live remaining excess owed to friend
  merchant: string | null;
  settled: boolean;
}

const FriendDetailScreen = () => {
  const route = useRoute<any>();
  const { contactId, contactName } = route.params;
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [selected, setSelected] = useState<TransactionRow | null>(null);
  const [addVisible, setAddVisible] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const splitsRes = await db.execute(
        `SELECT s.id, s.transaction_id, s.amount_owed, t.amount as txn_amount, s.settled, t.date, t.merchant_raw
         FROM splits s JOIN transactions t ON t.id = s.transaction_id
         WHERE s.contact_id = ? ORDER BY t.date DESC`,
        [contactId]
      );
      const splitRows: any = splitsRes.rows;
      const splits = (splitRows?._array || splitRows || []).map((r: any) => ({
        kind: 'split' as const,
        id: r.id,
        transactionId: r.transaction_id,
        date: r.date,
        amount: r.txn_amount,
        amountOwed: r.amount_owed,
        merchant: r.merchant_raw,
        settled: !!r.settled,
      }));

      const settlementsRes = await db.execute(
        `SELECT id, transaction_id, amount, unapplied_amount, date FROM settlements WHERE contact_id = ? ORDER BY date DESC`,
        [contactId]
      );
      const settlementRows: any = settlementsRes.rows;
      const settlements = (settlementRows?._array || settlementRows || []).map((r: any) => ({
        kind: 'settlement' as const,
        id: r.id,
        transactionId: r.transaction_id,
        date: r.date,
        amount: r.amount,
        unappliedAmount: r.unapplied_amount || 0,
        merchant: null,
        settled: true,
      }));

      const combined = [...splits, ...settlements].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
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

  const openOriginalMessage = async (transactionId: string) => {
    try {
      const res = await db.execute('SELECT * FROM transactions WHERE id = ?', [transactionId]);
      const rows: any = res.rows;
      const arr = rows?._array || rows || [];
      if (arr[0]) setSelected(arr[0]);
    } catch (error) {
      console.error('Failed to load original transaction:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.name}>{contactName}</Text>
          <View style={styles.headerActions}>
            {balance < 0 && (
              <TouchableOpacity style={styles.settleButton} onPress={handleSettleUp}>
                <Text style={styles.settleButtonText}>Settle Up</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.addButton} onPress={() => setAddVisible(true)}>
              <Text style={styles.addButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={balance > 0 ? styles.owedAmount : balance < 0 ? styles.youOweAmount : styles.settledText}>
          {balance > 0
            ? `owes you ₹${balance.toFixed(2)}`
            : balance < 0
            ? `you owe ₹${Math.abs(balance).toFixed(2)}`
            : 'settled up'}
        </Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No history with {contactName} yet.</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={item => `${item.kind}_${item.id}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openOriginalMessage(item.transactionId)}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>
                  {item.kind === 'settlement'
                    ? `${contactName} paid you`
                    : `You paid for ${item.merchant || 'a shared expense'}`}
                </Text>
                <Text style={styles.rowMeta}>
                  {new Date(item.date).toLocaleDateString()}
                  {item.kind === 'split' && !item.settled ? ` · ₹${(item.amountOwed ?? item.amount).toFixed(2)} outstanding` : ''}
                  {item.kind === 'split' && item.settled ? ' · settled' : ''}
                  {item.kind === 'settlement' && item.unappliedAmount && item.unappliedAmount > 0
                    ? ` · ₹${item.unappliedAmount.toFixed(2)} remaining (you owe)`
                    : ''}
                </Text>
              </View>
              <Text style={[styles.rowAmount, item.kind === 'settlement' ? styles.credit : styles.debit]}>
                {item.kind === 'settlement' ? '+' : '-'}₹{item.amount.toFixed(2)}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settleButton: {
    backgroundColor: '#34C759',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  settleButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '600', lineHeight: 22 },
  owedAmount: { fontSize: 16, fontWeight: '600', color: '#FF9500', marginTop: 4 },
  youOweAmount: { fontSize: 16, fontWeight: '600', color: '#FF3B30', marginTop: 4 },
  settledText: { fontSize: 16, fontWeight: '600', color: '#34C759', marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { color: '#999', fontSize: 15, textAlign: 'center' },
  listContent: { padding: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#333' },
  rowMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  rowAmount: { fontSize: 16, fontWeight: 'bold' },
  debit: { color: '#FF3B30' },
  credit: { color: '#34C759' },
});

export default FriendDetailScreen;
