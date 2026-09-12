import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { openLocationInGoogleMaps } from '../utils/maps';

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
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  const { colors } = useTheme();
  if (!transaction) return null;

  return (
    <Modal visible={!!transaction} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <View style={styles.header}>
            <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={2}>{transaction.merchant_raw || 'Unknown'}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.closeButton, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.amount, { color: transaction.type === 'credit' ? colors.success : colors.danger }]}>
            {transaction.type === 'credit' ? '+' : '-'}₹{transaction.amount.toFixed(2)}
          </Text>
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {(() => {
              if (!transaction.date) return '';
              try {
                const d = new Date(transaction.date);
                if (isNaN(d.getTime())) return transaction.date;
                return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
              } catch {
                return transaction.date;
              }
            })()}
          </Text>

          {transaction.location ? (
            <TouchableOpacity
              style={[styles.locationCard, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => openLocationInGoogleMaps(transaction.location, transaction.latitude, transaction.longitude)}
              activeOpacity={0.7}
            >
              <Text style={[styles.locationCardText, { color: colors.primary }]}>
                📍 {transaction.location} <Text style={styles.mapsLink}>(Open in Google Maps ↗)</Text>
              </Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView style={styles.fieldsScroll}>
            {FIELD_LABELS.map(([key, label]) => {
              const value = transaction[key];
              if (value === null || value === undefined || value === '') return null;
              return (
                <View key={key} style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>{String(value)}</Text>
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
    borderRadius: 20,
    padding: 20,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  merchant: { fontSize: 20, fontWeight: 'bold', flex: 1, marginRight: 12 },
  closeButton: { fontSize: 18, padding: 4 },
  amount: { fontSize: 32, fontWeight: 'bold', marginTop: 12 },
  date: { fontSize: 14, marginTop: 4, marginBottom: 12 },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
  locationCardText: {
    fontSize: 13,
    fontWeight: '600',
  },
  mapsLink: {
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  fieldsScroll: { marginBottom: 20 },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  fieldLabel: { fontSize: 14 },
  fieldValue: { fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right', marginLeft: 20 },
});

export default TransactionDetailModal;
