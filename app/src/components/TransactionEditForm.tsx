import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Category, loadCategories, updateTransactionDetails } from '../services/transactionEdits';
import type { TransactionRow } from './TransactionDetailModal';

interface Props {
  transaction: TransactionRow;
  onCancel: () => void;
  onSaved: (updated: TransactionRow) => void;
}

// Older rows may hold a category's name rather than its id.
const matches = (stored: string | null, category: Category) =>
  !!stored && (stored === category.id || stored.toLowerCase() === category.name.toLowerCase());

/** Category and note for a spend that's already been cleared, shown inside the detail sheet. */
const TransactionEditForm = ({ transaction, onCancel, onSaved }: Props) => {
  const { colors } = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState(transaction.note ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCategories()
      .then(list => {
        setCategories(list);
        setCategory(list.find(c => matches(transaction.category, c))?.id ?? transaction.category);
      })
      .catch(e => console.error('Failed to load categories:', e));
  }, [transaction.category]);

  const save = async () => {
    setSaving(true);
    const fields = { category, note: note.trim() || null };
    try {
      await updateTransactionDetails(transaction.id, fields);
      onSaved({ ...transaction, ...fields });
    } catch (e: any) {
      console.error('Failed to save transaction edits:', e);
      Alert.alert('Couldn’t save', e?.message || 'Your changes weren’t saved. Try again.');
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>Category</Text>
      <View style={styles.chips}>
        {categories.map(c => {
          const selected = category === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.chip,
                { backgroundColor: selected ? colors.primary : colors.background, borderColor: selected ? colors.primary : colors.border },
              ]}
              // Tapping the picked one again clears it back to Other.
              onPress={() => setCategory(selected ? null : c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>Note</Text>
      <TextInput
        style={[styles.note, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
        value={note}
        onChangeText={setNote}
        placeholder="What was this for?"
        placeholderTextColor={colors.textSecondary}
        multiline
        maxLength={300}
      />

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.cancel, { borderColor: colors.border }]}
          onPress={onCancel}
          disabled={saving}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { marginTop: 8 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: '500' },
  note: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, minHeight: 72, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 20, marginBottom: 4 },
  button: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  cancel: { borderWidth: 1 },
  buttonText: { fontSize: 15, fontWeight: '700' },
});

export default TransactionEditForm;
