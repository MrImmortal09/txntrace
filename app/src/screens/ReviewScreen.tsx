import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Modal, Alert, SafeAreaView, ScrollView, Animated, PanResponder } from 'react-native';
import Contacts from 'react-native-contacts';
import { db } from '../db/schema';
import {
  createSplit,
  autoMatchCreditTransaction,
  matchCreditToContact,
} from '../services/settlements';
import { openLocationInGoogleMaps } from '../utils/maps';
import { useTheme } from '../theme/ThemeProvider';

const SWIPE_THRESHOLD = 100;

interface Transaction {
  id: string;
  bank: string;
  amount: number;
  type: string;
  merchant_raw: string;
  date: string;
  category?: string;
  note?: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  const { colors } = useTheme();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const formatTxnDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      const cleanDate = dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr;
      const d = new Date(cleanDate);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return dateStr;
    }
  };

  // Form state for current card
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  
  // Split state
  const [splitModalVisible, setSplitModalVisible] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactQuery, setContactQuery] = useState('');
  const [contactRecency, setContactRecency] = useState<Record<string, string>>({});
  const [selectedContacts, setSelectedContacts] = useState<SplitContact[]>([]);

  const pan = useRef(new Animated.ValueXY()).current;

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
    pan.setValue({ x: 0, y: 0 });
  };

  const handleReview = async (index: number) => {
    const txn = txns[index];
    if (!txn) return;

    try {
      await db.execute(
        'UPDATE transactions SET category = ?, note = ?, reviewed = 1, needs_contact_match = 0, updated_at = ? WHERE id = ?',
        [selectedCategoryId, note, new Date().toISOString(), txn.id]
      );

      // Save splits if any
      for (const split of selectedContacts) {
        await createSplit(txn.id, split.id, split.name, split.amountOwed);
      }
    } catch (error) {
      console.error('Failed to update transaction', error);
    }
  };

  // Replaces react-native-deck-swiper: that library sizes its card/gesture
  // layer off Dimensions.get('window') at module load, ignoring the actual
  // (smaller) space its parent gets once the category/note form below it
  // takes its share — the oversized invisible layer swallowed taps meant for
  // that form. A single plain-PanResponder card, same pattern as
  // SwipeableRow, doesn't have that problem since it's sized by normal flow.
  const advance = (direction: 1 | -1 = 1) => {
    Animated.timing(pan, {
      toValue: { x: direction * 500, y: 0 },
      duration: 200,
      useNativeDriver: false,
    }).start(() => {
      const index = currentIndex;
      handleReview(index);
      handleCardChange(index + 1);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderMove: (_, gesture) => {
        pan.setValue({ x: gesture.dx, y: 0 });
      },
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) > SWIPE_THRESHOLD) {
          advance(gesture.dx > 0 ? 1 : -1);
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

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

  const handleMarkCreditForFriend = async () => {
    const txn = txns[currentIndex];
    if (!txn) return;
    try {
      const result = await autoMatchCreditTransaction(txn);
      if (result.matched) {
        Alert.alert('Auto-Matched', `Matched to ${result.contactName}`);
        handleCardChange(currentIndex + 1);
        return;
      }
    } catch (err) {
      console.error('Auto match check failed:', err);
    }
    openSplitModal();
  };

  const toggleContactSelection = async (contact: any) => {
    const currentTxn = txns[currentIndex];
    if (currentTxn && currentTxn.type === 'credit') {
      const name = nameOfContact(contact);
      try {
        await matchCreditToContact(
          currentTxn.id,
          currentTxn.merchant_raw,
          contact.recordID,
          name,
          currentTxn.amount
        );
      } catch (err) {
        console.error('Failed to match credit:', err);
      }
      setSplitModalVisible(false);
      handleCardChange(currentIndex + 1);
      return;
    }

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
    if (newSelection.length > 0 && currentTxn) {
      const splitAmount = currentTxn.amount / newSelection.length;
      newSelection = newSelection.map(c => ({ ...c, amountOwed: Number(splitAmount.toFixed(2)) }));
    }
    
    setSelectedContacts(newSelection);
  };

  const currentTxn = txns[currentIndex];

  if (txns.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>All caught up! No transactions to review.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.swiperContainer}>
        {currentTxn && (
          <Animated.View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                shadowColor: colors.cardShadow,
                transform: [
                  ...pan.getTranslateTransform(),
                  {
                    rotate: pan.x.interpolate({
                      inputRange: [-200, 0, 200],
                      outputRange: ['-10deg', '0deg', '10deg'],
                    }),
                  },
                ],
              },
            ]}
            {...panResponder.panHandlers}
          >
            <Text style={[styles.cardBank, { color: colors.textSecondary }]}>{currentTxn.bank}</Text>
            <Text style={[styles.cardAmount, { color: currentTxn.type === 'credit' ? colors.success : colors.danger }]}>
              {currentTxn.type === 'credit' ? '+' : '-'}₹{currentTxn.amount.toFixed(2)}
            </Text>
            <Text style={[styles.cardMerchant, { color: colors.text }]}>{currentTxn.merchant_raw}</Text>
            <Text style={[styles.cardDate, { color: colors.textSecondary }]}>
              {formatTxnDateTime(currentTxn.date)}
            </Text>
            {currentTxn.location ? (
              <TouchableOpacity
                style={[styles.cardLocation, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => openLocationInGoogleMaps(currentTxn.location, currentTxn.latitude, currentTxn.longitude)}
                activeOpacity={0.7}
              >
                <Text style={[styles.cardLocationText, { color: colors.primary }]}>
                  📍 {currentTxn.location} <Text style={styles.mapsLink}>↗</Text>
                </Text>
              </TouchableOpacity>
            ) : null}
          </Animated.View>
        )}
      </View>

      {currentTxn && (
        <View style={[styles.formContainer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selectedCategoryId === cat.id ? colors.primary : colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setSelectedCategoryId(cat.id)}
              >
                <Text
                  style={
                    selectedCategoryId === cat.id
                      ? styles.chipTextSelected
                      : [styles.chipText, { color: colors.text }]
                  }
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={[styles.label, { color: colors.text }]}>Note</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
            placeholder="Why was this spend?"
            placeholderTextColor={colors.textSecondary}
            value={note}
            onChangeText={setNote}
          />

          <View style={styles.row}>
            {currentTxn.type === 'credit' ? (
              <>
                <TouchableOpacity style={styles.splitButton} onPress={handleMarkCreditForFriend}>
                  <Text style={styles.splitButtonText}>For a Friend</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.reviewButton}
                  onPress={() => advance(1)}
                >
                  <Text style={styles.reviewButtonText}>Mark as Mine</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.splitButton} onPress={openSplitModal}>
                  <Text style={styles.splitButtonText}>Split this ({selectedContacts.length})</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.reviewButton}
                  onPress={() => advance(1)}
                >
                  <Text style={styles.reviewButtonText}>Review & Next</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}

      {/* Split Modal */}
      <Modal visible={splitModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {currentTxn?.type === 'credit' ? 'Match Credit with Friend' : 'Split with Contacts'}
            </Text>
            <TouchableOpacity onPress={() => setSplitModalVisible(false)}>
              <Text style={[styles.doneText, { color: colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.contactSearch, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            placeholder="Search contacts"
            placeholderTextColor={colors.textSecondary}
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
                <View style={[styles.contactRow, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity
                    style={styles.contactInfo}
                    onPress={() => toggleContactSelection(item)}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: colors.border },
                        isSelected && [styles.checkboxSelected, { backgroundColor: colors.primary, borderColor: colors.primary }],
                      ]}
                    />
                    <Text style={[styles.contactName, { color: colors.text }]}>{name}</Text>
                    {usedRecently && !isSelected && (
                      <Text style={[styles.recentTag, { borderColor: colors.border, color: colors.textSecondary }]}>
                        recent
                      </Text>
                    )}
                  </TouchableOpacity>

                  {isSelected && (
                    <TextInput
                      style={[styles.splitInput, { borderBottomColor: colors.border, color: colors.text }]}
                      keyboardType="numeric"
                      value={String(splitContact?.amountOwed || '')}
                      onChangeText={(val) => {
                        setSelectedContacts(prev => prev.map(c => 
                          c.id === item.recordID ? { ...c, amountOwed: Number(val) } : c
                        ));
                      }}
                      placeholderTextColor={colors.textSecondary}
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
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18 },
  swiperContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: {
    width: '88%',
    height: 300,
    borderRadius: 20,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 5,
  },
  cardBank: { fontSize: 16, marginBottom: 10 },
  cardAmount: { fontSize: 40, fontWeight: 'bold', marginBottom: 10 },
  credit: { color: '#34C759' },
  debit: { color: '#FF3B30' },
  cardMerchant: { fontSize: 20, textAlign: 'center', marginBottom: 10 },
  cardDate: { fontSize: 14 },
  cardLocation: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, borderWidth: 1 },
  cardLocationText: { fontSize: 13, fontWeight: '500' },
  mapsLink: { fontSize: 12, textDecorationLine: 'underline' },
  
  formContainer: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1 },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 10 },
  categoryScroll: { marginBottom: 20 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 10, alignSelf: 'flex-start', borderWidth: 1 },
  chipSelected: {},
  chipText: {},
  chipTextSelected: { color: '#fff', fontWeight: 'bold' },
  input: { padding: 12, borderRadius: 10, marginBottom: 20, borderWidth: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  splitButton: { flex: 1, backgroundColor: '#FF9500', padding: 14, borderRadius: 10, alignItems: 'center', marginRight: 10 },
  splitButtonText: { color: '#fff', fontWeight: 'bold' },
  reviewButton: { flex: 1, backgroundColor: '#34C759', padding: 14, borderRadius: 10, alignItems: 'center' },
  reviewButtonText: { color: '#fff', fontWeight: 'bold' },

  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  doneText: { fontSize: 16, fontWeight: 'bold' },
  contactSearch: { margin: 16, borderRadius: 10, padding: 12, fontSize: 15, borderWidth: 1 },
  contactRow: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, alignItems: 'center' },
  contactInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, marginRight: 15 },
  checkboxSelected: {},
  contactName: { fontSize: 16 },
  recentTag: { fontSize: 11, marginLeft: 8, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  splitInput: { width: 80, borderBottomWidth: 1, textAlign: 'right', fontSize: 16, padding: 5 }
});

export default ReviewScreen;
