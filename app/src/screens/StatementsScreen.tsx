import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import Papa from 'papaparse';
import { BankId, ParsedTransaction } from '../types';
import { extractTextFromPdf } from '../utils/PdfExtractor';
import { parseStatement } from '../parsers/statements';
import { db } from '../db/schema'; // Ensure we can save

const BANKS: { id: BankId; name: string }[] = [
  { id: 'hdfc', name: 'HDFC Bank' },
  { id: 'icici', name: 'ICICI Bank' },
  { id: 'sbi', name: 'State Bank of India' },
  { id: 'axis', name: 'Axis Bank' },
  { id: 'indusind', name: 'IndusInd Bank' },
  { id: 'yesbank', name: 'Yes Bank' },
  { id: 'idfcfirst', name: 'IDFC First Bank' },
];

const StatementsScreen = () => {
  const [selectedBank, setSelectedBank] = useState<BankId | null>(null);
  const [previewData, setPreviewData] = useState<ParsedTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  const handlePickDocument = async () => {
    if (!selectedBank) {
      Alert.alert('Select Bank', 'Please select a bank first.');
      return;
    }

    try {
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.pdf, DocumentPicker.types.csv, DocumentPicker.types.xls, DocumentPicker.types.xlsx],
        presentationStyle: 'fullScreen',
      });

      setLoading(true);

      const isPdf = res.name?.toLowerCase().endsWith('.pdf') || res.type === 'application/pdf';
      const isCsv = res.name?.toLowerCase().endsWith('.csv') || res.type === 'text/csv';
      const isXls = res.name?.toLowerCase().endsWith('.xls') || res.name?.toLowerCase().endsWith('.xlsx');
      
      let rawText = '';
      if (isPdf) {
        rawText = await extractTextFromPdf(res.uri);
      } else if (isCsv || isXls) {
        // Read text content using fetch for local URI
        const response = await fetch(res.uri);
        rawText = await response.text();
        
        // Note: For XLS/XLSX we might need to use `xlsx` library and read as arraybuffer,
        // but for now we fallback to raw text parsing strategy since we rely on `parseStatement`.
        // The parser can use Papa internally if it's CSV.
      } else {
        throw new Error('Unsupported file format');
      }

      const parsedTransactions = parseStatement(selectedBank, rawText, isCsv || isXls);
      
      if (parsedTransactions.length === 0) {
        Alert.alert('No Transactions', 'Could not parse any transactions from this document. (Parser might be a skeleton)');
      }
      
      setPreviewData(parsedTransactions);
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        console.error(err);
        Alert.alert('Error', 'Failed to read document');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToDb = async () => {
    if (previewData.length === 0) return;
    
    try {
      setLoading(true);
      // Example DB insertion, assuming db is available and setupDatabase was called
      // In a real app we'd batch these properly
      for (const txn of previewData) {
        await db.execute(
          `INSERT OR IGNORE INTO transactions 
            (id, bank, amount, type, merchant_raw, date, source, currency) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            txn.transactionHash || String(Date.now() + Math.random()), 
            txn.bankName, 
            txn.amount, 
            txn.type, 
            txn.merchant || '', 
            new Date(txn.timestamp).toISOString(), 
            'statement',
            txn.currency
          ]
        );
      }
      Alert.alert('Success', 'Transactions imported successfully!');
      setPreviewData([]);
    } catch (error) {
      console.error(error);
      Alert.alert('DB Error', 'Failed to save transactions');
    } finally {
      setLoading(false);
    }
  };

  const renderTransaction = ({ item }: { item: ParsedTransaction }) => (
    <View style={styles.txnRow}>
      <Text>{new Date(item.timestamp).toLocaleDateString()}</Text>
      <Text style={styles.merchant}>{item.merchant || 'Unknown'}</Text>
      <Text style={item.type === 'credit' ? styles.credit : styles.debit}>
        {item.type === 'credit' ? '+' : '-'}{item.amount} {item.currency}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Import Statement</Text>
      
      <View style={styles.bankSelector}>
        <Text style={styles.label}>1. Select Bank</Text>
        <FlatList
          horizontal
          data={BANKS}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={[styles.bankButton, selectedBank === item.id && styles.bankButtonSelected]}
              onPress={() => setSelectedBank(item.id)}
            >
              <Text style={selectedBank === item.id ? styles.bankButtonTextSelected : styles.bankButtonText}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <View style={styles.actionSection}>
        <Text style={styles.label}>2. Pick Document</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handlePickDocument} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? 'Processing...' : 'Select File'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.previewSection}>
        <Text style={styles.label}>3. Preview</Text>
        {previewData.length > 0 ? (
          <>
            <FlatList
              data={previewData}
              keyExtractor={(item, index) => String(index)}
              renderItem={renderTransaction}
              style={styles.list}
            />
            <TouchableOpacity style={styles.successButton} onPress={handleSaveToDb} disabled={loading}>
              <Text style={styles.primaryButtonText}>Save to Database</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.emptyText}>No data to preview.</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f9f9f9' },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 8, marginTop: 10 },
  bankSelector: { marginBottom: 20 },
  bankButton: { 
    paddingHorizontal: 16, paddingVertical: 8, 
    borderRadius: 20, backgroundColor: '#e0e0e0', 
    marginRight: 10 
  },
  bankButtonSelected: { backgroundColor: '#007AFF' },
  bankButtonText: { color: '#333' },
  bankButtonTextSelected: { color: '#fff', fontWeight: 'bold' },
  actionSection: { marginBottom: 20 },
  primaryButton: {
    backgroundColor: '#007AFF', padding: 14, borderRadius: 8, alignItems: 'center'
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  successButton: {
    backgroundColor: '#34C759', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 12
  },
  previewSection: { flex: 1 },
  list: { flex: 1, backgroundColor: '#fff', borderRadius: 8 },
  txnRow: { 
    flexDirection: 'row', justifyContent: 'space-between', 
    padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' 
  },
  merchant: { flex: 1, marginHorizontal: 10, color: '#333' },
  credit: { color: '#34C759', fontWeight: 'bold' },
  debit: { color: '#FF3B30', fontWeight: 'bold' },
  emptyText: { color: '#888', fontStyle: 'italic' }
});

export default StatementsScreen;
