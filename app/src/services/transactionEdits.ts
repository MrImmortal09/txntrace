import { db } from '../db/schema';

export interface Category {
  id: string;
  name: string;
}

export const loadCategories = async (): Promise<Category[]> => {
  const res = await db.execute('SELECT id, name FROM categories ORDER BY name');
  const rows: any = res.rows;
  return rows?._array || rows || [];
};

/**
 * What a spend can still be corrected on after it's cleared from the queue.
 * The merchant name isn't editable: Re-parse Stored Messages re-derives it
 * from the SMS, which would quietly undo a rename.
 */
export const updateTransactionDetails = async (
  id: string,
  fields: { category: string | null; note: string | null }
): Promise<void> => {
  await db.execute('UPDATE transactions SET category = ?, note = ?, updated_at = ? WHERE id = ?', [
    fields.category,
    fields.note,
    new Date().toISOString(),
    id,
  ]);
};
