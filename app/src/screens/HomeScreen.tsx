import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Rect, Line } from 'react-native-svg';
import { db } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import BankIcon from '../components/BankIcon';
import TransactionDetailModal, { TransactionRow } from '../components/TransactionDetailModal';

const CHART_HEIGHT = 140;

export type DatePreset = 'this_month' | 'last_month' | 'last_30_days' | 'this_year' | 'all_time' | 'custom';
export type SortOption = 'category' | 'date' | 'amount';

interface DateRange {
  startDate: Date;
  endDate: Date;
  label: string;
}

const getCategoryIcon = (category?: string | null): string => {
  const cat = (category || '').toLowerCase().trim();
  if (cat.includes('food') || cat.includes('dining') || cat.includes('restaurant') || cat.includes('cafe')) return '🍽️';
  if (cat.includes('shopping') || cat.includes('retail') || cat.includes('store') || cat.includes('amazon')) return '🛍️';
  if (cat.includes('transport') || cat.includes('travel') || cat.includes('cab') || cat.includes('uber') || cat.includes('metro')) return '🚗';
  if (cat.includes('bill') || cat.includes('utility') || cat.includes('electricity') || cat.includes('recharge')) return '📄';
  if (cat.includes('rent') || cat.includes('house') || cat.includes('flat')) return '🏠';
  if (cat.includes('health') || cat.includes('med') || cat.includes('doctor')) return '💊';
  if (cat.includes('entertain') || cat.includes('movie') || cat.includes('show')) return '🎬';
  if (cat.includes('grocer')) return '🛒';
  return '📦';
};

const formatCategoryName = (category?: string | null): string => {
  if (!category || !category.trim()) return 'Other';
  const c = category.trim();
  return c.charAt(0).toUpperCase() + c.slice(1);
};

