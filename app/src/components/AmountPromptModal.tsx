import React, { useEffect, useState } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  label: string;
  initialValue?: number | null;
  submitLabel?: string;
  /** Shows a "Clear" action that submits null (e.g. drop a manual override). */
  clearLabel?: string;
  /** If set, tapping Clear asks for confirmation with this message first (e.g. when clearing deletes logged data rather than just reverting to an estimate). */
  confirmClear?: string;
  /** null only ever arrives via the Clear button (only shown when clearLabel is set) — Save always sends a valid number. */
  onSubmit: (value: number | null) => void;
  onClose: () => void;
}

/** A one-number prompt — Alert.prompt is iOS-only, and this app ships on Android too. */
const AmountPromptModal = ({
  visible,
  title,
  message,
  label,
  initialValue,
  submitLabel = 'Save',
  clearLabel,
  confirmClear,
  onSubmit,
  onClose,
}: Props) => {
  const { colors } = useTheme();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) setValue(initialValue !== null && initialValue !== undefined ? String(Math.round(initialValue * 100) / 100) : '');
  }, [visible, initialValue]);

  const parsed = parseFloat(value.replace(/,/g, ''));
  const valid = !isNaN(parsed) && parsed >= 0;

  const handleClear = () => {
    if (!confirmClear) return onSubmit(null);
    Alert.alert(clearLabel || 'Clear', confirmClear, [
      { text: 'Cancel', style: 'cancel' },
      { text: clearLabel || 'Clear', style: 'destructive', onPress: () => onSubmit(null) },
    ]);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text> : null}

          <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
            value={value}
            onChangeText={setValue}
            autoFocus
          />

          <View style={styles.actions}>
            {clearLabel ? (
              <TouchableOpacity style={[styles.textButton, styles.clearButton]} onPress={handleClear}>
                <Text style={[styles.textButtonLabel, { color: colors.danger }]}>{clearLabel}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.textButton} onPress={onClose}>
              <Text style={[styles.textButtonLabel, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary, opacity: valid ? 1 : 0.5 }]}
              onPress={() => valid && onSubmit(parsed)}
              disabled={!valid}
            >
              <Text style={styles.saveText}>{submitLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 20,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
  },
  title: { fontSize: 17, fontWeight: 'bold', marginBottom: 8 },
  message: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 16, marginBottom: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  textButton: { paddingVertical: 10, paddingHorizontal: 10 },
  clearButton: { marginRight: 'auto' },
  textButtonLabel: { fontSize: 15, fontWeight: '600' },
  saveButton: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  saveText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});

export default AmountPromptModal;
