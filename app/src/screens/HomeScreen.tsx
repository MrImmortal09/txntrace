import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { BarChart } from 'react-native-gifted-charts';
import { db } from '../db/schema';

const HomeScreen = () => {
  const [owedTotal, setOwedTotal] = useState(0);
  const [chartData, setChartData] = useState<{ label: string; value: number; frontColor: string }[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [])
  );

  const loadDashboardData = async () => {
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
      const colors = ['#FF9500', '#34C759', '#007AFF', '#FF3B30', '#AF52DE', '#FF2D55'];
      
      const formattedData = items.map((item: any, index: number) => ({
        label: item.category || 'Unknown',
        value: item.total || 0,
        frontColor: colors[index % colors.length],
      }));

      setChartData(formattedData);
    } catch (error) {
      console.error('Failed to load dashboard data', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>Dashboard</Text>

        <View style={styles.owedCard}>
          <Text style={styles.owedLabel}>Owed to you</Text>
          <Text style={styles.owedAmount}>₹{owedTotal.toFixed(2)}</Text>
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>This Week's Spend</Text>
          {chartData.length > 0 ? (
            <BarChart
              data={chartData}
              width={300}
              height={200}
              barWidth={35}
              spacing={20}
              hideRules
              xAxisThickness={0}
              yAxisThickness={0}
              yAxisTextStyle={{ color: '#888' }}
              xAxisLabelTextStyle={{ color: '#888', textAlign: 'center' }}
              noOfSections={4}
            />
          ) : (
            <Text style={styles.emptyChart}>No spend data for this week.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  scrollContent: { padding: 20 },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 20, color: '#333' },
  owedCard: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#007AFF',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 5,
  },
  owedLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 16, marginBottom: 8 },
  owedAmount: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 2,
    alignItems: 'center',
  },
  chartTitle: { fontSize: 18, fontWeight: '600', color: '#333', alignSelf: 'flex-start', marginBottom: 20 },
  emptyChart: { color: '#aaa', fontStyle: 'italic', marginVertical: 40 },
});

export default HomeScreen;
