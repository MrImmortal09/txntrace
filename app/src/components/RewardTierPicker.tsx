import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { RewardProgram, estimateUnits, formatTierRate, formatUnits } from '../services/rewards/engine';

interface Props {
  visible: boolean;
  program: RewardProgram | null;
  amount: number;
  /** The tier currently in effect (explicit or default). */
  currentTierId: string | null;
  /** Whether currentTierId was picked by the user rather than defaulted. */
  isExplicit: boolean;
  onSelect: (tierId: string | null) => void;
  onClose: () => void;
}

const RewardTierPicker = ({ visible, program, amount, currentTierId, isExplicit, onSelect, onClose }: Props) => {
  const { colors } = useTheme();
  if (!program) return null;

  const defaultTier = program.tiers.find(t => t.id === program.defaultTierId);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <Text style={[styles.title, { color: colors.text }]}>Reward tier</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Which category did this ₹{amount.toLocaleString('en-IN')} earn under?
          </Text>

          <ScrollView style={styles.list}>
            <TouchableOpacity
              style={[
                styles.option,
                { borderColor: !isExplicit ? colors.primary : colors.border },
                !isExplicit && { backgroundColor: colors.background },
              ]}
              onPress={() => onSelect(null)}
            >
              <Text style={[styles.optionLabel, { color: colors.text }]}>Auto</Text>
              <Text style={[styles.optionMeta, { color: colors.textSecondary }]}>
                Merchant match, else card default{defaultTier ? ` (${defaultTier.label})` : ''}
              </Text>
            </TouchableOpacity>

            {program.tiers.map(tier => {
              const selected = isExplicit && tier.id === currentTierId;
              const estimate = estimateUnits(program, tier, amount);
              return (
                <TouchableOpacity
                  key={tier.id}
                  style={[
                    styles.option,
                    { borderColor: selected ? colors.primary : colors.border },
                    selected && { backgroundColor: colors.background },
                  ]}
                  onPress={() => onSelect(tier.id)}
                >
                  <View style={styles.optionRow}>
                    <Text style={[styles.optionLabel, styles.flex, { color: colors.text }]}>{tier.label}</Text>
                    <Text style={[styles.optionEarn, { color: estimate > 0 ? colors.success : colors.textSecondary }]}>
                      {formatUnits(program, estimate)}
                    </Text>
                  </View>
                  <Text style={[styles.optionMeta, { color: colors.textSecondary }]}>
                    {formatTierRate(program, tier)}
                    {tier.minAmount ? ` · min ₹${tier.minAmount}` : ''}
                    {!selected && !isExplicit && tier.id === currentTierId ? ' · in effect' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.close} onPress={onClose}>
            <Text style={[styles.closeText, { color: colors.textSecondary }]}>Close</Text>
          </TouchableOpacity>
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
    maxWidth: 420,
    maxHeight: '80%',
    borderRadius: 20,
    padding: 20,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 8,
  },
  title: { fontSize: 17, fontWeight: 'bold' },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  list: { flexGrow: 0 },
  option: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, marginRight: 8 },
  optionLabel: { fontSize: 14, fontWeight: '600' },
  optionEarn: { fontSize: 14, fontWeight: '700' },
  optionMeta: { fontSize: 12, marginTop: 3 },
  close: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 6, marginTop: 4 },
  closeText: { fontSize: 15, fontWeight: '600' },
});

export default RewardTierPicker;
