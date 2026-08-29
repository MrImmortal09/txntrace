import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Modal, Alert, SafeAreaView, ScrollView } from 'react-native';
import Swiper from 'react-native-deck-swiper';
import Contacts from 'react-native-contacts';
import { db } from '../db/schema';

interface Transaction {
  id: string;
  bank: string;
  amount: number;
  type: string;
  merchant_raw: string;
  date: string;
  category?: string;
  note?: string;
}

interface Category {
  id: string;
  name: string;
}

interface SplitContact {
  id: string;
  name: string;
  amountOwed: number;
}

const ReviewScreen = () => {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Form state for current card
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  
  // Split state
  const [splitModalVisible, setSplitModalVisible] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactQuery, setContactQuery] = useState('');
  const [contactRecency, setContactRecency] = useState<Record<string, string>>({});
  const [selectedContacts, setSelectedContacts] = useState<SplitContact[]>([]);

  const swiperRef = useRef<Swiper<Transaction>>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const catRes = await db.execute('SELECT * FROM categories');
      const catRows: any = catRes.rows;
      setCategories(catRows?._array || catRows || []);

      const txnRes = await db.execute('SELECT * FROM transactions WHERE reviewed = 0 ORDER BY date DESC');
      const txnRows: any = txnRes.rows;
      setTxns(txnRows?._array || txnRows || []);
    } catch (error) {
      console.error(error);
    }
  };

  const handleCardChange = (index: number) => {
    setCurrentIndex(index);
    setSelectedCategoryId(null);
    setNote('');
    setSelectedContacts([]);
  };

  const handleReview = async (index: number) => {
    const txn = txns[index];
    if (!txn) return;

    try {
      await db.execute(
        'UPDATE transactions SET category = ?, note = ?, reviewed = 1 WHERE id = ?',
        [selectedCategoryId, note, txn.id]
      );

      // Save splits if any
      for (const split of selectedContacts) {
        await db.execute(
          'INSERT INTO splits (id, transaction_id, contact_id, contact_name, amount_owed) VALUES (?, ?, ?, ?, ?)',
          [String(Date.now() + Math.random()), txn.id, split.id, split.name, split.amountOwed]
        );
      }
    } catch (error) {
      console.error('Failed to update transaction', error);
    }
  };

  const openSplitModal = async () => {
    try {
      const permission = await Contacts.requestPermission();
      if (permission === 'authorized') {
        const fetchedContacts = await Contacts.getAll();
        setContacts(fetchedContacts);
        setSplitModalVisible(true);

        // Ranks contacts by the most recent transaction they were split on,
        // so whoever you split with often doesn't get buried in an
        // alphabetical phone-wide contact list.
        const res = await db.execute(
          `SELECT s.contact_id as contactId, MAX(t.date) as lastUsed
           FROM splits s JOIN transactions t ON t.id = s.transaction_id
           GROUP BY s.contact_id`
        );
        const rows: any = res.rows;
        const arr = rows?._array || rows || [];
        const map: Record<string, string> = {};
        for (const r of arr) map[r.contactId] = r.lastUsed;
        setContactRecency(map);
      } else {
        Alert.alert('Permission Denied', 'Please allow contacts access in settings.');
      }
    } catch (error) {
      console.error(error);
    }
  };

  const nameOfContact = (c: any) => c.displayName || `${c.givenName} ${c.familyName}`.trim();

  const sortedContacts = [...contacts].sort((a, b) => {
    const aUsed = contactRecency[a.recordID];
    const bUsed = contactRecency[b.recordID];
    if (aUsed && bUsed) return bUsed.localeCompare(aUsed);
    if (aUsed) return -1;
    if (bUsed) return 1;
    return nameOfContact(a).localeCompare(nameOfContact(b));
  });

  const filteredContacts = contactQuery
    ? sortedContacts.filter(c => nameOfContact(c).toLowerCase().includes(contactQuery.toLowerCase()))
    : sortedContacts;

  const toggleContactSelection = (contact: any) => {
    const exists = selectedContacts.find(c => c.id === contact.recordID);
    let newSelection;
    if (exists) {
      newSelection = selectedContacts.filter(c => c.id !== contact.recordID);
    } else {
      const name = contact.displayName || `${contact.givenName} ${contact.familyName}`.trim();
      newSelection = [...selectedContacts, { id: contact.recordID, name, amountOwed: 0 }];
    }
    
    // Auto equal split — divided only among selected contacts, not assuming
    // the payer is also part of the split. Add yourself (you're in your own
    // Contacts) if this expense should include you too.
    const currentTxn = txns[currentIndex];
    if (newSelection.length > 0 && currentTxn) {
      const splitAmount = currentTxn.amount / newSelection.length;
      newSelection = newSelection.map(c => ({ ...c, amountOwed: Number(splitAmount.toFixed(2)) }));
    }
    
    setSelectedContacts(newSelection);
  };

  const currentTxn = txns[currentIndex];

  if (txns.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>All caught up! No transactions to review.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.swiperContainer}>
        <Swiper
          ref={swiperRef}
          cards={txns}
          renderCard={(card: Transaction) => (
            <View style={styles.card}>
              <Text style={styles.cardBank}>{card.bank}</Text>
              <Text style={[styles.cardAmount, card.type === 'credit' ? styles.credit : styles.debit]}>
                {card.type === 'credit' ? '+' : '-'}{card.amount}
              </Text>
              <Text style={styles.cardMerchant}>{card.merchant_raw}</Text>
              <Text style={styles.cardDate}>{new Date(card.date).toLocaleDateString()}</Text>
            </View>
          )}
          onSwiped={(index) => {
            handleReview(index);
            handleCardChange(index + 1);
          }}
          onSwipedAll={() => setTxns([])}
          cardIndex={currentIndex}
          backgroundColor={'transparent'}
          stackSize={3}
          disableBottomSwipe
          disableTopSwipe
        />
      </View>

      {currentTxn && (
        <View style={styles.formContainer}>
          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.chip, selectedCategoryId === cat.id && styles.chipSelected]}
                onPress={() => setSelectedCategoryId(cat.id)}
              >
                <Text style={selectedCategoryId === cat.id ? styles.chipTextSelected : styles.chipText}>
                  {cat.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Note</Text>
          <TextInput
            style={styles.input}
            placeholder="Why was this spend?"
            value={note}
            onChangeText={setNote}
          />

          <View style={styles.row}>
            <TouchableOpacity style={styles.splitButton} onPress={openSplitModal}>
              <Text style={styles.splitButtonText}>Split this ({selectedContacts.length})</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.reviewButton} 
              onPress={() => swiperRef.current?.swipeRight()}
            >
              <Text style={styles.reviewButtonText}>Review & Next</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Split Modal */}
      <Modal visible={splitModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Split with Contacts</Text>
            <TouchableOpacity onPress={() => setSplitModalVisible(false)}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.contactSearch}
            placeholder="Search contacts"
            value={contactQuery}
            onChangeText={setContactQuery}
          />

          <FlatList
            data={filteredContacts}
            keyExtractor={item => item.recordID}
            renderItem={({ item }) => {
              const isSelected = selectedContacts.some(c => c.id === item.recordID);
              const splitContact = selectedContacts.find(c => c.id === item.recordID);
              const name = nameOfContact(item);
              const usedRecently = !!contactRecency[item.recordID];

              return (
                <View style={styles.contactRow}>
                  <TouchableOpacity
                    style={styles.contactInfo}
                    onPress={() => toggleContactSelection(item)}
                  >
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]} />
                    <Text style={styles.contactName}>{name}</Text>
                    {usedRecently && !isSelected && <Text style={styles.recentTag}>recent</Text>}
                  </TouchableOpacity>

                  {isSelected && (
                    <TextInput
                      style={styles.splitInput}
                      keyboardType="numeric"
                      value={String(splitContact?.amountOwed || '')}
                      onChangeText={(val) => {
                        setSelectedContacts(prev => prev.map(c => 
                          c.id === item.recordID ? { ...c, amountOwed: Number(val) } : c
                        ));
                      }}
                    />
                  )}
                </View>
              );
            }}
          />
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, color: '#888' },
  swiperContainer: { flex: 1, position: 'relative' },
  card: {
    height: 300,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 5,
  },
  cardBank: { fontSize: 16, color: '#888', marginBottom: 10 },
  cardAmount: { fontSize: 40, fontWeight: 'bold', marginBottom: 10 },
  credit: { color: '#34C759' },
  debit: { color: '#FF3B30' },
  cardMerchant: { fontSize: 20, textAlign: 'center', marginBottom: 10 },
  cardDate: { fontSize: 14, color: '#aaa' },
  
  formContainer: { padding: 20, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
  categoryScroll: { marginBottom: 20 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#eee', marginRight: 10, alignSelf: 'flex-start' },
  chipSelected: { backgroundColor: '#007AFF' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff', fontWeight: 'bold' },
  input: { backgroundColor: '#f9f9f9', padding: 12, borderRadius: 10, marginBottom: 20, borderWidth: 1, borderColor: '#eee' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  splitButton: { flex: 1, backgroundColor: '#FF9500', padding: 14, borderRadius: 10, alignItems: 'center', marginRight: 10 },
  splitButtonText: { color: '#fff', fontWeight: 'bold' },
  reviewButton: { flex: 1, backgroundColor: '#34C759', padding: 14, borderRadius: 10, alignItems: 'center' },
  reviewButtonText: { color: '#fff', fontWeight: 'bold' },

  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  doneText: { fontSize: 16, color: '#007AFF', fontWeight: 'bold' },
  contactSearch: { margin: 16, backgroundColor: '#f2f2f2', borderRadius: 10, padding: 12, fontSize: 15 },
  contactRow: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'center' },
  contactInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#ccc', marginRight: 15 },
  checkboxSelected: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  contactName: { fontSize: 16 },
  recentTag: { fontSize: 11, color: '#888', marginLeft: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  splitInput: { width: 80, borderBottomWidth: 1, borderBottomColor: '#ccc', textAlign: 'right', fontSize: 16, padding: 5 }
});

export default ReviewScreen;
