import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ParseReportReason, reportParseProblem } from '../services/webSync';
import type { TransactionRow } from './TransactionDetailModal';

interface Props {
  transaction: TransactionRow;
  onCancel: () => void;
  onSent: () => void;
}

const REASONS: { id: ParseReportReason; label: string }[] = [
  { id: 'not_transaction', label: 'Not a transaction' },
  { id: 'wrong_amount', label: 'Wrong amount' },
  { id: 'wrong_merchant', label: 'Wrong merchant' },
  { id: 'wrong_type', label: 'Debit / credit swapped' },
  { id: 'other', label: 'Something else' },
];

/** Sends one message the app read wrong to the developer, shown inside the detail sheet. */
const ReportParseForm = ({ transaction, onCancel, onSent }: Props) => {
  const { colors } = useTheme();
  const [reason, setReason] = useState<ParseReportReason | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!reason || !transaction.sms_body) return;
    setSending(true);
    try {
      await reportParseProblem({
        transactionId: transaction.id,
        sender: transaction.sender,
        smsBody: transaction.sms_body,
        parsed: {
          bank: transaction.bank,
          amount: transaction.amount,
          type: transaction.type,
          merchant: transaction.merchant_raw,
          date: transaction.date,
          currency: transaction.original_currency || 'INR',
          original_amount: transaction.original_amount ?? null,
        },
        reason,
        note: note.trim() || null,
      });
      Alert.alert('Report sent', 'Thanks. This message will be used to fix how TxnTrace reads it.');
      onSent();
    } catch (e: any) {
      console.error('Failed to send parse report:', e);
      Alert.alert('Couldn’t send', e?.message || 'The report wasn’t sent. Try again.');
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>What’s wrong?</Text>
      <View style={styles.chips}>
        {REASONS.map(r => {
          const selected = reason === r.id;
          return (
            <TouchableOpacity
              key={r.id}
              style={[
                styles.chip,
                { backgroundColor: selected ? colors.primary : colors.background, borderColor: selected ? colors.primary : colors.border },
              ]}
              onPress={() => setReason(r.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>{r.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Details (optional)</Text>
      <TextInput
        style={[styles.note, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
        value={note}
        onChangeText={setNote}
        placeholder="e.g. the amount should be ₹93, not the card limit"
        placeholderTextColor={colors.textSecondary}
        maxLength={1000}
        multiline
      />

      <Text style={[styles.privacy, { color: colors.textSecondary }]}>
        Sends this message’s text and what TxnTrace read from it (amount, type, merchant, bank) to the developer, to
        fix how messages like it are read. Nothing else from your phone is sent.
      </Text>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.cancel, { borderColor: colors.border }]}
          onPress={onCancel}
          disabled={sending}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary, opacity: reason ? 1 : 0.5 }]}
          onPress={send}
          disabled={sending || !reason}
          accessibilityRole="button"
          accessibilityState={{ disabled: sending || !reason }}
        >
          {sending ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Send report</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { marginTop: 8 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: '500' },
  note: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, minHeight: 72, textAlignVertical: 'top' },
  privacy: { fontSize: 12, lineHeight: 17, marginTop: 12 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 4 },
  button: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  cancel: { borderWidth: 1 },
  buttonText: { fontSize: 15, fontWeight: '700' },
});

export default ReportParseForm;
