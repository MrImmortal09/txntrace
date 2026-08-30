import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { db } from '../db/schema';
import { matchNameToContact } from '../services/settlements';
import ContactPickerModal, { PickedContact } from '../components/ContactPickerModal';
import AddExpenseModal from '../components/AddExpenseModal';

interface PendingMatch {
  id: string;
  merchant_raw: string;
  amount: number;
  date: string;
}

interface FriendBalance {
  contact_id: string;
  contact_name: string;
  owed: number;
}

const FriendsScreen = () => {
  const navigation = useNavigation<any>();
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
          (SELECT COALESCE(SUM(amount_owed), 0) FROM splits s2
             WHERE s2.contact_id = c.contact_id AND s2.settled = 0) as owed
        FROM (
          SELECT contact_id, contact_name FROM splits
          UNION
          SELECT contact_id, contact_name FROM settlements
          UNION
          SELECT contact_id, contact_name FROM contact_aliases
        ) c
        GROUP BY contact_id
        ORDER BY owed DESC, contact_name ASC
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

  const handlePick = async (contact: PickedContact) => {
    if (!matchingTxn) return;
    try {
      await matchNameToContact(matchingTxn.merchant_raw, contact.id, contact.name);
    } catch (error) {
      console.error('Failed to match name to contact:', error);
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
    <SafeAreaView style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Friends</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setAddingExpense(true)}>
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {pending.length > 0 && (
        <View style={styles.pendingSection}>
          <Text style={styles.sectionHeader}>Needs matching</Text>
          {pending.map(item => (
            <TouchableOpacity key={item.id} style={styles.pendingRow} onPress={() => setMatchingTxn(item)}>
              <View style={styles.pendingInfo}>
                <Text style={styles.pendingName}>{item.merchant_raw}</Text>
                <Text style={styles.pendingMeta}>{new Date(item.date).toLocaleDateString()}</Text>
              </View>
              <Text style={styles.pendingAmount}>+₹{item.amount.toFixed(2)}</Text>
              <Text style={styles.matchButton}>Match</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {friends.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No friends yet — split a transaction to get started.</Text>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={item => item.contact_id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.friendRow}
              onPress={() => navigation.navigate('FriendDetail', { contactId: item.contact_id, contactName: item.contact_name })}
            >
              <Text style={styles.friendName}>{item.contact_name}</Text>
              {item.owed > 0 ? (
                <Text style={styles.owedAmount}>owes ₹{item.owed.toFixed(2)}</Text>
              ) : (
                <Text style={styles.settledText}>settled up</Text>
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '600', lineHeight: 22 },
  sectionHeader: { fontSize: 13, fontWeight: '700', color: '#999', textTransform: 'uppercase', marginBottom: 8 },
  pendingSection: { backgroundColor: '#fff8e1', marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 10 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  pendingInfo: { flex: 1 },
  pendingName: { fontSize: 15, fontWeight: '600', color: '#333' },
  pendingMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  pendingAmount: { fontSize: 15, fontWeight: 'bold', color: '#34C759', marginRight: 10 },
  matchButton: { fontSize: 14, fontWeight: '700', color: '#007AFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyText: { color: '#999', fontSize: 15, textAlign: 'center' },
  listContent: { padding: 16, paddingTop: 8 },
  friendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
  },
  friendName: { fontSize: 16, fontWeight: '600', color: '#333' },
  owedAmount: { fontSize: 15, fontWeight: 'bold', color: '#FF9500' },
  settledText: { fontSize: 14, color: '#34C759', fontWeight: '600' },
});

export default FriendsScreen;
