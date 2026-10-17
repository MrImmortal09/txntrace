import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { BANKS } from '../../constants/banks';
import BankIcon from '../BankIcon';
import { IconDaily, IconFriends, IconHome, IconMore, IconReview } from '../TabIcons';

/**
 * Look-alike snippets of real screens for the tutorial slides, filled with
 * sample numbers. Display only; the interactive ones are in GestureDemos.
 */

// "A, B and C", built from BANKS so the caption matches the logos above it.
const bankNames = BANKS.map(bank => bank.name);
const BANK_LIST =
  bankNames.length > 1 ? `${bankNames.slice(0, -1).join(', ')} and ${bankNames[bankNames.length - 1]}` : bankNames[0];

export const WelcomeVisual = () => {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <View style={[styles.logo, { backgroundColor: colors.primary, shadowColor: colors.primary }]}>
        <Svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke={colors.onPrimary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <Path d="M5 2h14v20l-2.33-1.5L14.33 22 12 20.5 9.67 22l-2.34-1.5L5 22z" />
          <Polyline points="8 14 10.5 11.5 12.5 13.5 16 9.5" />
          <Line x1="8" y1="6.5" x2="16" y2="6.5" />
          <Line x1="8" y1="17.5" x2="13" y2="17.5" />
        </Svg>
      </View>
      <View style={styles.bankRow}>
        {BANKS.map(bank => (
          <View key={bank.id} style={[styles.bankChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <BankIcon bank={bank.name} size={16} />
          </View>
        ))}
      </View>
      <Text style={[styles.smallNote, { color: colors.textSecondary }]}>Reads SMS from {BANK_LIST}</Text>
    </View>
  );
};

export const HomeVisual = () => {
  const { colors } = useTheme();
  const month = new Date().toLocaleString([], { month: 'long', year: 'numeric' });
  const bars = [
    { label: 'Food', value: 3200, color: colors.primary },
    { label: 'Shopping', value: 2600, color: colors.accent },
    { label: 'Transport', value: 1500, color: colors.warning },
    { label: 'Bills', value: 1120, color: colors.danger },
  ];
  const max = Math.max(...bars.map(b => b.value));

  return (
    <View style={styles.full}>
      <View style={[styles.dateNav, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.dateArrow, { color: colors.text }]}>‹</Text>
        <View style={styles.dateCenter}>
          <Text style={[styles.dateTitle, { color: colors.text }]}>{month}</Text>
          <View style={[styles.adjustPill, { backgroundColor: colors.primary + '18' }]}>
            <Text style={[styles.adjustText, { color: colors.primary }]}>Adjust</Text>
          </View>
        </View>
        <Text style={[styles.dateArrow, { color: colors.text }]}>›</Text>
      </View>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>My Spends</Text>
          <Text style={[styles.summaryAmount, { color: colors.danger }]}>₹8,420</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          <Text style={[styles.summaryLabel, { color: colors.onPrimary }]}>Owed to you</Text>
          <Text style={[styles.summaryAmount, { color: colors.onPrimary }]}>₹570</Text>
        </View>
      </View>

      <View style={[styles.chart, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {bars.map(bar => (
          <View key={bar.label} style={styles.barColumn}>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: (bar.value / max) * 64, backgroundColor: bar.color }]} />
            </View>
            <Text style={[styles.barLabel, { color: colors.textSecondary }]} numberOfLines={1}>{bar.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

export const FriendsVisual = () => {
  const { colors } = useTheme();
  const friends = [
    { name: 'Rahul', text: 'owes ₹450.00', color: colors.success },
    { name: 'Priya', text: 'you owe ₹120.00', color: colors.danger },
    { name: 'Aman', text: 'settled up', color: colors.textSecondary },
  ];
  return (
    <View style={styles.full}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>NEEDS MATCHING</Text>
      <View style={[styles.listRow, styles.listRowGap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.flex}>
          <Text style={[styles.listName, { color: colors.text }]}>RAHUL K SHARMA</Text>
          <Text style={[styles.listMeta, { color: colors.textSecondary }]}>Paid you · UPI</Text>
        </View>
        <Text style={[styles.listAmount, { color: colors.success }]}>+₹450.00</Text>
        <View style={[styles.miniButton, { borderColor: colors.border }]}>
          <Text style={[styles.miniButtonText, { color: colors.textSecondary }]}>Mine</Text>
        </View>
        <View style={[styles.miniButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          <Text style={[styles.miniButtonText, { color: colors.onPrimary }]}>Match</Text>
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>FRIENDS</Text>
      <View style={[styles.listGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {friends.map((f, i) => (
          <View
            key={f.name}
            style={[styles.groupRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <Text style={[styles.listName, { color: colors.text }]}>{f.name}</Text>
            <Text style={[styles.listAmount, { color: f.color }]}>{f.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

export const CardsVisual = () => {
  const { colors } = useTheme();
  return (
    <View style={styles.full}>
      <View style={[styles.creditCard, { backgroundColor: colors.primary, shadowColor: colors.primary }]}>
        <View style={styles.creditCardTop}>
          <Text style={[styles.creditCardName, { color: colors.onPrimary }]}>Cashback Card</Text>
          <Text style={[styles.creditCardDigits, { color: colors.onPrimary }]}>•• 4321</Text>
        </View>
        <Text style={[styles.creditCardLabel, { color: colors.onPrimary }]}>To pay</Text>
        <Text style={[styles.creditCardDue, { color: colors.onPrimary }]}>₹12,480.00</Text>
        <Text style={[styles.creditCardLabel, { color: colors.onPrimary }]}>Due 5 Nov · Rewards this cycle ≈ ₹312</Text>
      </View>

      <View style={styles.tierRow}>
        <View style={[styles.tierChip, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          <Text style={[styles.tierLabel, { color: colors.onPrimary }]}>Online</Text>
          <Text style={[styles.tierMeta, { color: colors.onPrimary }]}>5% · ₹62 · auto</Text>
        </View>
        <View style={[styles.tierChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.tierLabel, { color: colors.text }]}>Other spends</Text>
          <Text style={[styles.tierMeta, { color: colors.textSecondary }]}>1% · ₹12</Text>
        </View>
      </View>
      <Text style={[styles.smallNote, { color: colors.success }]}>✓ Matches: received ₹312</Text>
    </View>
  );
};

export const TabRecapVisual = () => {
  const { colors } = useTheme();
  const tabs = [
    { Icon: IconHome, name: 'Home', role: 'Totals' },
    { Icon: IconDaily, name: 'Daily', role: 'Sort new ones' },
    { Icon: IconReview, name: 'Review', role: 'Categorise' },
    { Icon: IconFriends, name: 'Friends', role: 'Balances' },
    { Icon: IconMore, name: 'More', role: 'Cards, settings' },
  ];
  return (
    <View style={[styles.tabBar, { backgroundColor: colors.tabBarBg, borderColor: colors.border }]}>
      {tabs.map(({ Icon, name, role }) => (
        <View key={name} style={styles.tabItem}>
          <Icon color={colors.tabBarActive} size={22} />
          <Text style={[styles.tabName, { color: colors.text }]}>{name}</Text>
          <Text style={[styles.tabRole, { color: colors.textSecondary }]} numberOfLines={2}>{role}</Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  full: { width: '100%' },
  flex: { flex: 1 },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 6,
  },
  bankRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 22 },
  bankChip: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  smallNote: { fontSize: 12, textAlign: 'center', marginTop: 10, fontWeight: '500' },

  dateNav: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12 },
  dateArrow: { fontSize: 22, fontWeight: '600', paddingHorizontal: 6 },
  dateCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dateTitle: { fontSize: 15, fontWeight: '700' },
  adjustPill: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  adjustText: { fontSize: 11, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  summaryCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12 },
  summaryLabel: { fontSize: 12, fontWeight: '500' },
  summaryAmount: { fontSize: 20, fontWeight: 'bold', marginTop: 4 },
  chart: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10, gap: 8 },
  barColumn: { flex: 1, alignItems: 'center' },
  barTrack: { height: 64, justifyContent: 'flex-end' },
  bar: { width: 22, borderRadius: 5 },
  barLabel: { fontSize: 11, marginTop: 6 },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, borderWidth: 1, padding: 10 },
  listRowGap: { marginBottom: 14 },
  listName: { fontSize: 14, fontWeight: '600' },
  listMeta: { fontSize: 11, marginTop: 2 },
  listAmount: { fontSize: 13, fontWeight: '700' },
  miniButton: { borderRadius: 7, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  miniButtonText: { fontSize: 11, fontWeight: '600' },
  listGroup: { borderRadius: 12, borderWidth: 1 },
  groupRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11 },

  creditCard: {
    borderRadius: 16,
    padding: 16,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 5,
  },
  creditCardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  creditCardName: { fontSize: 15, fontWeight: '700' },
  creditCardDigits: { fontSize: 14, fontWeight: '600', letterSpacing: 1 },
  creditCardLabel: { fontSize: 12, opacity: 0.85 },
  creditCardDue: { fontSize: 24, fontWeight: 'bold', marginVertical: 2 },
  tierRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  tierChip: { flex: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  tierLabel: { fontSize: 13, fontWeight: '700' },
  tierMeta: { fontSize: 12, marginTop: 2 },

  tabBar: { flexDirection: 'row', width: '100%', borderRadius: 16, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 4 },
  tabItem: { flex: 1, alignItems: 'center' },
  tabName: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  tabRole: { fontSize: 10, textAlign: 'center', marginTop: 2 },
});
