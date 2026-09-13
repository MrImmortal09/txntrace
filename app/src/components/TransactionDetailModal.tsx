import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Clipboard,
  ToastAndroid,
  Platform,
  Animated,
} from 'react-native';
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

const DETAIL_FIELDS: [keyof TransactionRow, string][] = [
  ['reference', 'Reference'],
  ['account_last4', 'Account'],
  ['bank', 'Bank'],
  ['type', 'Type'],
  ['category', 'Category'],
  ['note', 'Note'],
  ['balance', 'Balance'],
  ['sender', 'Sender'],
  ['source', 'Source'],
];

const TransactionDetailModal = ({ transaction, onClose }: Props) => {
  const { colors } = useTheme();
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  if (!transaction) return null;

  const handleCopy = (text: string | null | undefined, label: string) => {
    if (!text) return;
    const cleanText = String(text).trim();
    if (!cleanText) return;

    Clipboard.setString(cleanText);

    if (Platform.OS === 'android') {
      ToastAndroid.show(`Copied ${label} to clipboard`, ToastAndroid.SHORT);
    }

    setCopiedLabel(label);

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();

    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setCopiedLabel(null);
      });
    }, 2000);
  };

  const formattedDate = (() => {
    if (!transaction.date) return '';
    try {
      const cleanDate = transaction.date.includes(' ') && !transaction.date.includes('T')
        ? transaction.date.replace(' ', 'T')
        : transaction.date;
      const d = new Date(cleanDate);
      if (isNaN(d.getTime())) return transaction.date;
      return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return transaction.date;
    }
  })();

  return (
    <Modal visible={!!transaction} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          {/* Header with Merchant Name */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.headerTitleWrap}
              activeOpacity={0.8}
              onLongPress={() => handleCopy(transaction.merchant_raw || 'Unknown', 'Merchant')}
              accessibilityRole="button"
              accessibilityLabel={`Merchant: ${transaction.merchant_raw || 'Unknown'}. Hold to copy.`}
            >
              <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={2} selectable>
                {transaction.merchant_raw || 'Unknown'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.closeButton, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Amount (Hold to copy) */}
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={() => handleCopy(transaction.amount.toFixed(2), 'Amount')}
            accessibilityRole="button"
            accessibilityLabel={`Amount: ₹${transaction.amount.toFixed(2)}. Hold to copy.`}
          >
            <Text
              style={[styles.amount, { color: transaction.type === 'credit' ? colors.success : colors.danger }]}
              selectable
            >
              {transaction.type === 'credit' ? '+' : '-'}₹{transaction.amount.toFixed(2)}
            </Text>
          </TouchableOpacity>

          {/* Date (Hold to copy) */}
          {formattedDate ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onLongPress={() => handleCopy(formattedDate, 'Date')}
              accessibilityRole="button"
              accessibilityLabel={`Date: ${formattedDate}. Hold to copy.`}
            >
              <Text style={[styles.date, { color: colors.textSecondary }]} selectable>
                {formattedDate}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Location */}
          {transaction.location ? (
            <TouchableOpacity
              style={[styles.locationCard, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => openLocationInGoogleMaps(transaction.location, transaction.latitude, transaction.longitude)}
              onLongPress={() => handleCopy(transaction.location, 'Location')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Location: ${transaction.location}. Hold to copy or tap to open in Maps.`}
            >
              <Text style={[styles.locationCardText, { color: colors.primary }]} selectable>
                📍 {transaction.location} <Text style={styles.mapsLink}>(Open in Google Maps ↗)</Text>
              </Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView style={styles.fieldsScroll} showsVerticalScrollIndicator={false}>
            {/* Specially Highlighted: Received Message Content (Hold to copy) */}
            {transaction.sms_body ? (
              <TouchableOpacity
                style={[styles.messageCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                activeOpacity={0.8}
                onLongPress={() => handleCopy(transaction.sms_body, 'Message')}
                onPress={() => handleCopy(transaction.sms_body, 'Message')}
                accessibilityRole="button"
                accessibilityLabel="Received SMS Message content. Hold to copy."
              >
                <View style={styles.messageHeaderRow}>
                  <Text style={[styles.messageCardLabel, { color: colors.textSecondary }]}>
                    Received SMS Message
                  </Text>
                  <View style={[styles.copyBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.copyBadgeText, { color: colors.primary }]}>📋 Hold to copy</Text>
                  </View>
                </View>
                <Text style={[styles.messageCardBody, { color: colors.text }]} selectable>
                  {transaction.sms_body}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Other Transaction Details (Hold to copy any row) */}
            {DETAIL_FIELDS.map(([key, label]) => {
              const value = transaction[key];
              if (value === null || value === undefined || value === '') return null;
              const strVal = String(value);

              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.fieldRow, { borderBottomColor: colors.border }]}
                  activeOpacity={0.7}
                  onLongPress={() => handleCopy(strVal, label)}
                  onPress={() => handleCopy(strVal, label)}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}: ${strVal}. Hold to copy.`}
                >
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]} selectable>
                    {label}
                  </Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]} selectable numberOfLines={3}>
                    {strVal}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <Text style={[styles.copyTip, { color: colors.textSecondary }]}>
              💡 Hold any text or message to copy to clipboard
            </Text>
          </ScrollView>

          {/* Floating Toast Notification on Copy */}
          {copiedLabel && (
            <Animated.View
              style={[
                styles.toastBadge,
                {
                  backgroundColor: colors.text,
                  opacity: toastOpacity,
                },
              ]}
              pointerEvents="none"
            >
              <Text style={[styles.toastText, { color: colors.background }]}>
                {`✓ Copied ${copiedLabel} to clipboard`}
              </Text>
            </Animated.View>
          )}
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
    maxHeight: '82%',
    borderRadius: 20,
    padding: 20,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
    position: 'relative',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerTitleWrap: { flex: 1, marginRight: 12 },
  merchant: { fontSize: 20, fontWeight: 'bold' },
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
  fieldsScroll: { marginBottom: 8 },

  // Message Card
  messageCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    marginTop: 4,
  },
  messageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  messageCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  copyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  copyBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  messageCardBody: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },

  // Field Rows
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  fieldLabel: { fontSize: 14 },
  fieldValue: { fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right', marginLeft: 20 },

  copyTip: {
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 14,
    fontStyle: 'italic',
  },

  // Floating Toast
  toastBadge: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    zIndex: 999,
  },
  toastText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

export default TransactionDetailModal;

