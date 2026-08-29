import { db } from '../db/schema';

export const getSetting = async (key: string): Promise<string | null> => {
  const res = await db.execute('SELECT value FROM app_settings WHERE key = ?', [key]);
  const rows: any = res.rows;
  const arr = rows?._array || rows || [];
  return arr[0]?.value ?? null;
};

export const setSetting = async (key: string, value: string): Promise<void> => {
  await db.execute(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
};
