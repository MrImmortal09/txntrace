import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../db/schema';
import TransactionDetailModal, { TransactionRow } from '../components/TransactionDetailModal';
import SwipeableRow from '../components/SwipeableRow';
import SplitModal from '../components/SplitModal';
import BankIcon from '../components/BankIcon';

type Transaction = TransactionRow;

const DailyScreen = () => {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [splitting, setSplitting] = useState<Transaction | null>(null);

  // Not scoped to a single day — this is a "needs a decision" queue across all
  // time, cleared one of three ways: split it, confirm it's a personal spend
  // (swipe right, or the Mine button), or leave it for later. None of these
  // remove the underlying transaction — "reviewed" only controls whether it
  // shows up here, the row and its amount always stay in spend totals.
  const load = useCallback(async () => {
    try {
      const res = await db.execute(
        `SELECT * FROM transactions WHERE reviewed = 0 ORDER BY date DESC LIMIT 300`
      );
      const rows: any = res.rows;
      setTxns(rows?._array || rows || []);
    } catch (error) {
      console.error('Failed to load pending transactions:', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const confirmMine = async (txn: Transaction) => {
    setTxns(prev => prev.filter(t => t.id !== txn.id));
    try {
      await db.execute('UPDATE transactions SET reviewed = 1 WHERE id = ?', [txn.id]);
    } catch (error) {
      console.error('Failed to confirm transaction:', error);
      load(); // put it back in the list if the write failed
    }
  };

  const debitTotal = txns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const creditTotal = txns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Needs Review</Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Pending spend</Text>
          <Text style={[styles.summaryAmount, styles.debit]}>₹{debitTotal.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Pending received</Text>
          <Text style={[styles.summaryAmount, styles.credit]}>₹{creditTotal.toFixed(2)}</Text>
        </View>
      </View>

      {txns.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>All caught up — nothing waiting on a decision.</Text>
        </View>
      ) : (
        <FlatList
          data={txns}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <SwipeableRow onSwipeRight={() => confirmMine(item)}>
              <TouchableOpacity style={styles.row} onPress={() => setSelected(item)} activeOpacity={0.8}>
                <BankIcon bank={item.bank} size={36} />
                <View style={styles.rowMiddle}>
                  <Text style={styles.merchant} numberOfLines={1}>{item.merchant_raw || 'Unknown'}</Text>
                  <Text style={styles.meta}>
                    {new Date(item.date).toLocaleDateString([], { day: '2-digit', month: 'short' })}
                    {item.category ? ` · ${item.category}` : ''}
                  </Text>
                </View>
                <Text style={[styles.amount, item.type === 'credit' ? styles.credit : styles.debit]}>
                  {item.type === 'credit' ? '+' : '-'}₹{item.amount.toFixed(2)}
                </Text>
                <TouchableOpacity style={styles.splitButton} onPress={() => setSplitting(item)}>
                  <Text style={styles.splitButtonText}>Split</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mineButton} onPress={() => confirmMine(item)}>
                  <Text style={styles.mineButtonText}>Mine</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </SwipeableRow>
          )}
        />
      )}

      <TransactionDetailModal transaction={selected} onClose={() => setSelected(null)} />

      {splitting && (
        <SplitModal
          visible={!!splitting}
          transactionId={splitting.id}
          amount={splitting.amount}
          onClose={() => setSplitting(null)}
          onSaved={() => {
            setTxns(prev => prev.filter(t => t.id !== splitting.id));
            setSplitting(null);
          }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333', paddingHorizontal: 16, paddingTop: 16 },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, marginBottom: 8, gap: 12 },
  summaryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 14, alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: '#999', marginBottom: 4 },
  summaryAmount: { fontSize: 18, fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { color: '#999', fontSize: 15, textAlign: 'center' },
  listContent: { padding: 16, paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  rowMiddle: { flex: 1 },
  merchant: { fontSize: 15, fontWeight: '600', color: '#333' },
  meta: { fontSize: 12, color: '#999', marginTop: 2 },
  amount: { fontSize: 15, fontWeight: 'bold' },
  debit: { color: '#FF3B30' },
  credit: { color: '#34C759' },
  splitButton: { backgroundColor: '#FF9500', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  splitButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  mineButton: { backgroundColor: '#34C759', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  mineButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

export default DailyScreen;
