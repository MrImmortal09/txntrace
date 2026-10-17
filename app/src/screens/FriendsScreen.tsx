import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../db/schema';
import {
  autoMatchCreditTransaction,
  matchCreditToContact,
  markTransactionAsMine,
} from '../services/settlements';
import ContactPickerModal, { PickedContact } from '../components/ContactPickerModal';
import AddExpenseModal from '../components/AddExpenseModal';
import { useTheme } from '../theme/ThemeProvider';

interface PendingMatch {
  id: string;
  merchant_raw: string;
  amount: number;
  date: string;
}

interface FriendBalance {
  contact_id: string;
  contact_name: string;
  net_balance: number;
  owed_by_friend: number;
  owed_to_friend: number;
}

const FriendsScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [pending, setPending] = useState<PendingMatch[]>([]);
  const [friends, setFriends] = useState<FriendBalance[]>([]);
  const [matchingTxn, setMatchingTxn] = useState<PendingMatch | null>(null);
  const [addingExpense, setAddingExpense] = useState(false);
  const [expenseContact, setExpenseContact] = useState<PickedContact | null>(null);

  const loadData = useCallback(async () => {
    try {
      const pendingRes = await db.execute(
        `SELECT id, merchant_raw, amount, date FROM transactions
         WHERE needs_contact_match = 1 ORDER BY date DESC`
      );
      const pendingRows: any = pendingRes.rows;
      setPending(pendingRows?._array || pendingRows || []);

      const friendsRes = await db.execute(`
        SELECT contact_id, MAX(contact_name) as contact_name,
          COALESCE((SELECT SUM(amount_owed) FROM splits s2 WHERE s2.contact_id = c.contact_id AND s2.settled = 0), 0) as owed_by_friend,
          COALESCE((SELECT SUM(unapplied_amount) FROM settlements st WHERE st.contact_id = c.contact_id), 0) as owed_to_friend,
          (COALESCE((SELECT SUM(amount_owed) FROM splits s2 WHERE s2.contact_id = c.contact_id AND s2.settled = 0), 0) -
           COALESCE((SELECT SUM(unapplied_amount) FROM settlements st WHERE st.contact_id = c.contact_id), 0)) as net_balance
        FROM (
          SELECT contact_id, contact_name FROM splits
          UNION
          SELECT contact_id, contact_name FROM settlements
          UNION
          SELECT contact_id, contact_name FROM contact_aliases
        ) c
        GROUP BY contact_id
        ORDER BY ABS(net_balance) DESC, net_balance DESC, contact_name ASC
      `);
      const friendRows: any = friendsRes.rows;
      setFriends(friendRows?._array || friendRows || []);
    } catch (error) {
      console.error('Failed to load friends data:', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleMarkAsMine = async (item: PendingMatch) => {
    try {
      await markTransactionAsMine(item.id);
      loadData();
    } catch (error) {
      console.error('Failed to mark as mine:', error);
    }
  };

  const handleMatch = async (item: PendingMatch) => {
    try {
      const autoResult = await autoMatchCreditTransaction(item);
      if (autoResult.matched) {
        Alert.alert('Auto-Matched', `Matched to ${autoResult.contactName}`);
        loadData();
        return;
      }
    } catch (error) {
      console.error('Auto match failed, opening picker:', error);
    }
    setMatchingTxn(item);
  };

  const handlePick = async (contact: PickedContact) => {
    if (!matchingTxn) return;
    try {
      await matchCreditToContact(
        matchingTxn.id,
        matchingTxn.merchant_raw,
        contact.id,
        contact.name,
        matchingTxn.amount
      );
    } catch (error) {
      console.error('Failed to match credit to contact:', error);
    }
    setMatchingTxn(null);
    loadData();
  };

  // FriendsScreen's own list only shows contacts with existing history (a
  // split, settlement, or alias — see the UNION in loadData above), so a
  // brand-new friend has no row to tap into and reach FriendDetailScreen's
  // own "+" button. Picking a contact here first is what makes it possible
  // to start a ledger with someone you've never split anything with yet.
  const handlePickForExpense = (contact: PickedContact) => {
    setAddingExpense(false);
    setExpenseContact(contact);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.titleRow, { paddingTop: Math.max(insets.top + 16, 16) }]}>
        <Text style={[styles.title, { color: colors.text }]}>Friends</Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => setAddingExpense(true)}
          accessibilityRole="button"
          accessibilityLabel="Add an expense with a friend"
        >
          <Text style={[styles.addButtonText, { color: colors.onPrimary }]}>+</Text>
        </TouchableOpacity>
      </View>

      {pending.length > 0 && (
        <View style={[styles.pendingSection, { backgroundColor: colors.warning + '1A', borderColor: colors.warning + '55' }]}>
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>Needs matching</Text>
          {pending.map(item => (
            <View key={item.id} style={styles.pendingRow}>
              <View style={styles.pendingInfo}>
                <Text style={[styles.pendingName, { color: colors.text }]}>{item.merchant_raw || 'Unknown Payer'}</Text>
                <Text style={[styles.pendingMeta, { color: colors.textSecondary }]}>{new Date(item.date).toLocaleDateString()}</Text>
              </View>
              <Text style={[styles.pendingAmount, { color: colors.success }]}>+₹{item.amount.toFixed(2)}</Text>
              <View style={styles.pendingActions}>
                <TouchableOpacity
                  style={[styles.mineButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  onPress={() => handleMarkAsMine(item)}
                >
                  <Text style={[styles.mineButtonText, { color: colors.textSecondary }]}>Mine</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.matchButtonTouch, { backgroundColor: colors.primary }]}
                  onPress={() => handleMatch(item)}
                >
                  <Text style={[styles.matchButton, { color: colors.onPrimary }]}>Match</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {friends.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No friends yet — split a transaction to get started.
          </Text>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={item => item.contact_id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.friendRow, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}
              onPress={() =>
                navigation.navigate('FriendDetail', {
                  contactId: item.contact_id,
                  contactName: item.contact_name,
                })
              }
            >
              <Text style={[styles.friendName, { color: colors.text }]}>{item.contact_name}</Text>
              {item.net_balance > 0 ? (
                <Text style={[styles.owedAmount, { color: colors.warning }]}>owes ₹{item.net_balance.toFixed(2)}</Text>
              ) : item.net_balance < 0 ? (
                <Text style={[styles.youOweAmount, { color: colors.danger }]}>
                  you owe ₹{Math.abs(item.net_balance).toFixed(2)}
                </Text>
              ) : (
                <Text style={[styles.settledText, { color: colors.success }]}>settled up</Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      <ContactPickerModal
        visible={!!matchingTxn}
        title={matchingTxn ? `Who is "${matchingTxn.merchant_raw}"?` : ''}
        onCancel={() => setMatchingTxn(null)}
        onSelect={handlePick}
      />

      <ContactPickerModal
        visible={addingExpense}
        title="Who is this expense for?"
        onCancel={() => setAddingExpense(false)}
        onSelect={handlePickForExpense}
      />

      <AddExpenseModal
        visible={!!expenseContact}
        contactId={expenseContact?.id ?? null}
        contactName={expenseContact?.name ?? null}
        onClose={() => setExpenseContact(null)}
        onSaved={() => {
          setExpenseContact(null);
          loadData();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: 'bold' },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { fontSize: 20, fontWeight: '600', lineHeight: 22 },
  sectionHeader: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  pendingSection: { marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 10, borderWidth: 1 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  pendingInfo: { flex: 1 },
  pendingName: { fontSize: 15, fontWeight: '600' },
  pendingMeta: { fontSize: 12, marginTop: 2 },
  pendingAmount: { fontSize: 15, fontWeight: 'bold', marginRight: 10 },
  pendingActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mineButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  mineButtonText: { fontSize: 13, fontWeight: '600' },
  matchButtonTouch: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  matchButton: { fontSize: 13, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  listContent: { padding: 16, paddingTop: 8 },
  friendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    elevation: 2,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  friendName: { fontSize: 16, fontWeight: '600' },
  owedAmount: { fontSize: 15, fontWeight: 'bold' },
  youOweAmount: { fontSize: 15, fontWeight: 'bold' },
  settledText: { fontSize: 14, fontWeight: '600' },
});

export default FriendsScreen;
