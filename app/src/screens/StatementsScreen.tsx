import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DocumentPicker from 'react-native-document-picker';
import { BankId, ParsedTransaction } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { extractTextFromPdf } from '../utils/PdfExtractor';
import { parseStatement } from '../parsers/statements';
import { CreditCard, loadCreditCards } from '../services/creditCards';
import { PlannedRow, previewStatementImport, saveStatementImport } from '../services/statementImport';
import { formatRupees, formatShortDate } from '../services/rewards/engine';

const BANKS: { id: BankId; name: string }[] = [
  { id: 'hdfc', name: 'HDFC Bank' },
  { id: 'icici', name: 'ICICI Bank' },
  { id: 'sbi', name: 'State Bank of India' },
  { id: 'axis', name: 'Axis Bank' },
  { id: 'indusind', name: 'IndusInd Bank' },
  { id: 'yesbank', name: 'Yes Bank' },
  { id: 'idfcfirst', name: 'IDFC First Bank' },
];

/** First word of the bank name ("IDFC", "HDFC") — enough to pre-pick the matching card. */
const bankWord = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0]?.toLowerCase() || '';

/** iOS-only prompt, which is fine: PDF extraction is only implemented natively on iOS. */
const askPassword = (message: string): Promise<string | null> =>
  new Promise(resolve =>
    Alert.prompt(
      'Statement password',
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Open', onPress: (value?: string) => resolve(value || null) },
      ],
      'secure-text'
    )
  );

/** Asks for the password until the PDF opens or the user gives up. */
const readPdf = async (uri: string): Promise<string | null> => {
  let password: string | undefined;
  for (;;) {
    try {
      return await extractTextFromPdf(uri, password);
    } catch (e: any) {
      if (e?.code !== 'ERR_PDF_LOCKED' && e?.code !== 'ERR_PDF_PASSWORD') throw e;
      const next = await askPassword(
        e.code === 'ERR_PDF_PASSWORD'
          ? 'That password didn\'t work. Try again.'
          : 'This statement is locked. Banks usually use part of your name plus your date of birth — check the statement email.'
      );
      if (next === null) return null;
      password = next;
    }
  }
};

