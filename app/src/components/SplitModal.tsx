import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Modal, Alert, SafeAreaView } from 'react-native';
import Contacts from 'react-native-contacts';
import { db } from '../db/schema';

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
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<SplitContact[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  if (visible && !loaded) {
    loadContacts();
  }

  const toggleContact = (contact: any) => {
    const exists = selected.find(c => c.id === contact.recordID);
    let next: SplitContact[];
    if (exists) {
      next = selected.filter(c => c.id !== contact.recordID);
    } else {
      const name = contact.displayName || `${contact.givenName} ${contact.familyName}`.trim();
      next = [...selected, { id: contact.recordID, name, amountOwed: 0 }];
    }
    if (next.length > 0) {
      const splitAmount = amount / (next.length + 1); // +1 for "me"
      next = next.map(c => ({ ...c, amountOwed: Number(splitAmount.toFixed(2)) }));
    }
    setSelected(next);
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
    setSelected([]);
    setLoaded(false);
    onSaved();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setSelected([]); setLoaded(false); onClose(); }}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Split with Contacts</Text>
          <TouchableOpacity onPress={handleDone} disabled={selected.length === 0}>
            <Text style={[styles.doneText, selected.length === 0 && styles.doneTextDisabled]}>Done</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={contacts}
          keyExtractor={item => item.recordID}
          renderItem={({ item }) => {
            const isSelected = selected.some(c => c.id === item.recordID);
            const splitContact = selected.find(c => c.id === item.recordID);
            const name = item.displayName || `${item.givenName} ${item.familyName}`.trim();

            return (
              <View style={styles.row}>
                <TouchableOpacity style={styles.rowInfo} onPress={() => toggleContact(item)}>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]} />
                  <Text style={styles.name}>{name}</Text>
                </TouchableOpacity>
                {isSelected && (
                  <TextInput
                    style={styles.amountInput}
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
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 17, fontWeight: 'bold' },
  cancelText: { fontSize: 16, color: '#8e8e93' },
  doneText: { fontSize: 16, color: '#007AFF', fontWeight: 'bold' },
  doneTextDisabled: { color: '#c7c7cc' },
  row: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'center' },
  rowInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#ccc', marginRight: 15 },
  checkboxSelected: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  name: { fontSize: 16 },
  amountInput: { width: 80, borderBottomWidth: 1, borderBottomColor: '#ccc', textAlign: 'right', fontSize: 16, padding: 5 },
});

export default SplitModal;
