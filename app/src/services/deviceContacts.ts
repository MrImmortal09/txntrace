import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Contacts, { Contact } from 'react-native-contacts';
import { hasContactsAccess, requestContactsAccess } from './permissions';

/** The list, and whether iOS shares only some contacts ("Limited Access"). */
const readContacts = async (granted: boolean): Promise<{ list: Contact[]; limited: boolean }> => {
  if (!granted) return { list: [], limited: false };
  let list: Contact[] = [];
  try {
    list = await Contacts.getAll();
  } catch (error) {
    console.error('Failed to load contacts:', error);
  }
  // Separate, so a failed status check only loses the note, never the list.
  let limited = false;
  try {
    limited = (await Contacts.checkPermission()) === 'limited';
  } catch {
    limited = false;
  }
  return { list, limited };
};

export const contactName = (c: Contact) => c.displayName || `${c.givenName || ''} ${c.familyName || ''}`.trim();

/**
 * Most recently split-with first (recency from loadSplitRecency), then
 * alphabetical, so regulars don't get buried in a phone-wide contact list.
 */
export const sortByRecentSplit = (contacts: Contact[], recency: Record<string, string>) =>
  [...contacts].sort((a, b) => {
    const aUsed = recency[a.recordID];
    const bUsed = recency[b.recordID];
    if (aUsed && bUsed) return bUsed.localeCompare(aUsed);
    if (aUsed) return -1;
    if (bUsed) return 1;
    return contactName(a).localeCompare(contactName(b));
  });

/**
 * The phone's contacts for a picker, asked for each time it opens. `allowed`
 * is null until that's answered, so the picker shows nothing in the meantime
 * rather than the last opening's list or a flash of "access is off". `retry`
 * asks again, for the picker's Allow button.
 */
export const useDeviceContacts = (open: boolean) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // iOS "Limited Access": only the contacts the user picked are visible, and
  // the picker can't add more itself, so it points to Settings instead.
  const [limited, setLimited] = useState(false);
  // Only the latest ask may set state; an answer for a picker that has since
  // closed is dropped.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ask = ++latest.current;
    setAllowed(null);
    // Never rejects: a failed request counts as not allowed.
    const granted = await requestContactsAccess();
    const { list, limited: isLimited } = await readContacts(granted);
    if (ask !== latest.current) return;
    setContacts(list);
    setAllowed(granted);
    setLimited(isLimited);
  }, []);

  // Back from Settings (where the limited-access note and the refused-access
  // alert send people): show what's shared now. Checks without asking, so a
  // refusal doesn't bring the alert straight back.
  useEffect(() => {
    if (!open) return;
    const sub = AppState.addEventListener('change', async state => {
      if (state !== 'active') return;
      const ask = ++latest.current;
      const granted = await hasContactsAccess();
      const { list, limited: isLimited } = await readContacts(granted);
      if (ask !== latest.current) return;
      setContacts(list);
      setAllowed(granted);
      setLimited(isLimited);
    });
    return () => sub.remove();
  }, [open]);

  useEffect(() => {
    if (!open) {
      latest.current++;
      return;
    }
    setContacts([]);
    load();
  }, [open, load]);

  return { contacts, allowed, limited, retry: load };
};
