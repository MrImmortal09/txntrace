import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../db/schema';
import TransactionDetailModal, { TransactionRow } from '../components/TransactionDetailModal';
import SwipeableRow from '../components/SwipeableRow';
import SplitModal from '../components/SplitModal';
import BankIcon from '../components/BankIcon';
import { useTheme } from '../theme/ThemeProvider';
import { checkNewMessages } from '../services/smsIngest';

type Transaction = TransactionRow;

const DailyScreen = () => {
  const { colors } = useTheme();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [splitting, setSplitting] = useState<Transaction | null>(null);

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

  // Opening this tab is the only "immediate" check available — iOS has no way
  // to wake the app in the background when the Shortcuts automation fires, so
  // if the app was already open when the SMS arrived, nothing drains the
  // shared inbox until something calls checkNewMessages() again.
  useFocusEffect(
    useCallback(() => {
      checkNewMessages().then(load);
    }, [load])
  );

  const confirmMine = async (txn: Transaction) => {
    setTxns(prev => prev.filter(t => t.id !== txn.id));
    try {
      await db.execute('UPDATE transactions SET reviewed = 1, updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        txn.id,
      ]);
    } catch (error) {
      console.error('Failed to confirm transaction:', error);
      load();
    }
  };

  const debitTotal = txns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const creditTotal = txns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Needs Review</Text>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Pending spend</Text>
          <Text style={[styles.summaryAmount, { color: colors.danger }]}>₹{debitTotal.toFixed(2)}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Pending received</Text>
          <Text style={[styles.summaryAmount, { color: colors.success }]}>₹{creditTotal.toFixed(2)}</Text>
        </View>
      </View>

      {txns.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>All caught up — nothing waiting on a decision.</Text>
        </View>
      ) : (
        <FlatList
          data={txns}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <SwipeableRow onSwipeRight={() => confirmMine(item)}>
              <View style={[styles.row, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
                <TouchableOpacity style={styles.rowLeft} onPress={() => setSelected(item)} activeOpacity={0.8}>
                  <BankIcon bank={item.bank} size={36} />
                  <View style={styles.rowMiddle}>
                    <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={1}>{item.merchant_raw || 'Unknown'}</Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      {new Date(item.date).toLocaleDateString([], { day: '2-digit', month: 'short' })}
                      {item.category ? ` · ${item.category}` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.rowRight}>
                  <Text style={[styles.amount, { color: item.type === 'credit' ? colors.success : colors.danger }]}>
                    {item.type === 'credit' ? '+' : '-'}₹{item.amount.toFixed(2)}
                  </Text>
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.splitButton, { backgroundColor: colors.primary }]} onPress={() => setSplitting(item)}>
                      <Text style={styles.actionButtonText}>Split</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
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
  container: { flex: 1 },
  title: { fontSize: 24, fontWeight: 'bold', paddingHorizontal: 16, paddingTop: 16 },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, marginBottom: 8, gap: 12 },
  summaryCard: { flex: 1, borderRadius: 12, padding: 16, alignItems: 'center', elevation: 2, shadowOpacity: 1, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8 },
  summaryLabel: { fontSize: 13, marginBottom: 6, fontWeight: '500' },
  summaryAmount: { fontSize: 20, fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  listContent: { padding: 16, paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    elevation: 2,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowMiddle: { flex: 1, justifyContent: 'center' },
  merchant: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, marginTop: 4 },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  amount: { fontSize: 15, fontWeight: 'bold' },
  actions: { flexDirection: 'row', gap: 6 },
  splitButton: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  actionButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});

export default DailyScreen;
