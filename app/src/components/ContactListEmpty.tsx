import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

const styles = StyleSheet.create({
  box: { alignItems: 'center', marginTop: 40, paddingHorizontal: 32 },
  text: { textAlign: 'center', fontSize: 15, lineHeight: 21 },
  button: { marginTop: 16, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { fontSize: 15, fontWeight: '700' },
});

export default ContactListEmpty;
