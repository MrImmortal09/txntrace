import { deleteServerAccount, getAuthToken, setAuthToken } from '../src/services/webSync';

const settingsStore: Record<string, string> = {};
jest.mock('../src/services/appSettings', () => ({
  getSetting: jest.fn(async (key: string) => settingsStore[key] ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    settingsStore[key] = value;
  }),
  deleteSettings: jest.fn(async (keys: string[]) => {
    keys.forEach(k => delete settingsStore[k]);
  }),
}));

jest.mock('../src/db/schema', () => ({ db: { execute: jest.fn() } }));

const originalFetch = (globalThis as any).fetch;

const respond = (status: number, body: any = {}) =>
  ((globalThis as any).fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })));

describe('Delete Account', () => {
  beforeEach(async () => {
    Object.keys(settingsStore).forEach(k => delete settingsStore[k]);
    await setAuthToken('test_jwt_token');
    settingsStore.web_sync_last_created_at = '2026-10-01T00:00:00Z';
    settingsStore.web_sync_last_split_created_at = '2026-10-01T00:00:00Z';
    settingsStore.web_sync_last_settlement_created_at = '2026-10-01T00:00:00Z';
    settingsStore.theme = 'dark';
  });

  afterAll(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('deletes the account on the server and signs the phone out of web sync', async () => {
    const fetchMock = respond(200, { deleted: true });

    await deleteServerAccount();

    expect(fetchMock).toHaveBeenCalledWith('https://txn.axiosiiitl.dev/api/account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test_jwt_token' },
    });
    expect(await getAuthToken()).toBeNull();
    // Sync positions go too, so the next sign-in pulls everything again
    expect(settingsStore).toEqual({ theme: 'dark' });
  });

  it('keeps the sign-in when the server fails, so the user can try again', async () => {
    respond(500, { detail: 'Database unavailable' });

    await expect(deleteServerAccount()).rejects.toThrow('Database unavailable');
    expect(await getAuthToken()).toBe('test_jwt_token');
    expect(settingsStore.web_sync_last_created_at).toBe('2026-10-01T00:00:00Z');
  });

  it('signs out and asks to sign in again when the server rejects the token', async () => {
    respond(401, { detail: 'Account not found. Sign in again.' });

    await expect(deleteServerAccount()).rejects.toThrow('Sign in again, then delete your account.');
    expect(await getAuthToken()).toBeNull();
  });

  it('does nothing without a sign-in', async () => {
    delete settingsStore.web_sync_auth_token;
    const fetchMock = respond(200);

    await expect(deleteServerAccount()).rejects.toThrow('Not authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
