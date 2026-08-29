import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Modal, Alert, SafeAreaView } from 'react-native';
import Contacts from 'react-native-contacts';
import { db } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';

interface SplitContact {
  id: string;
  name: string;
  amountOwed: number;
}

interface Props {
  visible: boolean;
  transactionId: string;
  amount: number;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Used by the Daily list's per-row "Split" action. Commits immediately on
 * Done (splits saved, transaction marked reviewed) — unlike ReviewScreen's
 * own inline split modal, which defers the write until the whole card is
 * swiped so category/note/splits land together. Kept separate rather than
 * shared since those are genuinely different commit semantics, not just
 * duplicated code.
 */
const SplitModal = ({ visible, transactionId, amount, onClose, onSaved }: Props) => {
  const { colors } = useTheme();
  const [contacts, setContacts] = useState<any[]>([]);
  const [recency, setRecency] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SplitContact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');

  const loadContacts = async () => {
    try {
      const permission = await Contacts.requestPermission();
      if (permission === 'authorized') {
        setContacts(await Contacts.getAll());
        setLoaded(true);
      } else {
        Alert.alert('Permission Denied', 'Please allow contacts access in Settings.');
      }
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  };

  // Ranks contacts by the most recent transaction they were split on, so
  // whoever you split with often (or most recently) doesn't get buried in an
  // alphabetical phone-wide contact list.
  const loadRecency = async () => {
    try {
      const res = await db.execute(
        `SELECT s.contact_id as contactId, MAX(t.date) as lastUsed
         FROM splits s JOIN transactions t ON t.id = s.transaction_id
         GROUP BY s.contact_id`
      );
      const rows: any = res.rows;
      const arr = rows?._array || rows || [];
      const map: Record<string, string> = {};
      for (const r of arr) map[r.contactId] = r.lastUsed;
      setRecency(map);
    } catch (error) {
      console.error('Failed to load contact recency:', error);
    }
  };

  useEffect(() => {
    if (visible && !loaded) {
      loadContacts();
      loadRecency();
    }
  }, [visible, loaded]);

  const nameOf = (c: any) => c.displayName || `${c.givenName} ${c.familyName}`.trim();

  const sortedContacts = [...contacts].sort((a, b) => {
    const aUsed = recency[a.recordID];
    const bUsed = recency[b.recordID];
    if (aUsed && bUsed) return bUsed.localeCompare(aUsed); // most recent first
    if (aUsed) return -1;
    if (bUsed) return 1;
    return nameOf(a).localeCompare(nameOf(b)); // alphabetical fallback
  });

  const filteredContacts = query
    ? sortedContacts.filter(c => nameOf(c).toLowerCase().includes(query.toLowerCase()))
    : sortedContacts;

  const toggleContact = (contact: any) => {
    const exists = selected.find(c => c.id === contact.recordID);
    let next: SplitContact[];
    if (exists) {
      next = selected.filter(c => c.id !== contact.recordID);
    } else {
      next = [...selected, { id: contact.recordID, name: nameOf(contact), amountOwed: 0 }];
    }
    if (next.length > 0) {
      // Divided only among selected contacts — not assuming the payer is
      // also part of the split. Add yourself (you're in your own Contacts)
      // if this expense should include you too.
      const splitAmount = amount / next.length;
      next = next.map(c => ({ ...c, amountOwed: Number(splitAmount.toFixed(2)) }));
    }
    setSelected(next);
  };

  const reset = () => {
    setSelected([]);
    setLoaded(false);
    setQuery('');
  };

  const handleDone = async () => {
    try {
      for (const split of selected) {
        await db.execute(
          'INSERT INTO splits (id, transaction_id, contact_id, contact_name, amount_owed) VALUES (?, ?, ?, ?, ?)',
          [`split_${Date.now()}_${Math.random().toString(36).slice(2)}`, transactionId, split.id, split.name, split.amountOwed]
        );
      }
      await db.execute('UPDATE transactions SET reviewed = 1 WHERE id = ?', [transactionId]);
    } catch (error) {
      console.error('Failed to save split:', error);
    }
    reset();
    onSaved();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }}>
            <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Split with Contacts</Text>
          <TouchableOpacity onPress={handleDone} disabled={selected.length === 0}>
            <Text style={[styles.doneText, { color: selected.length === 0 ? colors.textSecondary : colors.primary }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.search, { backgroundColor: colors.background, color: colors.text }]}
          placeholder="Search contacts"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
        />

        <FlatList
          data={filteredContacts}
          keyExtractor={item => item.recordID}
          renderItem={({ item }) => {
            const isSelected = selected.some(c => c.id === item.recordID);
            const splitContact = selected.find(c => c.id === item.recordID);
            const usedRecently = !!recency[item.recordID];

            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <TouchableOpacity style={styles.rowInfo} onPress={() => toggleContact(item)}>
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: colors.border },
                      isSelected && { backgroundColor: colors.primary, borderColor: colors.primary },
                    ]}
                  />
                  <Text style={[styles.name, { color: colors.text }]}>{nameOf(item)}</Text>
                  {usedRecently && !isSelected && (
                    <Text style={[styles.recentTag, { color: colors.textSecondary, borderColor: colors.border }]}>recent</Text>
                  )}
                </TouchableOpacity>
                {isSelected && (
                  <TextInput
                    style={[styles.amountInput, { borderBottomColor: colors.border, color: colors.text }]}
                    keyboardType="numeric"
                    value={String(splitContact?.amountOwed || '')}
                    onChangeText={val =>
                      setSelected(prev => prev.map(c => (c.id === item.recordID ? { ...c, amountOwed: Number(val) } : c)))
                    }
                  />
                )}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textSecondary }]}>No contacts found.</Text>}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  title: { fontSize: 17, fontWeight: 'bold' },
  cancelText: { fontSize: 16 },
  doneText: { fontSize: 16, fontWeight: 'bold' },
  search: { marginHorizontal: 16, marginVertical: 12, borderRadius: 10, padding: 12, fontSize: 15 },
  row: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, alignItems: 'center' },
  rowInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, marginRight: 15 },
  name: { fontSize: 16 },
  recentTag: { fontSize: 11, marginLeft: 8, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  amountInput: { width: 80, borderBottomWidth: 1, textAlign: 'right', fontSize: 16, padding: 5 },
  emptyText: { textAlign: 'center', marginTop: 40, fontSize: 15 },
});

export default SplitModal;
