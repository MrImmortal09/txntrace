import { useCallback, useEffect, useRef, useState } from 'react';
import Contacts, { Contact } from 'react-native-contacts';
import { requestContactsAccess } from './permissions';

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
  // Only the latest ask may set state; an answer for a picker that has since
  // closed is dropped.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ask = ++latest.current;
    setAllowed(null);
    // Never rejects: a failed request counts as not allowed.
    const granted = await requestContactsAccess();
    let list: Contact[] = [];
    if (granted) {
      try {
        list = await Contacts.getAll();
      } catch (error) {
        console.error('Failed to load contacts:', error);
      }
    }
    if (ask !== latest.current) return;
    setContacts(list);
    setAllowed(granted);
  }, []);

  useEffect(() => {
    if (!open) {
      latest.current++;
      return;
    }
    setContacts([]);
    load();
  }, [open, load]);

  return { contacts, allowed, retry: load };
};
