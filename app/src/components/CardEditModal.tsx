import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { CreditCard, deleteCreditCard, saveCreditCard } from '../services/creditCards';
import { REWARD_PRESETS, clonePresetProgram, findPreset } from '../services/rewards/presets';
import { RewardProgram, RewardTier, accelerationOf, effectivePercent, formatRupees } from '../services/rewards/engine';

interface Props {
  visible: boolean;
  /** null = adding a new card. */
  card: CreditCard | null;
  onClose: () => void;
  onSaved: () => void;
}

// Tier rates are edited as strings so a half-typed "7." isn't clobbered.
interface TierDraft {
  tier: RewardTier;
  label: string;
  rate: string;
}

const numOrNull = (s: string): number | null => {
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

const toDrafts = (program: RewardProgram | null): TierDraft[] =>
  (program?.tiers || []).map(tier => ({ tier, label: tier.label, rate: String(tier.rate) }));

const CardEditModal = ({ visible, card, onClose, onSaved }: Props) => {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [last4, setLast4] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [program, setProgram] = useState<RewardProgram | null>(null);
  const [tierDrafts, setTierDrafts] = useState<TierDraft[]>([]);
  const [pointValue, setPointValue] = useState('');
  const [blockSize, setBlockSize] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(card?.name || '');
    setBank(card?.bank || '');
    setLast4(card?.last4 || '');
    setStatementDay(card?.statement_day ? String(card.statement_day) : '');
    setDueDay(card?.due_day ? String(card.due_day) : '');
    setCreditLimit(card?.credit_limit ? String(card.credit_limit) : '');
    setPresetId(card?.reward_preset || null);
    setProgram(card?.program || null);
    setTierDrafts(toDrafts(card?.program || null));
    setPointValue(card?.program ? String(card.program.pointValue) : '');
    setBlockSize(card?.program ? String(card.program.blockSize) : '');
  }, [visible, card]);

  const pickPreset = (id: string | null) => {
    setPresetId(id);
    const preset = findPreset(id);
    const next = preset ? clonePresetProgram(preset) : null;
    setProgram(next);
    setTierDrafts(toDrafts(next));
    setPointValue(next ? String(next.pointValue) : '');
    setBlockSize(next ? String(next.blockSize) : '');
    if (preset) {
      if (!name.trim()) setName(preset.name);
      if (!bank.trim() && preset.bank) setBank(preset.bank);
    }
  };

  const updateDraft = (index: number, patch: Partial<TierDraft>) =>
    setTierDrafts(prev => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const removeDraft = (index: number) => setTierDrafts(prev => prev.filter((_, i) => i !== index));

  const addDraft = () =>
    setTierDrafts(prev => [
      ...prev,
      { tier: { id: `custom_${Date.now().toString(36)}`, label: '', rate: 0 }, label: '', rate: '' },
    ]);

  const buildProgram = (): RewardProgram | string | null => {
    if (!program) return null;
    const tiers: RewardTier[] = [];
    for (const draft of tierDrafts) {
      const rate = numOrNull(draft.rate);
      if (!draft.label.trim()) return 'Every reward tier needs a name.';
      if (rate === null || rate < 0) return `Enter a valid rate for "${draft.label}".`;
      tiers.push({ ...draft.tier, label: draft.label.trim(), rate });
    }
    if (tiers.length === 0) return 'Add at least one reward tier.';

    const pv = numOrNull(pointValue);
    const block = numOrNull(blockSize);
    if (program.kind === 'points') {
      if (!pv || pv <= 0) return 'Enter what one point is worth in ₹.';
      if (!block || block <= 0) return 'Enter the spend block (₹ per earning unit).';
    }
    const tierIds = new Set(tiers.map(t => t.id));
    return {
      ...program,
      pointValue: program.kind === 'points' ? pv! : 1,
      blockSize: program.kind === 'points' ? block! : 0,
      tiers,
      defaultTierId: tierIds.has(program.defaultTierId) ? program.defaultTierId : tiers[0].id,
      caps: program.caps
        .map(c => ({ ...c, tierIds: c.tierIds.filter(id => tierIds.has(id)) }))
        .filter(c => c.tierIds.length > 0),
    };
  };

  const save = async () => {
    const digits = last4.replace(/\D/g, '');
    const sDay = numOrNull(statementDay);
    const dDay = dueDay.trim() ? numOrNull(dueDay) : null;
    const limit = creditLimit.trim() ? numOrNull(creditLimit) : null;

    if (!name.trim()) return Alert.alert('Missing name', 'Give the card a name, e.g. "SBI Cashback".');
    // Accepts 2–6 digits: banks mask a different number of trailing digits in their SMS (e.g. "XX1234" vs "XXXXXX1234").
    if (digits.length < 2 || digits.length > 6) return Alert.alert('Card digits', 'Enter the last digits of the card, as they appear in your bank SMS.');
    if (!sDay || sDay < 1 || sDay > 31 || !Number.isInteger(sDay)) {
      return Alert.alert('Statement date', 'Enter the day of the month your statement is generated (1–31).');
    }
    if (dueDay.trim() && (!dDay || dDay < 1 || dDay > 31 || !Number.isInteger(dDay))) {
      return Alert.alert('Due date', 'Enter the payment due day of the month (1–31), or leave it empty.');
    }
    const built = buildProgram();
    if (typeof built === 'string') return Alert.alert('Rewards', built);

    setSaving(true);
    try {
      await saveCreditCard({
        id: card?.id,
        name: name.trim(),
        bank: bank.trim() || null,
        last4: digits,
        credit_limit: limit,
        statement_day: sDay,
        due_day: dDay,
        reward_preset: presetId,
        program: built,
      });
      onSaved();
    } catch (e: any) {
      Alert.alert('Could not save card', e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!card) return;
    Alert.alert('Delete card?', `Remove ${card.name} and its reward log? Transactions stay, just unlinked.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCreditCard(card.id);
          onSaved();
        },
      },
    ]);
  };

  const inputStyle = [styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }];
  const liveProgram = program;
  const acceleration = accelerationOf(liveProgram);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{card ? 'Edit card' : 'Add card'}</Text>
          <TouchableOpacity onPress={save} disabled={saving} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.headerAction, styles.headerSave, { color: colors.primary }]}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {card?.origin === 'web' ? (
            <View style={[styles.callout, { backgroundColor: colors.surface, borderLeftColor: colors.warning }]}>
              <Text style={[styles.calloutText, { color: colors.textSecondary }]}>
                This card comes from the web app — its name, digits and limit are overwritten on the next web sync.
                Statement dates and rewards stay on this phone.
              </Text>
            </View>
          ) : null}

          <Text style={[styles.section, { color: colors.text }]}>Card</Text>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
          <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. SBI Cashback" placeholderTextColor={colors.textSecondary} />

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Last digits</Text>
              <TextInput style={inputStyle} value={last4} onChangeText={setLast4} placeholder="1234" keyboardType="number-pad" maxLength={6} placeholderTextColor={colors.textSecondary} />
            </View>
            <View style={styles.col}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Bank (optional)</Text>
              <TextInput style={inputStyle} value={bank} onChangeText={setBank} placeholder="HDFC Bank" placeholderTextColor={colors.textSecondary} />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Statement day</Text>
              <TextInput style={inputStyle} value={statementDay} onChangeText={setStatementDay} placeholder="e.g. 15" keyboardType="number-pad" maxLength={2} placeholderTextColor={colors.textSecondary} />
            </View>
            <View style={styles.col}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Due day (optional)</Text>
              <TextInput style={inputStyle} value={dueDay} onChangeText={setDueDay} placeholder="e.g. 5" keyboardType="number-pad" maxLength={2} placeholderTextColor={colors.textSecondary} />
            </View>
          </View>
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            Day of the month the statement is generated. Without a due day, payment is assumed due 20 days after the statement.
          </Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Credit limit (optional)</Text>
          <TextInput style={inputStyle} value={creditLimit} onChangeText={setCreditLimit} placeholder="₹" keyboardType="decimal-pad" placeholderTextColor={colors.textSecondary} />

          <Text style={[styles.section, { color: colors.text }]}>Rewards</Text>
          <View style={styles.chips}>
            <TouchableOpacity
              style={[styles.chip, { borderColor: presetId === null ? colors.primary : colors.border, backgroundColor: presetId === null ? colors.primary : colors.surface }]}
              onPress={() => pickPreset(null)}
            >
              <Text style={[styles.chipText, { color: presetId === null ? '#fff' : colors.text }]}>No rewards</Text>
            </TouchableOpacity>
            {REWARD_PRESETS.map(p => {
              const active = presetId === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }]}
                  onPress={() => pickPreset(p.id)}
                >
                  <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>{p.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {liveProgram ? (
            <>
              <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.boxTitle, { color: colors.text }]}>
                  {liveProgram.kind === 'points' ? 'Reward points' : 'Cashback'}
                </Text>
                {liveProgram.kind === 'points' ? (
                  <View style={styles.row}>
                    <View style={styles.col}>
                      <Text style={[styles.label, { color: colors.textSecondary }]}>1 point = ₹</Text>
                      <TextInput style={inputStyle} value={pointValue} onChangeText={setPointValue} keyboardType="decimal-pad" placeholderTextColor={colors.textSecondary} />
                    </View>
                    <View style={styles.col}>
                      <Text style={[styles.label, { color: colors.textSecondary }]}>Earned per ₹</Text>
                      <TextInput style={inputStyle} value={blockSize} onChangeText={setBlockSize} keyboardType="number-pad" placeholderTextColor={colors.textSecondary} />
                    </View>
                  </View>
                ) : null}
                {acceleration && liveProgram.kind === 'points' ? (
                  <View style={[styles.switchRow, styles.switchGap]}>
                    <View style={styles.flex}>
                      <Text style={[styles.switchLabel, { color: colors.text }]}>Round the whole spend</Text>
                      <Text style={[styles.help, styles.noMargin, { color: colors.textSecondary }]}>
                        When a spend crosses {formatRupees(acceleration.threshold)}: on = round it into ₹{blockSize || '?'} blocks
                        once; off = round the part below and the part above separately (can lose a few points).
                      </Text>
                    </View>
                    <Switch
                      value={!!liveProgram.roundWholeSpend}
                      onValueChange={v => setProgram({ ...liveProgram, roundWholeSpend: v })}
                      trackColor={{ true: colors.primary, false: colors.border }}
                    />
                  </View>
                ) : null}
                <View style={styles.switchRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.switchLabel, { color: colors.text }]}>Credited automatically</Text>
                    <Text style={[styles.help, styles.noMargin, { color: colors.textSecondary }]}>
                      Off if you have to redeem it yourself — you'll get a balance and a "mark redeemed" button.
                    </Text>
                  </View>
                  <Switch
                    value={liveProgram.autoCredit}
                    onValueChange={v => setProgram({ ...liveProgram, autoCredit: v })}
                    trackColor={{ true: colors.primary, false: colors.border }}
                  />
                </View>
              </View>

              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Tiers — rate is {liveProgram.kind === 'points' ? `points per ₹${blockSize || '?'}` : '% cashback'}. Tap ★ to make one the default.
              </Text>
              {tierDrafts.map((draft, index) => {
                const isDefault = liveProgram.defaultTierId === draft.tier.id;
                const rate = numOrNull(draft.rate);
                const pct = rate !== null && liveProgram.kind === 'points'
                  ? effectivePercent({ ...liveProgram, pointValue: numOrNull(pointValue) || 0, blockSize: numOrNull(blockSize) || 0 }, rate)
                  : null;
                // The accelerating tier always counts toward its own threshold, so it gets no toggle.
                const showCounts = acceleration && !draft.tier.accelerateAfter;
                const counts = draft.tier.countsTowardThreshold ?? (rate !== null && rate > 0);
                return (
                  <View key={draft.tier.id} style={[styles.tierCard, { backgroundColor: colors.surface, borderColor: isDefault ? colors.primary : colors.border }]}>
                    <View style={styles.tierRow}>
                      <TouchableOpacity
                        onPress={() => setProgram({ ...liveProgram, defaultTierId: draft.tier.id })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={isDefault ? 'Default tier' : 'Make default tier'}
                      >
                        <Text style={[styles.star, { color: isDefault ? colors.warning : colors.textSecondary }]}>{isDefault ? '★' : '☆'}</Text>
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.tierLabel, { color: colors.text }]}
                        value={draft.label}
                        onChangeText={t => updateDraft(index, { label: t })}
                        placeholder="Category"
                        placeholderTextColor={colors.textSecondary}
                        multiline
                      />
                      <View style={styles.rateWrap}>
                        <TextInput
                          style={[styles.rateInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                          value={draft.rate}
                          onChangeText={t => updateDraft(index, { rate: t })}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={colors.textSecondary}
                        />
                        <Text style={[styles.rateUnit, { color: colors.textSecondary }]}>
                          {liveProgram.kind === 'points' ? (pct !== null ? `≈${Math.round(pct * 100) / 100}%` : 'pts') : '%'}
                        </Text>
                      </View>
                      {!isDefault ? (
                        <TouchableOpacity onPress={() => removeDraft(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={[styles.remove, { color: colors.danger }]}>✕</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.removeSpacer} />
                      )}
                    </View>
                    {showCounts ? (
                      <TouchableOpacity
                        style={styles.countsRow}
                        onPress={() => updateDraft(index, { tier: { ...draft.tier, countsTowardThreshold: !counts } })}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: counts }}
                      >
                        <Text style={[styles.countsBox, { color: counts ? colors.success : colors.textSecondary }]}>{counts ? '☑' : '☐'}</Text>
                        <Text style={[styles.countsText, { color: counts ? colors.text : colors.textSecondary }]}>
                          Counts toward {formatRupees(acceleration.threshold)}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
              <TouchableOpacity style={[styles.addTier, { borderColor: colors.border }]} onPress={addDraft}>
                <Text style={[styles.addTierText, { color: colors.primary }]}>+ Add tier</Text>
              </TouchableOpacity>
              {liveProgram.caps.length > 0 ? (
                <Text style={[styles.help, { color: colors.textSecondary }]}>
                  Caps applied: {liveProgram.caps.map(c => `${c.label} ${liveProgram.kind === 'points' ? `${c.limit} pts` : `₹${c.limit}`}/${c.period}`).join(', ')}
                </Text>
              ) : null}
            </>
          ) : null}

          {card ? (
            <TouchableOpacity style={[styles.deleteButton, { borderColor: colors.danger }]} onPress={confirmDelete}>
              <Text style={[styles.deleteText, { color: colors.danger }]}>Delete card</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerAction: { fontSize: 16 },
  headerSave: { fontWeight: '700' },
  content: { padding: 16, paddingBottom: 48 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 8, marginBottom: 10 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  help: { fontSize: 12, lineHeight: 17, marginTop: -6, marginBottom: 14 },
  noMargin: { marginTop: 2, marginBottom: 0 },
  input: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 16, marginBottom: 14 },
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  flex: { flex: 1, marginRight: 12 },
  callout: { borderLeftWidth: 3, padding: 10, borderRadius: 6, marginBottom: 16 },
  calloutText: { fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  box: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  boxTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  switchLabel: { fontSize: 14, fontWeight: '600' },
  tierCard: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, marginLeft: 28 },
  countsBox: { fontSize: 16 },
  countsText: { fontSize: 12, fontWeight: '600' },
  switchGap: { marginBottom: 12 },
  star: { fontSize: 20 },
  tierLabel: { flex: 1, fontSize: 14, paddingVertical: 4 },
  rateWrap: { alignItems: 'center' },
  rateInput: { width: 64, borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, fontSize: 15, textAlign: 'right' },
  rateUnit: { fontSize: 11, marginTop: 2 },
  remove: { fontSize: 16, paddingHorizontal: 2 },
  removeSpacer: { width: 20 },
  addTier: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 14 },
  addTierText: { fontSize: 14, fontWeight: '600' },
  deleteButton: { borderWidth: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 20 },
  deleteText: { fontSize: 15, fontWeight: '600' },
});

export default CardEditModal;
