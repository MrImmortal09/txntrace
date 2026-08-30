import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';

export interface TransactionRow {
  id: string;
  bank: string | null;
  amount: number;
  type: 'debit' | 'credit';
  merchant_raw: string | null;
  date: string;
  source: string | null;
  category: string | null;
  note: string | null;
  reference: string | null;
  account_last4: string | null;
  balance: number | null;
  sender: string | null;
  sms_body: string | null;
  card_id: string | null;
}

interface Props {
  transaction: TransactionRow | null;
  onClose: () => void;
}

const FIELD_LABELS: [keyof TransactionRow, string][] = [
  ['bank', 'Bank'],
  ['type', 'Type'],
  ['category', 'Category'],
  ['note', 'Note'],
  ['source', 'Source'],
  ['reference', 'Reference'],
  ['account_last4', 'Account'],
  ['balance', 'Balance'],
  ['sender', 'Sender'],
  ['sms_body', 'Message'],
];

const TransactionDetailModal = ({ transaction, onClose }: Props) => {
  if (!transaction) return null;

  return (
    <Modal visible={!!transaction} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.merchant} numberOfLines={2}>{transaction.merchant_raw || 'Unknown'}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.amount, transaction.type === 'credit' ? styles.credit : styles.debit]}>
            {transaction.type === 'credit' ? '+' : '-'}₹{transaction.amount.toFixed(2)}
          </Text>
          <Text style={styles.date}>
            {new Date(transaction.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>

          <ScrollView style={styles.fieldsScroll}>
            {FIELD_LABELS.map(([key, label]) => {
              const value = transaction[key];
              if (value === null || value === undefined || value === '') return null;
              return (
                <View key={key} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <Text style={styles.fieldValue}>{String(value)}</Text>
                </View>
              );
            })}
          </ScrollView>
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
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  merchant: { fontSize: 20, fontWeight: 'bold', color: '#333', flex: 1, marginRight: 12 },
  closeButton: { fontSize: 18, color: '#999', padding: 4 },
  amount: { fontSize: 32, fontWeight: 'bold', marginTop: 12 },
  debit: { color: '#FF3B30' },
  credit: { color: '#34C759' },
  date: { fontSize: 14, color: '#999', marginTop: 4, marginBottom: 16 },
  fieldsScroll: { marginBottom: 20 },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  fieldLabel: { fontSize: 14, color: '#999' },
  fieldValue: { fontSize: 14, color: '#333', fontWeight: '500', flex: 1, textAlign: 'right', marginLeft: 20 },
});

export default TransactionDetailModal;
