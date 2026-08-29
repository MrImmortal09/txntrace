import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';

const CHART_HEIGHT = 140;

const HomeScreen = () => {
  const { colors } = useTheme();
  const [owedTotal, setOwedTotal] = useState(0);
  const [chartData, setChartData] = useState<{ label: string; value: number; frontColor: string }[]>([]);

  const loadDashboardData = useCallback(async () => {
    try {
      // Owed to you
      const splitRes = await db.execute('SELECT SUM(amount_owed) as total FROM splits WHERE settled = 0');
      const splitRows: any = splitRes.rows;
      const splitArray = splitRows?._array || splitRows || [];
      const totalOwed = splitArray[0]?.total || 0;
      setOwedTotal(totalOwed);

      // Weekly spend by category
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const isoDateStr = sevenDaysAgo.toISOString();

      const spendRes = await db.execute(
        `SELECT category, SUM(amount) as total 
         FROM transactions 
         WHERE type = 'debit' AND date >= ? 
         GROUP BY category`,
        [isoDateStr]
      );

      const spendRows: any = spendRes.rows;
      const items = spendRows?._array || spendRows || [];
      const chartColors = [colors.primary, colors.accent, '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
      
      const formattedData = items.map((item: any, index: number) => ({
        label: item.category || 'Unknown',
        value: item.total || 0,
        frontColor: chartColors[index % chartColors.length],
      }));

      setChartData(formattedData);
    } catch (error) {
      console.error('Failed to load dashboard data', error);
    }
  }, [colors]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.header, { color: colors.text }]}>Dashboard</Text>

        <View style={[styles.owedCard, { backgroundColor: colors.primary, shadowColor: colors.primary }]}>
          <Text style={styles.owedLabel}>Owed to you</Text>
          <Text style={styles.owedAmount}>₹{owedTotal.toFixed(2)}</Text>
        </View>

        <View style={[styles.chartCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow }]}>
          <Text style={[styles.chartTitle, { color: colors.text }]}>This Week's Spend</Text>
          {chartData.length > 0 ? (
            <View style={styles.barChartContainer}>
              {chartData.map((item, i) => {
                const maxValue = Math.max(...chartData.map(d => d.value), 1);
                const barHeight = Math.max((item.value / maxValue) * CHART_HEIGHT, 4);
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
            <Text style={[styles.emptyChart, { color: colors.textSecondary }]}>No spend data for this week.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20 },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 20 },
  owedCard: {
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 8,
  },
  owedLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 16, marginBottom: 8, fontWeight: '500' },
  owedAmount: { color: '#fff', fontSize: 36, fontWeight: '700' },
  chartCard: {
    borderRadius: 16,
    padding: 20,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
    alignItems: 'center',
  },
  chartTitle: { fontSize: 18, fontWeight: '600', alignSelf: 'flex-start', marginBottom: 20 },
  emptyChart: { fontStyle: 'italic', marginVertical: 40 },
  barChartContainer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', width: '100%', paddingTop: 8 },
  barColumn: { alignItems: 'center', flex: 1, minWidth: 0 },
  barValue: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
  barTrack: { height: CHART_HEIGHT, justifyContent: 'flex-end', width: 28 },
  bar: { width: 28, borderRadius: 6 },
  barLabel: { fontSize: 11, marginTop: 8, textAlign: 'center' },
});

export default HomeScreen;
