import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  /** From useDeviceContacts: null while access is being asked for. */
  allowed: boolean | null;
  onAllow: () => void;
}

/**
 * What an empty contact list shows: nothing while access is being asked for,
 * a way to allow it if it was refused, and otherwise that nothing matched.
 */
const ContactListEmpty = ({ allowed, onAllow }: Props) => {
  const { colors } = useTheme();
  if (allowed === null) return null;
  if (allowed) {
    return <Text style={[styles.text, styles.box, { color: colors.textSecondary }]}>No contacts found.</Text>;
  }
  return (
    <View style={styles.box}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        Contacts access is off, so there’s no one to pick from yet.
      </Text>
      <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={onAllow} accessibilityRole="button">
        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Allow contacts</Text>
      </TouchableOpacity>
    </View>
  );
};

/**
 * Shown above the list when iOS shares only some contacts ("Limited Access").
 * The app can't widen that itself, so it says where to.
 */
export const LimitedContactsNote = ({ limited }: { limited: boolean }) => {
  const { colors } = useTheme();
  if (!limited) return null;
  return (
    <View style={[styles.note, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.noteText, { color: colors.textSecondary }]}>
        TxnTrace can only see the contacts you chose to share. To add more, open Settings, tap Contacts, then
        Edit Selected Contacts, or choose Full Access.
      </Text>
      <TouchableOpacity onPress={() => Linking.openSettings()} accessibilityRole="button">
        <Text style={[styles.noteLink, { color: colors.primary }]}>Open Settings</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: 10, padding: 12, margin: 12 },
  noteText: { fontSize: 13, lineHeight: 18 },
  noteLink: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  box: { alignItems: 'center', marginTop: 40, paddingHorizontal: 32 },
  text: { textAlign: 'center', fontSize: 15, lineHeight: 21 },
  button: { marginTop: 16, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { fontSize: 15, fontWeight: '700' },
});

export default ContactListEmpty;
