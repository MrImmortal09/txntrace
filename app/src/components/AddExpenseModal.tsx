import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Alert } from 'react-native';
import { db } from '../db/schema';
import { createSplit, applySettlement } from '../services/settlements';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  visible: boolean;
  contactId: string | null;
  contactName: string | null;
  initialMode?: 'paid' | 'received';
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Records a manual expense or debt payback for a contact with no underlying
 * SMS/statement transaction.
 * - "I paid them": Creates a debit transaction and split (offsets any credit balance or adds friend debt)
 * - "They paid me": Creates a credit transaction and applies settlement (settles open splits or creates credit balance)
 */
const AddExpenseModal = ({ visible, contactId, contactName, initialMode = 'paid', onClose, onSaved }: Props) => {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'paid' | 'received'>(initialMode);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode(initialMode);
    }
  }, [visible, initialMode]);

  const reset = () => {
    setMode('paid');
    setAmount('');
    setDescription('');
    onClose();
  };

  const save = async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      Alert.alert('Enter an amount', 'The amount must be a positive number.');
      return;
    }
    if (!contactId || !contactName) return;

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const txnId = `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      if (mode === 'received') {
        // They paid me: credit transaction + apply settlement against open debts
        const defaultDesc = `${contactName} paid`;
        await db.execute(
          `INSERT INTO transactions (id, bank, amount, type, merchant_raw, date, source, reviewed, created_at, updated_at)
           VALUES (?, NULL, ?, 'credit', ?, ?, 'manual', 1, ?, ?)`,
          [txnId, value, description.trim() || defaultDesc, now, now, now]
        );
        await applySettlement(contactId, contactName, value, txnId);
      } else {
        // I paid them: debit transaction + create split
        const defaultDesc = `Paid ${contactName}`;
        await db.execute(
          `INSERT INTO transactions (id, bank, amount, type, merchant_raw, date, source, reviewed, created_at, updated_at)
           VALUES (?, NULL, ?, 'debit', ?, ?, 'manual', 1, ?, ?)`,
          [txnId, value, description.trim() || defaultDesc, now, now, now]
        );
        await createSplit(txnId, contactId, contactName, value);
      }

      setAmount('');
      setDescription('');
      onSaved();
    } catch (error: any) {
      Alert.alert('Failed to save', error.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={reset}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={reset} />
        <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            {mode === 'paid' ? 'I paid them' : 'They paid me'}
            {contactName ? ` · ${contactName}` : ''}
          </Text>

          <View style={[styles.tabRow, { backgroundColor: colors.background }]}>
            <TouchableOpacity
              style={[styles.tab, mode === 'paid' && [styles.tabActive, { backgroundColor: colors.surface }]]}
              onPress={() => setMode('paid')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: mode === 'paid' ? colors.primary : colors.textSecondary },
                  mode === 'paid' && styles.tabTextActive,
                ]}
              >
                I paid them
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, mode === 'received' && [styles.tabActive, { backgroundColor: colors.surface }]]}
              onPress={() => setMode('received')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: mode === 'received' ? colors.primary : colors.textSecondary },
                  mode === 'received' && styles.tabTextActive,
                ]}
              >
                They paid me
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {mode === 'paid' ? 'Amount you paid (₹)' : 'Amount they paid you (₹)'}
          </Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
            ]}
            placeholder="0.00"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            autoFocus
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>What for (optional)</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
            ]}
            placeholder={mode === 'paid' ? 'e.g. Dinner, Movie tickets, Cab' : 'e.g. Cash, GPay payback'}
            placeholderTextColor={colors.textSecondary}
            value={description}
            onChangeText={setDescription}
          />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={reset}>
              <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={save}
              disabled={saving}
            >
              <Text style={styles.saveText}>
                {saving ? 'Saving…' : mode === 'paid' ? 'Save Expense' : 'Record Payment'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
  title: { fontSize: 17, fontWeight: 'bold', marginBottom: 14 },
  tabRow: { flexDirection: 'row', borderRadius: 10, padding: 3, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { elevation: 1, shadowOpacity: 0.1, shadowOffset: { width: 0, height: 1 } },
  tabText: { fontSize: 13, fontWeight: '600' },
  tabTextActive: { fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 16, marginBottom: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 },
  cancelButton: { paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { fontSize: 15, fontWeight: '600' },
  saveButton: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  saveText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});

export default AddExpenseModal;
