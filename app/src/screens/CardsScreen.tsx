import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import BankIcon from '../components/BankIcon';
import CardEditModal from '../components/CardEditModal';
import { CreditCard, getCardOverview, loadCreditCards } from '../services/creditCards';
import { CardOverview, daysUntil, dueLabel, formatRupees, formatShortDate, formatUnits, ordinal } from '../services/rewards/engine';

interface CardRow {
  card: CreditCard;
  overview: CardOverview | null;
}

const CardsScreen = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [rows, setRows] = useState<CardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const cards = await loadCreditCards();
      const next = await Promise.all(cards.map(async card => ({ card, overview: await getCardOverview(card) })));
      setRows(next);
    } catch (e) {
      console.error('Failed to load cards:', e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const totalToPay = rows.reduce((sum, r) => sum + (r.overview?.toPay || 0), 0);
  const totalUnbilled = rows.reduce((sum, r) => sum + Math.max(0, r.overview?.current.netSpend || 0), 0);
  const totalRewards = rows.reduce((sum, r) => sum + (r.overview?.current.expectedValue || 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={[styles.summary, { backgroundColor: colors.primary }]}>
          <Text style={styles.summaryLabel}>To pay across cards</Text>
          <Text style={styles.summaryAmount}>{formatRupees(totalToPay)}</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryMeta}>Unbilled {formatRupees(totalUnbilled)}</Text>
            <Text style={styles.summaryMeta}>Rewards this cycle ≈ {formatRupees(totalRewards)}</Text>
          </View>
        </View>

        {loaded && rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No credit cards yet</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Add each card's last 4 digits and statement date. Spends are matched to cards from the SMS, and you'll see
              what's due on each one and the cashback or points it should have earned.
            </Text>
          </View>
        ) : null}

        {rows.map(({ card, overview }) => {
          const days = overview ? daysUntil(overview.dueDate) : 0;
          const urgent = overview && overview.toPay > 0 && days <= 3;
          const program = card.program;
          return (
            <TouchableOpacity
              key={card.id}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.cardShadow }]}
              onPress={() => navigation.navigate('CardDetail', { cardId: card.id, title: card.name })}
              activeOpacity={0.8}
            >
              <View style={styles.cardHeader}>
                <BankIcon bank={card.bank || card.name} size={22} />
                <View style={styles.cardTitleWrap}>
                  <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>{card.name}</Text>
                  <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                    •• {card.last4 || '—'}
                    {card.statement_day ? ` · statement on the ${ordinal(card.statement_day)}` : ''}
                  </Text>
                </View>
              </View>

              {overview ? (
                <>
                  <View style={styles.dueRow}>
                    <View>
                      <Text style={[styles.dueLabel, { color: colors.textSecondary }]}>To pay</Text>
                      <Text style={[styles.dueAmount, { color: overview.toPay > 0 ? colors.text : colors.success }]}>
                        {overview.toPay > 0 ? formatRupees(overview.toPay) : 'Paid ✓'}
                      </Text>
                    </View>
                    {overview.toPay > 0 ? (
                      <View style={[styles.dueBadge, { backgroundColor: urgent ? colors.danger : colors.background }]}>
                        <Text style={[styles.dueBadgeText, { color: urgent ? '#fff' : colors.textSecondary }]}>
                          {formatShortDate(overview.dueDate)} · {dueLabel(days)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
                    <View style={styles.stat}>
                      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Unbilled</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{formatRupees(Math.max(0, overview.current.netSpend))}</Text>
                    </View>
                    {program ? (
                      <View style={styles.stat}>
                        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>This cycle</Text>
                        <Text style={[styles.statValue, { color: colors.success }]}>
                          {formatUnits(program, overview.current.expectedUnits)}
                        </Text>
                      </View>
                    ) : null}
                    {program && !program.autoCredit ? (
                      <View style={styles.stat}>
                        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>To redeem</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{formatUnits(program, overview.balanceUnits)}</Text>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : (
                <Text style={[styles.setup, { color: colors.warning }]}>Set a statement date to track dues →</Text>
              )}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.primary }]} onPress={() => setAdding(true)}>
          <Text style={styles.addButtonText}>+ Add card</Text>
        </TouchableOpacity>

        <Text style={[styles.footnote, { color: colors.textSecondary }]}>
          Estimates come from SMS alerts matched by the card's last digits. If a statement shows a different total, open
          the card and enter the real amount.
        </Text>
      </ScrollView>

      <CardEditModal
        visible={adding}
        card={null}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          load();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  summary: { borderRadius: 16, padding: 18, marginBottom: 16 },
  summaryLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' },
  summaryAmount: { color: '#fff', fontSize: 32, fontWeight: '800', marginTop: 4 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 6 },
  summaryMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  empty: { borderWidth: 1, borderRadius: 14, padding: 18, marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyText: { fontSize: 14, lineHeight: 20 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardTitleWrap: { flex: 1, marginLeft: 10 },
  cardName: { fontSize: 16, fontWeight: '700' },
  cardMeta: { fontSize: 12, marginTop: 2 },
  dueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 },
  dueLabel: { fontSize: 12, fontWeight: '600' },
  dueAmount: { fontSize: 24, fontWeight: '800', marginTop: 2 },
  dueBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  dueBadgeText: { fontSize: 12, fontWeight: '700' },
  statsRow: { flexDirection: 'row', borderTopWidth: 1, marginTop: 14, paddingTop: 10 },
  stat: { flex: 1 },
  statLabel: { fontSize: 11, fontWeight: '600' },
  statValue: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  setup: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  addButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  footnote: { fontSize: 12, lineHeight: 17, marginTop: 14, textAlign: 'center' },
});

export default CardsScreen;
