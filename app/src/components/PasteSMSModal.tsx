import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import BankIcon from './BankIcon';
import { previewParsedSMS, ingestManualSMS } from '../parsers/sms';
import { BANKS } from '../constants/banks';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PasteSMSModal = ({ visible, onClose, onSuccess }: Props) => {
  const { colors, isDark } = useTheme();
  const [message, setMessage] = useState('');
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [customSender, setCustomSender] = useState('');
  const [showSenderInput, setShowSenderInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMessage('');
    setSelectedBank(null);
    setCustomSender('');
    setShowSenderInput(false);
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const preview = useMemo(() => {
    if (!message.trim()) return null;
    return previewParsedSMS(
      message,
      customSender.trim() || undefined,
      selectedBank || undefined
    );
  }, [message, customSender, selectedBank]);

  const handleSave = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      Alert.alert('Empty Message', 'Please paste or type an SMS message to parse.');
      return;
    }

    if (!preview?.parsed) {
      Alert.alert(
        'Cannot Parse Message',
        'Could not detect an amount (e.g. Rs 500) and debit/credit status in this text. Please check the message and try again.'
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await ingestManualSMS({
        body: trimmed,
        sender: customSender.trim() || undefined,
        bank: selectedBank || undefined,
      });

      if (!result.success) {
        setError(result.error || 'Failed to parse SMS message.');
        setSubmitting(false);
        return;
      }

      if (result.duplicate) {
        Alert.alert(
          'Already Recorded',
          'This transaction was already added to TxnTrace previously.',
          [{ text: 'OK', onPress: () => { reset(); onSuccess(); } }]
        );
      } else {
        reset();
        onSuccess();
      }
    } catch (e: any) {
      setError(e?.message || 'Something went wrong while saving.');
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={reset}>
      <KeyboardAvoidingView
        style={styles.avoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={reset} />

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text style={[styles.title, { color: colors.text }]}>Add Transaction SMS</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Paste your bank message here to add it to review
              </Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={reset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.textSecondary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <Line x1="18" y1="6" x2="6" y2="18" />
                <Line x1="6" y1="6" x2="18" y2="18" />
              </Svg>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Text Input */}
            <View style={styles.inputWrapper}>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    color: colors.text,
                    backgroundColor: isDark ? '#111827' : '#F9FAFB',
                    borderColor: colors.border,
                  },
                ]}
                placeholder="Paste bank SMS here...&#10;&#10;e.g. Sent Rs.500.00 from ICICI Bank A/c XX1234 to Swiggy on 08-Sep-26 UPI:123456"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={4}
                value={message}
                onChangeText={t => {
                  setMessage(t);
                  if (error) setError(null);
                }}
                autoFocus
                textAlignVertical="top"
              />
              {message.length > 0 && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => setMessage('')}
                >
                  <Text style={[styles.clearText, { color: colors.textSecondary }]}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Bank Override Chips */}
            <View style={styles.chipsSection}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                Bank routing:
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
                <TouchableOpacity
                  style={[
                    styles.chip,
                    selectedBank === null
                      ? [styles.chipActive, { backgroundColor: colors.primary }]
                      : [styles.chipInactive, { borderColor: colors.border, backgroundColor: isDark ? '#1F2937' : '#FFFFFF' }],
                  ]}
                  onPress={() => setSelectedBank(null)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: selectedBank === null ? '#FFFFFF' : colors.textSecondary },
                    ]}
                  >
                    Auto
                  </Text>
                </TouchableOpacity>

                {BANKS.map(b => {
                  const isSelected = selectedBank === b.name;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[
                        styles.chip,
                        isSelected
                          ? [styles.chipActive, { backgroundColor: colors.primary }]
                          : [styles.chipInactive, { borderColor: colors.border, backgroundColor: isDark ? '#1F2937' : '#FFFFFF' }],
                      ]}
                      onPress={() => setSelectedBank(isSelected ? null : b.name)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: isSelected ? '#FFFFFF' : colors.text },
                        ]}
                      >
                        {b.name.replace(' Bank', '').replace('State Bank of India', 'SBI')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Optional Sender toggle */}
            {!showSenderInput ? (
              <TouchableOpacity
                style={styles.senderToggle}
                onPress={() => setShowSenderInput(true)}
              >
                <Text style={[styles.senderToggleText, { color: colors.primary }]}>
                  + Add sender ID manually (optional)
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.senderInputContainer}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  Sender ID (optional):
                </Text>
                <TextInput
                  style={[
                    styles.senderInput,
                    {
                      color: colors.text,
                      backgroundColor: isDark ? '#111827' : '#F9FAFB',
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="e.g. VM-HDFCBK or ICICIB"
                  placeholderTextColor={colors.textSecondary}
                  value={customSender}
                  onChangeText={setCustomSender}
                  autoCapitalize="characters"
                />
              </View>
            )}

            {/* Error Message */}
            {error && (
              <View style={[styles.errorBox, { backgroundColor: isDark ? '#451A1A' : '#FEF2F2', borderColor: colors.danger }]}>
                <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
              </View>
            )}

            {/* Real-time Parse Preview Card */}
            {message.trim().length > 0 && (
              <View style={styles.previewSection}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                  Parsed Preview
                </Text>

                {preview?.parsed ? (
                  <View
                    style={[
                      styles.previewCard,
                      {
                        backgroundColor: isDark ? '#1F2937' : '#F0FDF4',
                        borderColor: isDark ? '#374151' : '#BBF7D0',
                      },
                    ]}
                  >
                    <View style={styles.previewRow}>
                      <BankIcon bank={preview.parsed.bank} size={36} />
                      <View style={styles.previewDetails}>
                        <Text style={[styles.previewMerchant, { color: colors.text }]} numberOfLines={1}>
                          {preview.parsed.merchant || 'Unknown Merchant'}
                        </Text>
                        <Text style={[styles.previewMeta, { color: colors.textSecondary }]}>
                          {preview.parsed.bank}
                          {preview.reference ? ` · Ref ${preview.reference}` : ''}
                        </Text>
                      </View>
                      <View style={styles.previewAmountContainer}>
                        <Text
                          style={[
                            styles.previewAmount,
                            { color: preview.parsed.type === 'credit' ? colors.success : colors.danger },
                          ]}
                        >
                          {preview.parsed.type === 'credit' ? '+' : '-'}₹{preview.parsed.amount.toFixed(2)}
                        </Text>
                        <View
                          style={[
                            styles.typeBadge,
                            {
                              backgroundColor:
                                preview.parsed.type === 'credit'
                                  ? isDark ? '#065F46' : '#DCFCE7'
                                  : isDark ? '#7F1D1D' : '#FEE2E2',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.typeBadgeText,
                              {
                                color: preview.parsed.type === 'credit' ? colors.success : colors.danger,
                              },
                            ]}
                          >
                            {preview.parsed.type.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.unparsedCard,
                      {
                        backgroundColor: isDark ? '#1F2937' : '#FFFBEB',
                        borderColor: isDark ? '#374151' : '#FDE68A',
                      },
                    ]}
                  >
                    <Text style={[styles.unparsedText, { color: isDark ? '#FBBF24' : '#D97706' }]}>
                      ⚠️ Could not parse transaction details yet. Make sure the message includes an amount (e.g. Rs 500) and debit/credit status.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelButton} onPress={reset} disabled={submitting}>
              <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.saveButton,
                {
                  backgroundColor: preview?.parsed && !submitting ? colors.primary : isDark ? '#374151' : '#E5E7EB',
                },
              ]}
              onPress={handleSave}
              disabled={submitting || !preview?.parsed}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text
                  style={[
                    styles.saveButtonText,
                    { color: preview?.parsed ? '#FFFFFF' : isDark ? '#9CA3AF' : '#9CA3AF' },
                  ]}
                >
                  Done
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  avoidingView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  headerTitleContainer: {
    flex: 1,
    marginRight: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  scrollBody: {
    maxHeight: 420,
  },
  inputWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  textArea: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    minHeight: 96,
    lineHeight: 20,
  },
  clearButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chipsSection: {
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsScroll: {
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActive: {
    borderColor: 'transparent',
  },
  chipInactive: {},
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  senderToggle: {
    paddingVertical: 6,
    marginBottom: 10,
  },
  senderToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  senderInputContainer: {
    marginBottom: 12,
  },
  senderInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  errorBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
  },
  previewSection: {
    marginTop: 4,
    marginBottom: 10,
  },
  previewCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewDetails: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  previewMerchant: {
    fontSize: 15,
    fontWeight: '700',
  },
  previewMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  previewAmountContainer: {
    alignItems: 'flex-end',
  },
  previewAmount: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  typeBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 3,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  unparsedCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  unparsedText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150, 150, 150, 0.2)',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  saveButton: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 22,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
});

export default PasteSMSModal;
