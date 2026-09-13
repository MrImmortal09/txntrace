import React, { useCallback, useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Line } from 'react-native-svg';
import { db } from '../db/schema';
import TransactionDetailModal, { TransactionRow } from '../components/TransactionDetailModal';
import SwipeableRow from '../components/SwipeableRow';
import SplitModal from '../components/SplitModal';
import BankIcon from '../components/BankIcon';
import PasteSMSModal from '../components/PasteSMSModal';
import ContactPickerModal, { PickedContact } from '../components/ContactPickerModal';
import { useTheme } from '../theme/ThemeProvider';
import { checkNewMessages } from '../services/smsIngest';
import {
  autoMatchCreditTransaction,
  matchCreditToContact,
  markTransactionAsMine,
} from '../services/settlements';
import { openLocationInGoogleMaps } from '../utils/maps';

type Transaction = TransactionRow;

const DailyScreen = () => {
  const { colors } = useTheme();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [splitting, setSplitting] = useState<Transaction | null>(null);
  const [friendMatchingTxn, setFriendMatchingTxn] = useState<Transaction | null>(null);
  const [pasteModalVisible, setPasteModalVisible] = useState(false);
  const lastTapRef = useRef<{ [id: string]: number }>({});
  const singleTapTimerRef = useRef<{ [id: string]: any }>({});
  const ignoringTapsRef = useRef<{ [id: string]: number }>({});

  useEffect(() => {
    return () => {
      Object.values(singleTapTimerRef.current).forEach(clearTimeout);
    };
  }, []);

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
    if (singleTapTimerRef.current[txn.id]) {
      clearTimeout(singleTapTimerRef.current[txn.id]);
      delete singleTapTimerRef.current[txn.id];
    }
    delete lastTapRef.current[txn.id];
    setTxns(prev => prev.filter(t => t.id !== txn.id));
    try {
      await markTransactionAsMine(txn.id);
    } catch (error) {
      console.error('Failed to confirm transaction as mine:', error);
      load();
    }
  };

  const handleRowPress = (txn: Transaction) => {
    const now = Date.now();
    if (now < (ignoringTapsRef.current[txn.id] || 0)) {
      return;
    }

    const lastTap = lastTapRef.current[txn.id] || 0;
    const DOUBLE_TAP_DELAY = 280;

    if (now - lastTap < DOUBLE_TAP_DELAY) {
      // Double tap detected: cancel single-tap timer and mark transaction as mine
      if (singleTapTimerRef.current[txn.id]) {
        clearTimeout(singleTapTimerRef.current[txn.id]);
        delete singleTapTimerRef.current[txn.id];
      }
      delete lastTapRef.current[txn.id];
      ignoringTapsRef.current[txn.id] = now + 1000;
      confirmMine(txn);
    } else {
      // First tap: delay detail modal open until double tap window elapses
      lastTapRef.current[txn.id] = now;
      if (singleTapTimerRef.current[txn.id]) {
        clearTimeout(singleTapTimerRef.current[txn.id]);
      }
      singleTapTimerRef.current[txn.id] = setTimeout(() => {
        delete singleTapTimerRef.current[txn.id];
        delete lastTapRef.current[txn.id];
        setSelected(txn);
      }, DOUBLE_TAP_DELAY);
    }
  };

  const handleMarkForFriend = async (txn: Transaction) => {
    try {
      const result = await autoMatchCreditTransaction(txn);
      if (result.matched) {
        setTxns(prev => prev.filter(t => t.id !== txn.id));
        Alert.alert('Auto-Matched', `Matched to ${result.contactName}`);
        return;
      }
    } catch (err) {
      console.error('Auto match check failed:', err);
    }
    setFriendMatchingTxn(txn);
  };

  const handlePickFriendForCredit = async (contact: PickedContact) => {
    if (!friendMatchingTxn) return;
    const target = friendMatchingTxn;
    setFriendMatchingTxn(null);
    setTxns(prev => prev.filter(t => t.id !== target.id));
    try {
      await matchCreditToContact(target.id, target.merchant_raw, contact.id, contact.name, target.amount);
    } catch (err) {
      console.error('Failed to match credit to friend:', err);
      load();
    }
  };

  const debitTotal = txns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const creditTotal = txns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);

  const formatTxnDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      const cleanDate = dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr;
      const d = new Date(cleanDate);
      if (isNaN(d.getTime())) return dateStr;
      return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return dateStr || '';
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>Needs Review</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setPasteModalVisible(true)}
          activeOpacity={0.8}
          accessibilityLabel="Add transaction from SMS"
        >
          <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <Line x1="12" y1="5" x2="12" y2="19" />
            <Line x1="5" y1="12" x2="19" y2="12" />
          </Svg>
        </TouchableOpacity>
      </View>

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
                <TouchableOpacity style={styles.rowLeft} onPress={() => handleRowPress(item)} activeOpacity={0.8}>
                  <BankIcon bank={item.bank} size={36} />
                  <View style={styles.rowMiddle}>
                    <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={1}>{item.merchant_raw || 'Unknown'}</Text>
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      {formatTxnDate(item.date)}
                      {item.category ? ` · ${item.category}` : ''}
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
                </TouchableOpacity>
                <View style={styles.rowRight}>
                  <Text style={[styles.amount, { color: item.type === 'credit' ? colors.success : colors.danger }]}>
                    {item.type === 'credit' ? '+' : '-'}₹{item.amount.toFixed(2)}
                  </Text>
                  <View style={styles.actions}>
                    {item.type === 'credit' ? (
                      <>
                        <TouchableOpacity
                          style={[styles.mineButton, { borderColor: colors.border }]}
                          onPress={() => confirmMine(item)}
                        >
                          <Text style={[styles.mineButtonText, { color: colors.textSecondary }]}>Mine</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.friendButton, { backgroundColor: colors.primary }]}
                          onPress={() => handleMarkForFriend(item)}
                        >
                          <Text style={styles.actionButtonText}>Friend</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={[styles.splitButton, { backgroundColor: colors.primary }]}
                        onPress={() => setSplitting(item)}
                      >
                        <Text style={styles.actionButtonText}>Split</Text>
                      </TouchableOpacity>
                    )}
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
      <PasteSMSModal
        visible={pasteModalVisible}
        onClose={() => setPasteModalVisible(false)}
        onSuccess={load}
      />
      <ContactPickerModal
        visible={!!friendMatchingTxn}
        title={friendMatchingTxn ? `Who sent ₹${friendMatchingTxn.amount.toFixed(2)}?` : ''}
        onCancel={() => setFriendMatchingTxn(null)}
        onSelect={handlePickFriendForCredit}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: { fontSize: 24, fontWeight: 'bold' },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
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
  locationChip: { marginTop: 4, alignSelf: 'flex-start' },
  locationChipText: { fontSize: 12, fontWeight: '500' },
  mapsLink: { fontSize: 11 },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  amount: { fontSize: 15, fontWeight: 'bold' },
  actions: { flexDirection: 'row', gap: 6 },
  splitButton: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  mineButton: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mineButtonText: { fontSize: 13, fontWeight: '600' },
  friendButton: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});

export default DailyScreen;
