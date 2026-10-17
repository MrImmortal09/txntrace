import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, SafeAreaView, TextInput } from 'react-native';
import { contactName, useDeviceContacts } from '../services/deviceContacts';
import { useTheme } from '../theme/ThemeProvider';
import ContactListEmpty from './ContactListEmpty';

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
  const { colors } = useTheme();
  const { contacts, allowed, retry } = useDeviceContacts(visible);
  const [query, setQuery] = useState('');

  const filtered = query
    ? contacts.filter(c => contactName(c).toLowerCase().includes(query.toLowerCase()))
    : contacts;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={[styles.cancelText, { color: colors.primary }]}>Cancel</Text>
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
          data={filtered}
          keyExtractor={item => item.recordID}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() => onSelect({ id: item.recordID, name: contactName(item) })}
            >
              <Text style={[styles.rowText, { color: colors.text }]}>{contactName(item)}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<ContactListEmpty allowed={allowed} onAllow={retry} />}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  title: { flex: 1, fontSize: 18, fontWeight: 'bold', marginRight: 12 },
  cancelText: { fontSize: 16 },
  search: { margin: 16, borderRadius: 10, padding: 12, fontSize: 15 },
  row: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1 },
  rowText: { fontSize: 16 },
});

export default ContactPickerModal;