const parseTxnDate = (dateStr?: string | null): Date | null => {
  if (!dateStr) return null;
  try {
    const cleanDate = dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr;
    const d = new Date(cleanDate);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const formatTxnDate = (dateStr?: string | null): string => {
  const d = parseTxnDate(dateStr);
  if (!d) return dateStr || '';
  try {
    return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return dateStr || '';
  }
};

const formatShortDate = (d: Date): string => {
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}`;
};

const toYyyyMmDd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const buildMonthRange = (year: number, month: number): DateRange => {
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const label = start.toLocaleString([], { month: 'long', year: 'numeric' });
  return { startDate: start, endDate: end, label };
};

const HomeScreen = () => {
  const { colors } = useTheme();

  // Dashboard state
  const [owedTotal, setOwedTotal] = useState(0);
  const [allMineSpends, setAllMineSpends] = useState<TransactionRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState<TransactionRow | null>(null);

  // Sorting state (default 'category' as requested)
  const [sortBy, setSortBy] = useState<SortOption>('category');

  // Date navigation & adjustment state
  const now = useMemo(() => new Date(), []);
  const [navYear, setNavYear] = useState<number>(now.getFullYear());
  const [navMonth, setNavMonth] = useState<number>(now.getMonth());
  const [activePreset, setActivePreset] = useState<DatePreset>('this_month');

  // Custom date state
  const [customStartInput, setCustomStartInput] = useState(toYyyyMmDd(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [customEndInput, setCustomEndInput] = useState(toYyyyMmDd(now));
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

  // Date adjustment modal visibility
  const [dateModalVisible, setDateModalVisible] = useState(false);

  // Compute current effective DateRange
  const effectiveDateRange = useMemo<DateRange>(() => {
    const curYear = new Date().getFullYear();
    const curMonth = new Date().getMonth();

    if (activePreset === 'custom' && customRange) {
      return {
        startDate: customRange.start,
        endDate: customRange.end,
        label: `${formatShortDate(customRange.start)} - ${formatShortDate(customRange.end)}`,
      };
    }

    if (activePreset === 'last_month') {
      const start = new Date(curYear, curMonth - 1, 1, 0, 0, 0, 0);
      const end = new Date(curYear, curMonth, 0, 23, 59, 59, 999);
      return {
        startDate: start,
        endDate: end,
        label: start.toLocaleString([], { month: 'long', year: 'numeric' }),
      };
    }

    if (activePreset === 'last_30_days') {
      const today = new Date();
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      return {
        startDate: start,
        endDate: end,
        label: 'Last 30 Days',
      };
    }

    if (activePreset === 'this_year') {
      const start = new Date(curYear, 0, 1, 0, 0, 0, 0);
      const end = new Date(curYear, 11, 31, 23, 59, 59, 999);
      return {
        startDate: start,
        endDate: end,
        label: `Year ${curYear}`,
      };
    }

    if (activePreset === 'all_time') {
      return {
        startDate: new Date(1970, 0, 1),
        endDate: new Date(2099, 11, 31),
        label: 'All Time',
      };
    }

    // Default 'this_month' or Month Navigation
    return buildMonthRange(navYear, navMonth);
  }, [activePreset, navYear, navMonth, customRange]);

  const isCurrentMonth = useMemo(() => {
    const today = new Date();
    return (
      activePreset === 'this_month' &&
      navYear === today.getFullYear() &&
      navMonth === today.getMonth()
    );
  }, [activePreset, navYear, navMonth]);

  // Load dashboard data: Owed to you + My spends (reviewed = 1, type = debit, not split)
  const loadDashboardData = useCallback(async () => {
    try {
      // 1. Owed to you
      const splitRes = await db.execute('SELECT SUM(amount_owed) as total FROM splits WHERE settled = 0');
      const splitRows: any = splitRes.rows;
      const splitArray = splitRows?._array || splitRows || [];
      const totalOwed = splitArray[0]?.total || 0;
      setOwedTotal(totalOwed);

      // 2. All spends marked as mine (debits, reviewed = 1, not split with friends)
      const spendsRes = await db.execute(`
        SELECT * FROM transactions 
        WHERE type = 'debit' 
          AND reviewed = 1 
          AND id NOT IN (SELECT transaction_id FROM splits)
        ORDER BY date DESC
      `);
      const spendRows: any = spendsRes.rows;
      const items: TransactionRow[] = spendRows?._array || spendRows || [];
      setAllMineSpends(items);
    } catch (error) {
      console.error('Failed to load dashboard data', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  }, [loadDashboardData]);

  // Filter spends by effective date range
  const filteredSpends = useMemo(() => {
    const startTime = effectiveDateRange.startDate.getTime();
    const endTime = effectiveDateRange.endDate.getTime();

    return allMineSpends.filter(item => {
      const d = parseTxnDate(item.date);
      if (!d) return false;
      const t = d.getTime();
      return t >= startTime && t <= endTime;
    });
  }, [allMineSpends, effectiveDateRange]);

  // Compute total spent in filtered period
  const totalPeriodSpend = useMemo(() => {
    return filteredSpends.reduce((sum, item) => sum + (item.amount || 0), 0);
  }, [filteredSpends]);

  // Compute category chart data for filtered period
  const chartData = useMemo(() => {
    const categoryTotals: Record<string, number> = {};
    for (const item of filteredSpends) {
      const cat = formatCategoryName(item.category);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (item.amount || 0);
    }

    const chartColors = [colors.primary, colors.accent, '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
    return Object.entries(categoryTotals).map(([label, value], index) => ({
      label,
      value,
      frontColor: chartColors[index % chartColors.length],
    }));
  }, [filteredSpends, colors]);

  // Group / Sort spends based on sortBy
  const groupedSpendsByCategory = useMemo(() => {
    const groupsMap: Record<string, { category: string; icon: string; total: number; txns: TransactionRow[] }> = {};

    for (const item of filteredSpends) {
      const catName = formatCategoryName(item.category);
      if (!groupsMap[catName]) {
        groupsMap[catName] = {
          category: catName,
          icon: getCategoryIcon(item.category),
          total: 0,
          txns: [],
        };
      }
      groupsMap[catName].total += item.amount || 0;
      groupsMap[catName].txns.push(item);
    }

    // Sort categories alphabetically
    return Object.values(groupsMap).sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredSpends]);

  const sortedSpends = useMemo(() => {
    const items = [...filteredSpends];
    if (sortBy === 'date') {
      return items.sort((a, b) => {
        const dateA = parseTxnDate(a.date)?.getTime() || 0;
        const dateB = parseTxnDate(b.date)?.getTime() || 0;
        return dateB - dateA;
      });
    }
    if (sortBy === 'amount') {
      return items.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }
    // sortBy === 'category'
    return items.sort((a, b) => {
      const catA = (a.category || 'other').toLowerCase();
      const catB = (b.category || 'other').toLowerCase();
      if (catA !== catB) return catA.localeCompare(catB);
      const dateA = parseTxnDate(a.date)?.getTime() || 0;
      const dateB = parseTxnDate(b.date)?.getTime() || 0;
      return dateB - dateA;
    });
  }, [filteredSpends, sortBy]);

  // Month navigation handlers
  const handlePrevMonth = () => {
    setActivePreset('this_month');
    setNavMonth(prev => {
      if (prev === 0) {
        setNavYear(y => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setActivePreset('this_month');
    setNavMonth(prev => {
      if (prev === 11) {
        setNavYear(y => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const handleResetCurrentMonth = () => {
    const today = new Date();
    setNavYear(today.getFullYear());
    setNavMonth(today.getMonth());
    setActivePreset('this_month');
  };

  const applyPreset = (preset: DatePreset) => {
    setActivePreset(preset);
    if (preset === 'this_month') {
      const today = new Date();
      setNavYear(today.getFullYear());
      setNavMonth(today.getMonth());
    }
    setDateModalVisible(false);
  };

  const applyCustomDates = () => {
    const startParts = customStartInput.split('-').map(Number);
    const endParts = customEndInput.split('-').map(Number);

    if (startParts.length === 3 && endParts.length === 3) {
      const start = new Date(startParts[0], startParts[1] - 1, startParts[2], 0, 0, 0, 0);
      const end = new Date(endParts[0], endParts[1] - 1, endParts[2], 23, 59, 59, 999);

      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end) {
        setCustomRange({ start, end });
        setActivePreset('custom');
        setDateModalVisible(false);
        return;
      }
    }
    // Fallback if invalid
    applyPreset('this_month');
  };

  // Render individual transaction row
  const renderTxnItem = (item: TransactionRow) => {
    const hasNote = Boolean(item.note && item.note.trim().length > 0);
    // If note is present, show the note NOT merchant name or txn data. Clicking opens detail modal.
    const displayTitle = hasNote ? item.note!.trim() : (item.merchant_raw || item.bank || 'Spend');

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.txnCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setSelectedTxn(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Spend: ${displayTitle}, ₹${item.amount.toFixed(2)}`}
      >
        <View style={styles.txnLeft}>
          <BankIcon bank={item.bank} size={36} />
          <View style={styles.txnContent}>
            <View style={styles.titleRow}>
              {hasNote && (
                <View style={[styles.notePill, { backgroundColor: colors.primary + '18' }]}>
                  <Text style={[styles.notePillText, { color: colors.primary }]}>📝</Text>
                </View>
              )}
              <Text
                style={[
                  styles.txnTitle,
                  { color: colors.text },
                  hasNote && styles.txnTitleNote,
                ]}
                numberOfLines={2}
              >
                {displayTitle}
              </Text>
            </View>

            <View style={styles.txnMetaRow}>
              <Text style={[styles.txnDate, { color: colors.textSecondary }]}>
                {formatTxnDate(item.date)}
              </Text>
              {item.category ? (
                <View style={[styles.categoryTag, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.categoryTagText, { color: colors.textSecondary }]}>
                    {getCategoryIcon(item.category)} {formatCategoryName(item.category)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.txnRight}>
          <Text style={[styles.txnAmount, { color: colors.danger }]}>
            -₹{item.amount.toFixed(2)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.headerBar}>
          <Text style={[styles.header, { color: colors.text }]}>Dashboard</Text>
        </View>

        {/* Date Navigation & Range Control */}
        <View style={[styles.dateNavCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.dateNavBtn, { borderColor: colors.border }]}
            onPress={handlePrevMonth}
            accessibilityLabel="Previous month"
          >
            <Text style={[styles.dateNavBtnText, { color: colors.text }]}>‹</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dateNavCenter}
            onPress={() => setDateModalVisible(true)}
            activeOpacity={0.7}
            accessibilityLabel="Adjust dates"
          >
            <View style={styles.dateNavTitleRow}>
              <Text style={[styles.dateNavTitle, { color: colors.text }]} numberOfLines={1}>
                {effectiveDateRange.label}
              </Text>
              <View style={[styles.adjustPill, { backgroundColor: colors.primary + '18' }]}>
                <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <Line x1="16" y1="2" x2="16" y2="6" />
                  <Line x1="8" y1="2" x2="8" y2="6" />
                  <Line x1="3" y1="10" x2="21" y2="10" />
                </Svg>
                <Text style={[styles.adjustPillText, { color: colors.primary }]}>Adjust</Text>
              </View>
            </View>
            <Text style={[styles.dateNavRangeText, { color: colors.textSecondary }]}>
              {formatShortDate(effectiveDateRange.startDate)} – {formatShortDate(effectiveDateRange.endDate)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dateNavBtn, { borderColor: colors.border }]}
            onPress={handleNextMonth}
            accessibilityLabel="Next month"
          >
            <Text style={[styles.dateNavBtnText, { color: colors.text }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Reset to Current Month Shortcut */}
        {!isCurrentMonth && (
          <TouchableOpacity
            style={[styles.resetMonthBar, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={handleResetCurrentMonth}
            activeOpacity={0.7}
          >
            <Text style={[styles.resetMonthText, { color: colors.primary }]}>
              ↺ Back to Current Month
            </Text>
          </TouchableOpacity>
        )}

        {/* Summary Cards: My Spends & Owed to you */}
        <View style={styles.summaryGrid}>
          <View style={[styles.spendSummaryCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.border }]}>
            <Text style={[styles.spendSummaryLabel, { color: colors.textSecondary }]}>
              My Spends
            </Text>
            <Text style={[styles.spendSummaryAmount, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
              ₹{totalPeriodSpend.toFixed(2)}
            </Text>
            <Text style={[styles.spendSummaryMeta, { color: colors.textSecondary }]}>
              {filteredSpends.length} {filteredSpends.length === 1 ? 'spend' : 'spends'}
            </Text>
          </View>

          <View style={[styles.owedCard, { backgroundColor: colors.primary, shadowColor: colors.primary }]}>
            <Text style={styles.owedLabel}>Owed to you</Text>
            <Text style={styles.owedAmount} numberOfLines={1} adjustsFontSizeToFit>
              ₹{owedTotal.toFixed(2)}
            </Text>
            <Text style={styles.owedMeta}>Friend balances</Text>
          </View>
        </View>

        {/* Spend by Category Chart */}
        <View style={[styles.chartCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.border }]}>
          <View style={styles.chartHeader}>
            <Text style={[styles.chartTitle, { color: colors.text }]}>Spend by Category</Text>
            <Text style={[styles.chartPeriod, { color: colors.textSecondary }]}>
              {effectiveDateRange.label}
            </Text>
          </View>

          {chartData.length > 0 ? (
            <View style={styles.barChartContainer}>
              {chartData.map((item, i) => {
                const maxValue = Math.max(...chartData.map(d => d.value), 1);
                const barHeight = Math.max((item.value / maxValue) * CHART_HEIGHT, 6);
                return (
                  <View key={i} style={styles.barColumn}>
                    <Text style={[styles.barValue, { color: colors.textSecondary }]} numberOfLines={1}>
                      ₹{item.value.toFixed(0)}
                    </Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.bar, { height: barHeight, backgroundColor: item.frontColor }]} />
                    </View>
                    <Text style={[styles.barLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.emptyChart, { color: colors.textSecondary }]}>
              No spends recorded for this period.
            </Text>
          )}
        </View>

        {/* My Spends List Section */}
        <View style={styles.spendsSection}>
          <View style={styles.spendsSectionHeader}>
            <View>
              <Text style={[styles.spendsSectionTitle, { color: colors.text }]}>
                All Spends (Mine)
              </Text>
              <Text style={[styles.spendsSectionSub, { color: colors.textSecondary }]}>
                {filteredSpends.length} {filteredSpends.length === 1 ? 'transaction' : 'transactions'}
              </Text>
            </View>

            {/* Sort Controls */}
            <View style={styles.sortToggleRow}>
              <TouchableOpacity
                style={[
                  styles.sortBtn,
                  sortBy === 'category'
                    ? [styles.sortBtnActive, { backgroundColor: colors.primary }]
                    : [styles.sortBtnInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => setSortBy('category')}
                accessibilityRole="button"
                accessibilityLabel="Sort by Category"
              >
                <Text style={[styles.sortBtnText, sortBy === 'category' ? styles.textWhite : { color: colors.textSecondary }]}>
                  Category
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sortBtn,
                  sortBy === 'date'
                    ? [styles.sortBtnActive, { backgroundColor: colors.primary }]
                    : [styles.sortBtnInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => setSortBy('date')}
                accessibilityRole="button"
                accessibilityLabel="Sort by Date"
              >
                <Text style={[styles.sortBtnText, sortBy === 'date' ? styles.textWhite : { color: colors.textSecondary }]}>
                  Date ↓
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.sortBtn,
                  sortBy === 'amount'
                    ? [styles.sortBtnActive, { backgroundColor: colors.primary }]
                    : [styles.sortBtnInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => setSortBy('amount')}
                accessibilityRole="button"
                accessibilityLabel="Sort by Amount"
              >
                <Text style={[styles.sortBtnText, sortBy === 'amount' ? styles.textWhite : { color: colors.textSecondary }]}>
                  Amount ↓
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Transactions List */}
          {filteredSpends.length === 0 ? (
            <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.emptyBoxTitle, { color: colors.text }]}>No Spends in this Period</Text>
              <Text style={[styles.emptyBoxSub, { color: colors.textSecondary }]}>
                Spends marked as mine during review or daily triage will appear here.
              </Text>
            </View>
          ) : sortBy === 'category' ? (
            /* Grouped by Category */
            groupedSpendsByCategory.map(group => (
              <View key={group.category} style={styles.categoryBlock}>
                <View style={[styles.categoryHeader, { backgroundColor: colors.background }]}>
                  <View style={styles.categoryHeaderLeft}>
                    <Text style={styles.categoryHeaderIcon}>{group.icon}</Text>
                    <Text style={[styles.categoryHeaderTitle, { color: colors.text }]}>
                      {group.category}
                    </Text>
                    <View style={[styles.categoryCountBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.categoryCountText, { color: colors.textSecondary }]}>
                        {group.txns.length}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.categoryHeaderTotal, { color: colors.danger }]}>
                    -₹{group.total.toFixed(2)}
                  </Text>
                </View>
                {group.txns.map(renderTxnItem)}
              </View>
            ))
          ) : (
            /* Plain sorted by Date or Amount */
            sortedSpends.map(renderTxnItem)
          )}
        </View>
      </ScrollView>

      {/* Date Adjustment Modal */}
      <Modal visible={dateModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDateModalVisible(false)}>
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Adjust Spending Period</Text>
            <TouchableOpacity onPress={() => setDateModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.modalCloseText, { color: colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Text style={[styles.modalSectionLabel, { color: colors.textSecondary }]}>Quick Presets</Text>

            <View style={styles.presetsGrid}>
              <TouchableOpacity
                style={[
                  styles.presetChip,
                  activePreset === 'this_month'
                    ? [styles.presetChipActive, { backgroundColor: colors.primary }]
                    : [styles.presetChipInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => applyPreset('this_month')}
              >
                <Text style={[styles.presetChipText, activePreset === 'this_month' ? styles.textWhite : { color: colors.text }]}>
                  This Month
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.presetChip,
                  activePreset === 'last_month'
                    ? [styles.presetChipActive, { backgroundColor: colors.primary }]
                    : [styles.presetChipInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => applyPreset('last_month')}
              >
                <Text style={[styles.presetChipText, activePreset === 'last_month' ? styles.textWhite : { color: colors.text }]}>
                  Last Month
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.presetChip,
                  activePreset === 'last_30_days'
                    ? [styles.presetChipActive, { backgroundColor: colors.primary }]
                    : [styles.presetChipInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => applyPreset('last_30_days')}
              >
                <Text style={[styles.presetChipText, activePreset === 'last_30_days' ? styles.textWhite : { color: colors.text }]}>
                  Last 30 Days
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.presetChip,
                  activePreset === 'this_year'
                    ? [styles.presetChipActive, { backgroundColor: colors.primary }]
                    : [styles.presetChipInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => applyPreset('this_year')}
              >
                <Text style={[styles.presetChipText, activePreset === 'this_year' ? styles.textWhite : { color: colors.text }]}>
                  This Year
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.presetChip,
                  activePreset === 'all_time'
                    ? [styles.presetChipActive, { backgroundColor: colors.primary }]
                    : [styles.presetChipInactive, { borderColor: colors.border, backgroundColor: colors.surface }],
                ]}
                onPress={() => applyPreset('all_time')}
              >
                <Text style={[styles.presetChipText, activePreset === 'all_time' ? styles.textWhite : { color: colors.text }]}>
                  All Time
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />

            <Text style={[styles.modalSectionLabel, { color: colors.textSecondary }]}>Custom Date Range</Text>
            <View style={[styles.customDateCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.customDateRow}>
                <Text style={[styles.customDateLabel, { color: colors.text }]}>From</Text>
                <TextInput
                  style={[styles.customDateInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                  value={customStartInput}
                  onChangeText={setCustomStartInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                  maxLength={10}
                />
              </View>

              <View style={styles.customDateRow}>
                <Text style={[styles.customDateLabel, { color: colors.text }]}>To</Text>
                <TextInput
                  style={[styles.customDateInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                  value={customEndInput}
                  onChangeText={setCustomEndInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textSecondary}
                  maxLength={10}
                />
              </View>

              <TouchableOpacity
                style={[styles.applyCustomBtn, { backgroundColor: colors.primary }]}
                onPress={applyCustomDates}
              >
                <Text style={styles.applyCustomBtnText}>Apply Custom Range</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Transaction Detail Modal - Shows full info on click */}
      <TransactionDetailModal transaction={selectedTxn} onClose={() => setSelectedTxn(null)} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  header: { fontSize: 28, fontWeight: '700' },

  // Date Nav Card
  dateNavCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    elevation: 2,
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  dateNavBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNavBtnText: {
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
  },
  dateNavCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  dateNavTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateNavTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  adjustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  adjustPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  dateNavRangeText: {
    fontSize: 12,
    marginTop: 2,
  },
  resetMonthBar: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
  },
  resetMonthText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Summary Grid
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  spendSummaryCard: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    elevation: 2,
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  spendSummaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  spendSummaryAmount: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  spendSummaryMeta: {
    fontSize: 12,
  },
  owedCard: {
    flex: 1,
    borderRadius: 14,
    padding: 16,
    elevation: 4,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  owedLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  owedAmount: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  owedMeta: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
  },

  // Chart Card
  chartCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    elevation: 2,
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  chartPeriod: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyChart: {
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 36,
  },
  barChartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    width: '100%',
    paddingTop: 8,
  },
  barColumn: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  barValue: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 6,
  },
  barTrack: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
    width: 26,
  },
  bar: {
    width: 26,
    borderRadius: 6,
  },
  barLabel: {
    fontSize: 10,
    marginTop: 8,
    textAlign: 'center',
  },

  // Spends Section
  spendsSection: {
    marginTop: 4,
  },
  spendsSectionHeader: {
    marginBottom: 12,
  },
  spendsSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  spendsSectionSub: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 10,
  },
  sortToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  sortBtnActive: {
    borderColor: 'transparent',
  },
  sortBtnInactive: {},
  sortBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Category Block
  categoryBlock: {
    marginBottom: 16,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  categoryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryHeaderIcon: {
    fontSize: 16,
  },
  categoryHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  categoryCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  categoryCountText: {
    fontSize: 11,
    fontWeight: '600',
  },
  categoryHeaderTotal: {
    fontSize: 14,
    fontWeight: '700',
  },

  // Transaction Card
  txnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  txnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  txnContent: {
    flex: 1,
    marginLeft: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  notePill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  notePillText: {
    fontSize: 11,
  },
  txnTitle: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  txnTitleNote: {
    fontWeight: '700',
  },
  txnMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  txnDate: {
    fontSize: 12,
  },
  categoryTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  categoryTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  txnRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  txnAmount: {
    fontSize: 15,
    fontWeight: '700',
  },

  // Empty State Box
  emptyBox: {
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  emptyBoxTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyBoxSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Date Modal
  modalSafe: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalScroll: {
    padding: 20,
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  presetChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  presetChipActive: {
    borderColor: 'transparent',
  },
  presetChipInactive: {},
  presetChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalDivider: {
    height: 1,
    marginVertical: 16,
  },
  customDateCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  customDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customDateLabel: {
    fontSize: 15,
    fontWeight: '600',
    width: 60,
  },
  customDateInput: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  applyCustomBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyCustomBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  textWhite: {
    color: '#FFFFFF',
  },
});

export default HomeScreen;