const StatementsScreen = () => {
  const { colors } = useTheme();
  const [selectedBank, setSelectedBank] = useState<BankId | null>(null);
  const [cards, setCards] = useState<CreditCard[]>([]);
  // undefined = not chosen yet; null = not a credit card (bank account statement).
  const [cardId, setCardId] = useState<string | null | undefined>(undefined);
  const [plan, setPlan] = useState<PlannedRow[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadCreditCards()
        .then(setCards)
        .catch(e => console.error('Failed to load cards:', e));
    }, [])
  );

  const bankName = BANKS.find(b => b.id === selectedBank)?.name || '';

  const pickBank = (id: BankId) => {
    setSelectedBank(id);
    setPlan([]);
    const word = bankWord(BANKS.find(b => b.id === id)?.name);
    const matching = cards.filter(c => bankWord(c.bank) === word || bankWord(c.name) === word);
    setCardId(matching.length === 1 ? matching[0].id : undefined);
  };

  const handlePickDocument = async () => {
    if (!selectedBank) {
      Alert.alert('Select bank', 'Pick the bank first.');
      return;
    }
    if (cardId === undefined) {
      Alert.alert('Select card', 'Pick which card this statement is for, or "Bank account".');
      return;
    }

    try {
      const res = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.pdf, DocumentPicker.types.csv, DocumentPicker.types.xls, DocumentPicker.types.xlsx],
        presentationStyle: 'fullScreen',
        // A local copy, so the native PDF reader isn't blocked by the picker's security-scoped URL.
        copyTo: 'cachesDirectory',
      });
      const uri = res.fileCopyUri || res.uri;

      setLoading(true);
      const lowerName = res.name?.toLowerCase() || '';
      const isPdf = lowerName.endsWith('.pdf') || res.type === 'application/pdf';
      const isCsv = lowerName.endsWith('.csv') || res.type === 'text/csv';
      const isXls = lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx');

      let rawText: string | null = '';
      if (isPdf) {
        rawText = await readPdf(uri);
        if (rawText === null) return;
      } else if (isCsv || isXls) {
        const response = await fetch(uri);
        rawText = await response.text();
      } else {
        throw new Error('Unsupported file format');
      }

      const parsed: ParsedTransaction[] = parseStatement(selectedBank, rawText, !!(isCsv || isXls));
      if (parsed.length === 0) {
        Alert.alert('No transactions found', `Couldn't read any transactions from this ${bankName} statement.`);
      }
      setPlan(await previewStatementImport(parsed, cardId, bankName));
    } catch (err) {
      if (!DocumentPicker.isCancel(err)) {
        console.error(err);
        Alert.alert('Error', 'Failed to read the document.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (cardId === undefined) return;
    try {
      setLoading(true);
      const added = await saveStatementImport(plan, cardId);
      Alert.alert('Imported', added === 0 ? 'Everything on this statement was already tracked.' : `Added ${added} transaction${added === 1 ? '' : 's'}.`);
      setPlan([]);
    } catch (error) {
      console.error(error);
      Alert.alert('Could not save', 'Failed to save transactions.');
    } finally {
      setLoading(false);
    }
  };

  const newCount = plan.filter(p => !p.matchedId).length;

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, { color: active ? '#fff' : colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderRow = ({ item }: { item: PlannedRow }) => {
    const { row, matchedId } = item;
    const isCredit = row.type === 'credit';
    return (
      <View style={[styles.txnRow, { borderBottomColor: colors.border }, matchedId ? styles.dimmed : null]}>
        <View style={styles.txnMain}>
          <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={1}>
            {row.merchant || 'Unknown'}
          </Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {formatShortDate(new Date(row.timestamp))}
            {matchedId ? ' · already tracked' : ' · new'}
          </Text>
        </View>
        <Text style={[styles.amount, { color: isCredit ? colors.success : colors.text }]}>
          {isCredit ? '+' : ''}
          {formatRupees(row.amount, 2)}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.header, { color: colors.text }]}>Import Statement</Text>

      <Text style={[styles.label, { color: colors.text }]}>1. Bank</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {BANKS.map(b => chip(b.id, b.name, selectedBank === b.id, () => pickBank(b.id)))}
      </ScrollView>

      <Text style={[styles.label, { color: colors.text }]}>2. Card</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {cards.map(c => chip(c.id, `${c.name}${c.last4 ? ` ••${c.last4}` : ''}`, cardId === c.id, () => (setCardId(c.id), setPlan([]))))}
        {chip('none', 'Bank account', cardId === null, () => (setCardId(null), setPlan([])))}
      </ScrollView>

      <TouchableOpacity
        style={[styles.primaryButton, { backgroundColor: colors.primary }, loading && styles.dimmed]}
        onPress={handlePickDocument}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>{loading ? 'Processing…' : '3. Select statement file'}</Text>
      </TouchableOpacity>

      <View style={styles.previewSection}>
        {plan.length > 0 ? (
          <>
            <Text style={[styles.summary, { color: colors.textSecondary }]}>
              {newCount} new · {plan.length - newCount} already tracked from SMS
            </Text>
            <FlatList
              data={plan}
              keyExtractor={item => item.id}
              renderItem={renderRow}
              style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}
            />
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.success }, (loading || newCount === 0) && styles.dimmed]}
              onPress={handleSave}
              disabled={loading || newCount === 0}
            >
              <Text style={styles.primaryButtonText}>{newCount === 0 ? 'Nothing new to add' : `Add ${newCount} transaction${newCount === 1 ? '' : 's'}`}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Spends already tracked from SMS are skipped, so importing only fills in what was missed.
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 12 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: 8, marginTop: 8 },
  chips: { gap: 8, paddingBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  primaryButton: { padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  dimmed: { opacity: 0.5 },
  previewSection: { flex: 1, marginTop: 12 },
  summary: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  list: { flex: 1, borderRadius: 10, borderWidth: 1 },
  txnRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  txnMain: { flex: 1, marginRight: 10 },
  merchant: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700' },
  emptyText: { fontSize: 13, lineHeight: 19 },
});

export default StatementsScreen;
