import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { db } from '../db/schema';
import TransactionDetailModal, { TransactionRow } from '../components/TransactionDetailModal';
import AddExpenseModal from '../components/AddExpenseModal';

interface LedgerEntry {
  kind: 'split' | 'settlement';
  id: string;
  transactionId: string;
  date: string;
  amount: number;
  amountOwed?: number; // splits only — the live remaining balance, not shown directly
  merchant: string | null;
  settled: boolean;
}

const FriendDetailScreen = () => {
  const route = useRoute<any>();
  const { contactId, contactName } = route.params;
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [owed, setOwed] = useState(0);
  const [selected, setSelected] = useState<TransactionRow | null>(null);
  const [addVisible, setAddVisible] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      // amount_owed is a live running balance now (it decrements as partial
      // payments come in, reaching 0 once settled) — showing that in the
      // ledger would make a fully-paid split look like it was for ₹0.
      // t.amount is the transaction's own amount, untouched by settlement,
      // so the ledger shows what the expense actually was regardless of
      // how much of it has been paid back; the "owed" total up top still
      // sums amount_owed, since that one does need to reflect what's left.
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
        `SELECT id, transaction_id, amount, date FROM settlements WHERE contact_id = ? ORDER BY date DESC`,
        [contactId]
      );
      const settlementRows: any = settlementsRes.rows;
      const settlements = (settlementRows?._array || settlementRows || []).map((r: any) => ({
        kind: 'settlement' as const,
        id: r.id,
        transactionId: r.transaction_id,
        date: r.date,
        amount: r.amount,
        merchant: null,
        settled: true,
      }));

      const combined = [...splits, ...settlements].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      setEntries(combined);
      setOwed(
        splits
          .filter((s: LedgerEntry) => !s.settled)
          .reduce((sum: number, s: LedgerEntry) => sum + (s.amountOwed ?? 0), 0)
      );
    } catch (error) {
      console.error('Failed to load friend history:', error);
    }
  }, [contactId]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

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
          <TouchableOpacity style={styles.addButton} onPress={() => setAddVisible(true)}>
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>
        <Text style={owed > 0 ? styles.owedAmount : styles.settledText}>
          {owed > 0 ? `owes you ₹${owed.toFixed(2)}` : 'settled up'}
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
                    ? `${contactName} paid you back`
                    : `You paid for ${item.merchant || 'a shared expense'}`}
                </Text>
                <Text style={styles.rowMeta}>
                  {new Date(item.date).toLocaleDateString()}
                  {item.kind === 'split' && !item.settled ? ' · outstanding' : ''}
                  {item.kind === 'split' && item.settled ? ' · settled' : ''}
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
