import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, Alert, SafeAreaView, TextInput } from 'react-native';
import Contacts from 'react-native-contacts';

export interface PickedContact {
  id: string;
  name: string;
}

interface Props {
  visible: boolean;
  title: string;
  onCancel: () => void;
  onSelect: (contact: PickedContact) => void;
}

const ContactPickerModal = ({ visible, title, onCancel, onSelect }: Props) => {
  const [contacts, setContacts] = useState<any[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) loadContacts();
  }, [visible]);

  const loadContacts = async () => {
    try {
      const permission = await Contacts.requestPermission();
      if (permission === 'authorized') {
        setContacts(await Contacts.getAll());
      } else {
        Alert.alert('Permission Denied', 'Please allow contacts access in Settings.');
      }
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  };

  const nameOf = (c: any) => c.displayName || `${c.givenName} ${c.familyName}`.trim();
  const filtered = query
    ? contacts.filter(c => nameOf(c).toLowerCase().includes(query.toLowerCase()))
    : contacts;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search contacts"
          value={query}
          onChangeText={setQuery}
        />

        <FlatList
          data={filtered}
          keyExtractor={item => item.recordID}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onSelect({ id: item.recordID, name: nameOf(item) })}
            >
              <Text style={styles.rowText}>{nameOf(item)}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No contacts found.</Text>}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 18, fontWeight: 'bold' },
  cancelText: { fontSize: 16, color: '#007AFF' },
  search: { margin: 16, backgroundColor: '#f2f2f2', borderRadius: 10, padding: 12, fontSize: 15 },
  row: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  rowText: { fontSize: 16, color: '#333' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 40 },
});

export default ContactPickerModal;
