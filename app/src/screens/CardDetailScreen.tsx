import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import CardEditModal from '../components/CardEditModal';
import AmountPromptModal from '../components/AmountPromptModal';
import RewardTierPicker from '../components/RewardTierPicker';
import {
  CreditCard,
  addRewardEntry,
  deleteRewardEntry,
  getCardOverview,
  getCreditCard,
  loadRewardEntries,
  setReceivedReward,
  setStatementAmount,
  setTransactionRewardTier,
} from '../services/creditCards';
import {
  CardOverview,
  CycleSummary,
  RewardEntry,
  RewardTxn,
  formatRupees,
  formatShortDate,
  formatUnits,
  isRefundCredit,
  ordinal,
  parseTxnDate,
  resolveTier,
  toDateKey,
  daysUntil,
  dueLabel,
} from '../services/rewards/engine';

type Prompt =
  | { kind: 'statement' }
  | { kind: 'received'; cycle: CycleSummary }
  | { kind: 'redeem' };

const CardDetailScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const cardId: string = route.params?.cardId;
  const { colors } = useTheme();

  const [card, setCard] = useState<CreditCard | null>(null);
  const [overview, setOverview] = useState<CardOverview | null>(null);
  const [entries, setEntries] = useState<RewardEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pickerTxn, setPickerTxn] = useState<RewardTxn | null>(null);

  const load = useCallback(async () => {
    const next = await getCreditCard(cardId);
    setCard(next);
    if (!next) return;
    navigation.setOptions({ title: next.name });
    setOverview(await getCardOverview(next));
    setEntries(await loadRewardEntries(next.id));
  }, [cardId, navigation]);

  useFocusEffect(
    useCallback(() => {
      load().catch(e => console.error('Failed to load card:', e));
    }, [load])
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => setEditing(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.headerButton, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors.primary]);

  if (!card) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  const program = card.program;
  const cycle = overview?.cycles.find(c => c.key === selectedKey) || overview?.current || null;

  const submitPrompt = async (value: number | null) => {
    if (!prompt || !overview) return;
    try {
      if (prompt.kind === 'statement') {
        await setStatementAmount(card.id, toDateKey(overview.lastStatementDate), value);
      } else if (prompt.kind === 'received') {
        await setReceivedReward(card, prompt.cycle.key, value);
      } else if (prompt.kind === 'redeem' && value !== null && program) {
        await addRewardEntry({
          card_id: card.id,
          kind: 'redeemed',
          cycle_key: null,
          units: overview.balanceUnits,
          amount: value,
          note: null,
        });
      }
    } catch (e: any) {
      Alert.alert('Could not save', e.message || String(e));
    }
    setPrompt(null);
    load();
  };

  const confirmDeleteEntry = (entry: RewardEntry) => {
    Alert.alert('Remove this redemption?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteRewardEntry(entry.id);
          load();
        },
      },
    ]);
  };

  const pickTier = async (tierId: string | null) => {
    if (!pickerTxn) return;
    await setTransactionRewardTier(pickerTxn.id, tierId);
    setPickerTxn(null);
    load();
  };

  const renderCompare = (c: CycleSummary) => {
    if (!program) return null;
    if (c.isCurrent) {
      return (
        <Text style={[styles.compareNote, { color: colors.textSecondary }]}>
          Cycle still open — closes {formatShortDate(c.end)}.
        </Text>
      );
    }
    if (c.receivedUnits === null) {
      return (
        <TouchableOpacity onPress={() => setPrompt({ kind: 'received', cycle: c })}>
          <Text style={[styles.link, { color: colors.primary }]}>
            Log {program.kind === 'points' ? 'points credited' : 'cashback received'} for this statement →
          </Text>
        </TouchableOpacity>
      );
    }
    const diff = c.receivedUnits - c.expectedUnits;
    // Under ₹1 / 1 point is rounding on the bank's side, not a missed credit.
    const ok = Math.abs(diff) < 1;
    return (
      <TouchableOpacity onPress={() => setPrompt({ kind: 'received', cycle: c })}>
        <Text style={[styles.compareNote, { color: ok ? colors.success : diff < 0 ? colors.danger : colors.warning }]}>
          {ok
            ? `✓ Matches — received ${formatUnits(program, c.receivedUnits)}`
            : diff < 0
              ? `Short by ${formatUnits(program, -diff)} — received ${formatUnits(program, c.receivedUnits)}`
              : `${formatUnits(program, diff)} more than expected — received ${formatUnits(program, c.receivedUnits)}`}
          <Text style={{ color: colors.textSecondary }}>  (edit)</Text>
        </Text>
      </TouchableOpacity>
    );
  };

  const redemptions = entries.filter(e => e.kind === 'redeemed');
  const days = overview ? daysUntil(overview.dueDate) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          •• {card.last4 || '—'}
          {card.statement_day ? ` · statement on the ${ordinal(card.statement_day)}` : ''}
          {card.due_day ? ` · due on the ${ordinal(card.due_day)}` : ''}
        </Text>

        {!overview ? (
          <TouchableOpacity
            style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.warning }]}
            onPress={() => setEditing(true)}
          >
            <Text style={[styles.boxTitle, { color: colors.text }]}>Add a statement date</Text>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              Needed to split spends into billing cycles and work out what's due.
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.boxTitle, { color: colors.text }]}>
                Statement of {formatShortDate(overview.lastStatementDate)}
              </Text>
              <TouchableOpacity style={styles.line} onPress={() => setPrompt({ kind: 'statement' })}>
                <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>
                  Billed {overview.billedIsManual ? '(from statement)' : '(estimated)'}
                </Text>
                <Text style={[styles.lineValue, { color: colors.text }]}>
                  {formatRupees(overview.billed, 2)} <Text style={[styles.editHint, { color: colors.primary }]}>edit</Text>
                </Text>
              </TouchableOpacity>
              <View style={styles.line}>
                <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>Paid since statement</Text>
                <Text style={[styles.lineValue, { color: colors.success }]}>{formatRupees(overview.paidSinceStatement, 2)}</Text>
              </View>
              <View style={[styles.line, styles.totalLine, { borderTopColor: colors.border }]}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Left to pay</Text>
                <Text style={[styles.totalValue, { color: overview.toPay > 0 ? colors.danger : colors.success }]}>
                  {overview.toPay > 0 ? formatRupees(overview.toPay, 2) : 'Paid ✓'}
                </Text>
              </View>
              {overview.toPay > 0 ? (
                <Text style={[styles.muted, { color: days <= 3 ? colors.danger : colors.textSecondary }]}>
                  Due {formatShortDate(overview.dueDate)} · {dueLabel(days)}
                </Text>
              ) : null}
            </View>

            <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.line}>
                <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>
                  Unbilled ({formatShortDate(overview.current.start)} – {formatShortDate(overview.current.end)})
                </Text>
                <Text style={[styles.lineValue, { color: colors.text }]}>
                  {formatRupees(Math.max(0, overview.current.netSpend), 2)}
                </Text>
              </View>
              {card.credit_limit ? (
                <View style={styles.line}>
                  <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>Available (est.)</Text>
                  <Text style={[styles.lineValue, { color: colors.text }]}>
                    {formatRupees(Math.max(0, card.credit_limit - overview.toPay - Math.max(0, overview.current.netSpend)))}
                  </Text>
                </View>
              ) : null}
            </View>

            {program && !program.autoCredit ? (
              <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.boxTitle, { color: colors.text }]}>Unredeemed rewards</Text>
                <Text style={[styles.bigValue, { color: colors.success }]}>
                  {formatUnits(program, overview.balanceUnits)}
                  {program.kind === 'points' ? (
                    <Text style={[styles.muted, { color: colors.textSecondary }]}>
                      {'  '}≈ {formatRupees(overview.balanceUnits * program.pointValue, 2)}
                    </Text>
                  ) : null}
                </Text>
                <Text style={[styles.muted, { color: colors.textSecondary }]}>
                  Credited through the last statement. {formatUnits(program, overview.current.expectedUnits)} more is
                  accruing this cycle.
                </Text>
                {overview.balanceUnits > 0 ? (
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    onPress={() => setPrompt({ kind: 'redeem' })}
                  >
                    <Text style={styles.primaryButtonText}>Mark all as redeemed</Text>
                  </TouchableOpacity>
                ) : null}
                {redemptions.map(entry => (
                  <TouchableOpacity key={entry.id} style={styles.line} onLongPress={() => confirmDeleteEntry(entry)}>
                    <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>
                      Redeemed {formatShortDate(parseTxnDate(entry.date))} · {formatUnits(program, entry.units)}
                    </Text>
                    <Text style={[styles.lineValue, { color: colors.text }]}>{formatRupees(entry.amount, 2)}</Text>
                  </TouchableOpacity>
                ))}
                {redemptions.length > 0 ? (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>Hold a redemption to remove it.</Text>
                ) : null}
              </View>
            ) : null}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>Billing cycles</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {overview.cycles.map(c => {
                const active = c.key === cycle?.key;
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[
                      styles.chip,
                      { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface },
                    ]}
                    onPress={() => setSelectedKey(c.key)}
                  >
                    <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>
                      {c.isCurrent ? 'Current' : formatShortDate(c.end)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {cycle ? (
              <>
                <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.muted, { color: colors.textSecondary }]}>
                    {formatShortDate(cycle.start)} – {formatShortDate(cycle.end)}
                  </Text>
                  <View style={styles.line}>
                    <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>Spends</Text>
                    <Text style={[styles.lineValue, { color: colors.text }]}>{formatRupees(cycle.spend, 2)}</Text>
                  </View>
                  {cycle.refunds > 0 ? (
                    <View style={styles.line}>
                      <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>Refunds / cashback</Text>
                      <Text style={[styles.lineValue, { color: colors.success }]}>−{formatRupees(cycle.refunds, 2)}</Text>
                    </View>
                  ) : null}
                  {cycle.payments > 0 ? (
                    <View style={styles.line}>
                      <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>Payments made</Text>
                      <Text style={[styles.lineValue, { color: colors.success }]}>{formatRupees(cycle.payments, 2)}</Text>
                    </View>
                  ) : null}
                  {program ? (
                    <>
                      <View style={[styles.line, styles.totalLine, { borderTopColor: colors.border }]}>
                        <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>
                          Expected {program.kind === 'points' ? 'points' : 'cashback'}
                        </Text>
                        <Text style={[styles.lineValue, { color: colors.success }]}>
                          {formatUnits(program, cycle.expectedUnits)}
                          {program.kind === 'points' ? ` · ${formatRupees(cycle.expectedValue, 2)}` : ''}
                        </Text>
                      </View>
                      {renderCompare(cycle)}
                    </>
                  ) : null}
                </View>

                {cycle.txns.length === 0 ? (
                  <Text style={[styles.muted, styles.centered, { color: colors.textSecondary }]}>No transactions in this cycle.</Text>
                ) : null}
                {cycle.txns.map(txn => {
                  const isDebit = txn.type === 'debit';
                  const reward = overview.rewards.get(txn.id);
                  const tier = isDebit && program ? resolveTier(program, txn) : null;
                  const capped = reward && reward.units < reward.uncappedUnits;
                  return (
                    <View key={txn.id} style={[styles.txn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <View style={styles.txnTop}>
                        <View style={styles.txnMain}>
                          <Text style={[styles.txnMerchant, { color: colors.text }]} numberOfLines={1}>
                            {txn.merchant_raw || (isDebit ? 'Spend' : 'Credit')}
                          </Text>
                          <Text style={[styles.txnDate, { color: colors.textSecondary }]}>
                            {formatShortDate(parseTxnDate(txn.date))}
                            {!isDebit ? (isRefundCredit(txn) ? ' · refund' : ' · payment') : ''}
                          </Text>
                        </View>
                        <Text style={[styles.txnAmount, { color: isDebit ? colors.text : colors.success }]}>
                          {isDebit ? '' : '+'}
                          {formatRupees(txn.amount, 2)}
                        </Text>
                      </View>
                      {tier && program ? (
                        <TouchableOpacity
                          style={[styles.tierChip, { borderColor: txn.reward_tier ? colors.primary : colors.border }]}
                          onPress={() => setPickerTxn(txn)}
                        >
                          <Text style={[styles.tierChipText, { color: colors.textSecondary }]} numberOfLines={1}>
                            {tier.label}
                            {txn.reward_tier ? '' : ' · auto'} ▾
                          </Text>
                          <Text style={[styles.tierEarn, { color: reward && reward.units > 0 ? colors.success : colors.textSecondary }]}>
                            {formatUnits(program, reward?.units || 0)}
                            {capped ? ' (capped)' : ''}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <CardEditModal
        visible={editing}
        card={card}
        onClose={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false);
          const stillExists = await getCreditCard(card.id);
          if (!stillExists) navigation.goBack();
          else load();
        }}
      />

      <RewardTierPicker
        visible={!!pickerTxn}
        program={program}
        amount={pickerTxn?.amount || 0}
        currentTierId={pickerTxn && program ? resolveTier(program, pickerTxn)?.id || null : null}
        isExplicit={!!pickerTxn?.reward_tier}
        onSelect={pickTier}
        onClose={() => setPickerTxn(null)}
      />

      <AmountPromptModal
        visible={prompt?.kind === 'statement'}
        title="Statement amount"
        message="Enter the total due from the actual statement. It replaces the estimate built from SMS alerts."
        label="Total amount due (₹)"
        initialValue={overview?.billed}
        clearLabel={overview?.billedIsManual ? 'Use estimate' : undefined}
        onSubmit={submitPrompt}
        onClose={() => setPrompt(null)}
      />
      <AmountPromptModal
        visible={prompt?.kind === 'received'}
        title={program?.kind === 'points' ? 'Points credited' : 'Cashback received'}
        message={
          prompt?.kind === 'received' && program
            ? `For the statement of ${formatShortDate(prompt.cycle.end)}. Expected ${formatUnits(program, prompt.cycle.expectedUnits)}.`
            : undefined
        }
        label={program?.kind === 'points' ? 'Points' : 'Amount (₹)'}
        initialValue={prompt?.kind === 'received' ? prompt.cycle.receivedUnits ?? prompt.cycle.expectedUnits : null}
        clearLabel={prompt?.kind === 'received' && prompt.cycle.receivedUnits !== null ? 'Remove' : undefined}
        onSubmit={submitPrompt}
        onClose={() => setPrompt(null)}
      />
      <AmountPromptModal
        visible={prompt?.kind === 'redeem'}
        title="Mark all as redeemed"
        message={program && overview ? `Redeeming ${formatUnits(program, overview.balanceUnits)}. What did you get for them?` : undefined}
        label="Value received (₹)"
        initialValue={program && overview ? overview.balanceUnits * program.pointValue : null}
        submitLabel="Redeem"
        onSubmit={submitPrompt}
        onClose={() => setPrompt(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  headerButton: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 13, marginBottom: 12 },
  box: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  boxTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  lineLabel: { fontSize: 14, flex: 1, marginRight: 12 },
  lineValue: { fontSize: 14, fontWeight: '600' },
  editHint: { fontSize: 12, fontWeight: '600' },
  totalLine: { borderTopWidth: 1, marginTop: 6, paddingTop: 10 },
  totalLabel: { fontSize: 15, fontWeight: '700' },
  totalValue: { fontSize: 18, fontWeight: '800' },
  muted: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  hint: { fontSize: 11, marginTop: 6 },
  centered: { textAlign: 'center', marginVertical: 12 },
  bigValue: { fontSize: 24, fontWeight: '800' },
  primaryButton: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12, marginBottom: 6 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: 8, marginBottom: 10 },
  chips: { gap: 8, paddingBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  compareNote: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  link: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  txn: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  txnTop: { flexDirection: 'row', alignItems: 'center' },
  txnMain: { flex: 1, marginRight: 12 },
  txnMerchant: { fontSize: 15, fontWeight: '600' },
  txnDate: { fontSize: 12, marginTop: 2 },
  txnAmount: { fontSize: 15, fontWeight: '700' },
  tierChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  tierChipText: { fontSize: 12, fontWeight: '600', flex: 1, marginRight: 8 },
  tierEarn: { fontSize: 12, fontWeight: '700' },
});

export default CardDetailScreen;
