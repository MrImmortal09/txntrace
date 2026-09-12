import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { editSplitAmount, deleteSplit, editSettlementAmount, deleteSettlement } from '../services/settlements';
import { openLocationInGoogleMaps } from '../utils/maps';

export interface EditableLedgerEntry {
  kind: 'split' | 'settlement';
  id: string;
  transactionId?: string | null;
  date: string;
  amount: number;
  amountOwed?: number;
  unappliedAmount?: number;
  merchant: string | null;
  settled: boolean;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface Props {
  visible: boolean;
  entry: EditableLedgerEntry | null;
  contactName: string;
  onClose: () => void;
  onSaved: () => void;
  onViewTransaction?: (transactionId: string) => void;
}

export const EditDebtModal = ({
  visible,
  entry,
  contactName,
  onClose,
  onSaved,
  onViewTransaction,
}: Props) => {
  const { colors } = useTheme();
  const [owedInput, setOwedInput] = useState('');
  const [totalInput, setTotalInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry) {
      if (entry.kind === 'split') {
        setOwedInput(String(entry.amountOwed ?? entry.amount ?? ''));
        setTotalInput(String(entry.amount ?? ''));
      } else {
        setOwedInput(String(entry.amount ?? ''));
        setTotalInput(String(entry.unappliedAmount ?? 0));
      }
    }
  }, [entry]);

  if (!entry) return null;

  const handleSave = async () => {
    const val1 = parseFloat(owedInput);
    if (isNaN(val1) || val1 < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid positive amount.');
      return;
    }

    if (entry.kind === 'split') {
      const totalVal = parseFloat(totalInput);
      if (!isNaN(totalVal) && totalVal < val1) {
        Alert.alert('Invalid Amount', 'Original expense amount cannot be less than the amount owed.');
        return;
      }
      setSaving(true);
      try {
        const validTotal = !isNaN(totalVal) && totalVal >= val1 ? totalVal : undefined;
        await editSplitAmount(entry.id, val1, validTotal);
        onSaved();
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to update debt amount.');
      } finally {
        setSaving(false);
      }
    } else {
      const unappliedVal = parseFloat(totalInput);
      if (!isNaN(unappliedVal) && unappliedVal > val1) {
        Alert.alert('Invalid Amount', 'Excess amount owed cannot exceed the total payment amount.');
        return;
      }
      setSaving(true);
      try {
        const validUnapplied = !isNaN(unappliedVal) && unappliedVal >= 0 ? unappliedVal : undefined;
        await editSettlementAmount(entry.id, val1, validUnapplied);
        onSaved();
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to update payment amount.');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Remove Entry',
      `Are you sure you want to remove this ${entry.kind === 'split' ? 'debt' : 'payment'}? This will permanently delete it from the ledger.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              if (entry.kind === 'split') {
                await deleteSplit(entry.id);
              } else {
                await deleteSettlement(entry.id);
              }
              onSaved();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to remove entry.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const formattedDateTime = (() => {
    if (!entry.date) return '';
    try {
      const d = new Date(entry.date);
      if (isNaN(d.getTime())) return entry.date;
      return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return entry.date;
    }
  })();

  const isSplit = entry.kind === 'split';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {isSplit ? 'Edit Split / Debt' : 'Edit Payment'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.closeButton, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollBody} keyboardShouldPersistTaps="handled">
            <View style={[styles.infoBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.merchantName, { color: colors.text }]}>
                {isSplit
                  ? entry.merchant?.toLowerCase().startsWith('paid back')
                    ? `You paid back ${contactName}`
                    : `You paid for ${entry.merchant || 'Shared Expense'}`
                  : `${contactName} paid you`}
              </Text>
              <Text style={[styles.dateTimeText, { color: colors.textSecondary }]}>
                🕒 {formattedDateTime}
              </Text>

              {entry.location ? (
                <TouchableOpacity
                  style={styles.locationContainer}
                  onPress={() => openLocationInGoogleMaps(entry.location, entry.latitude, entry.longitude)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.locationText, { color: colors.primary }]}>
                    📍 {entry.location} <Text style={styles.mapsLink}>(Open Maps ↗)</Text>
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.fieldSection}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {isSplit ? 'Amount Owed by Friend (₹)' : 'Payment Amount (₹)'}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
                ]}
                keyboardType="decimal-pad"
                value={owedInput}
                onChangeText={setOwedInput}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
              />
              {isSplit ? (
                <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                  Set to 0 to mark this debt as settled.
                </Text>
              ) : null}
            </View>

            <View style={styles.fieldSection}>
              <Text style={[styles.fieldLabel, { color: colors.text }]}>
                {isSplit ? 'Original Expense Amount (₹)' : 'Excess Owed to Friend (₹)'}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
                ]}
                keyboardType="decimal-pad"
                value={totalInput}
                onChangeText={setTotalInput}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.actionBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
            </TouchableOpacity>

            {entry.transactionId && onViewTransaction ? (
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
                onPress={() => {
                  const txnId = entry.transactionId!;
                  onClose();
                  setTimeout(() => {
                    onViewTransaction(txnId);
                  }, 150);
                }}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
                  View Original Transaction
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: colors.danger }]}
              onPress={handleDelete}
              disabled={saving}
            >
              <Text style={[styles.deleteBtnText, { color: colors.danger }]}>
                Remove this {isSplit ? 'Debt' : 'Entry'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: 20,
    padding: 20,
    elevation: 8,
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700' },
  closeButton: { fontSize: 20, fontWeight: '600', padding: 4 },
  scrollBody: { maxHeight: '90%' },
  infoBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  merchantName: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  dateTimeText: { fontSize: 13, marginTop: 4 },
  locationContainer: { marginTop: 8 },
  locationText: { fontSize: 13, fontWeight: '500' },
  mapsLink: { fontSize: 12, textDecorationLine: 'underline' },
  fieldSection: { marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  fieldHint: { fontSize: 12, marginTop: 4 },
  actionBtn: {
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  deleteBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  deleteBtnText: { fontSize: 14, fontWeight: '600' },
});

export default EditDebtModal;
