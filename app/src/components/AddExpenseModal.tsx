import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, Alert } from 'react-native';
import { db } from '../db/schema';

interface Props {
  visible: boolean;
  contactId: string | null;
  contactName: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Records a manual expense for a contact with no underlying SMS/statement
 * transaction — e.g. cash lent, or a friend with no prior history at all
 * (FriendsScreen's own list only shows contacts who already have a split,
 * settlement, or alias, so this is also the only way to start a ledger with
 * someone brand new). Still creates a transactions row (source: 'manual',
 * already anticipated in the schema's own comment) rather than making
 * splits.transaction_id optional, so it stays indistinguishable from a real
 * transaction everywhere else that joins the two — the ledger, the owed
 * total, tapping through to see details.
 */
const AddExpenseModal = ({ visible, contactId, contactName, onClose, onSaved }: Props) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
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
      await db.execute(
        `INSERT INTO transactions (id, bank, amount, type, merchant_raw, date, source, reviewed, created_at, updated_at)
         VALUES (?, NULL, ?, 'debit', ?, ?, 'manual', 1, ?, ?)`,
        [txnId, value, description.trim() || 'Manual expense', now, now, now]
      );
      await db.execute(
        'INSERT INTO splits (id, transaction_id, contact_id, contact_name, amount_owed) VALUES (?, ?, ?, ?, ?)',
        [`split_${Date.now()}_${Math.random().toString(36).slice(2)}`, txnId, contactId, contactName, value]
      );
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
        <View style={styles.card}>
          <Text style={styles.title}>Add expense{contactName ? ` for ${contactName}` : ''}</Text>

          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            autoFocus
          />

          <Text style={styles.label}>What for (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Movie tickets"
            value={description}
            onChangeText={setDescription}
          />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={reset}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={save} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
  },
  title: { fontSize: 17, fontWeight: 'bold', color: '#333', marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#999', marginBottom: 6 },
  input: { backgroundColor: '#f2f2f2', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
  cancelButton: { paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { fontSize: 15, color: '#999', fontWeight: '600' },
  saveButton: { backgroundColor: '#007AFF', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  saveText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});

export default AddExpenseModal;
