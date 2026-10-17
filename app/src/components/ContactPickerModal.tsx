import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, SafeAreaView, TextInput } from 'react-native';
import Contacts from 'react-native-contacts';
import { requestContactsAccess } from '../services/permissions';
import { useTheme } from '../theme/ThemeProvider';

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
  const [contacts, setContacts] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  // null until asked, so the list doesn't flash "access is off" while asking.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (visible) loadContacts();
  }, [visible]);

  const loadContacts = async () => {
    try {
      const granted = await requestContactsAccess();
      setAllowed(granted);
      if (granted) setContacts(await Contacts.getAll());
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  };

  const nameOf = (c: any) => c.displayName || `${c.givenName} ${c.familyName}`.trim();
  const filtered = query
    ? contacts.filter(c => nameOf(c).toLowerCase().includes(query.toLowerCase()))
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
              onPress={() => onSelect({ id: item.recordID, name: nameOf(item) })}
            >
              <Text style={[styles.rowText, { color: colors.text }]}>{nameOf(item)}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            allowed === false ? (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  Contacts access is off, so there’s no one to pick from yet.
                </Text>
                <TouchableOpacity
                  style={[styles.allowButton, { backgroundColor: colors.primary }]}
                  onPress={loadContacts}
                  accessibilityRole="button"
                >
                  <Text style={[styles.allowButtonText, { color: colors.onPrimary }]}>Allow contacts</Text>
                </TouchableOpacity>
              </View>
            ) : allowed ? (
              <Text style={[styles.emptyText, styles.empty, { color: colors.textSecondary }]}>No contacts found.</Text>
            ) : undefined
          }
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
  empty: { alignItems: 'center', marginTop: 40, paddingHorizontal: 32 },
  emptyText: { textAlign: 'center', fontSize: 15, lineHeight: 21 },
  allowButton: { marginTop: 16, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  allowButtonText: { fontSize: 15, fontWeight: '700' },
});

export default ContactPickerModal;
