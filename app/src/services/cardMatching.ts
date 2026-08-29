export interface Card {
  id: string;
  name: string;
  bank: string | null;
  last4: string | null;
  credit_limit: number | null;
  is_credit_card: number;
  custom_pattern: string | null;
}

/**
 * Pulls the masked account/card reference out of a bank SMS — "A/c XX1234",
 * "Acct XX577", "A/C XXXXXXXX3577", "Card no. **3577", "526873XXXXXX6718".
 * Real examples vary on how many digits show (2 to 4) after the mask run, so
 * this just captures whatever digit run directly follows 2+ mask characters
 * rather than assuming exactly 4 — matchCard below handles the length
 * mismatch when comparing against a user-entered last4.
 */
export const extractLast4 = (body: string): string | null => {
  const match = body.match(/(?:X{2,}|x{2,}|\*{2,})(\d{2,6})/);
  return match ? match[1] : null;
};

const digitsMatch = (extracted: string, configured: string): boolean => {
  const shorter = extracted.length <= configured.length ? extracted : configured;
  const longer = extracted.length <= configured.length ? configured : extracted;
  return longer.endsWith(shorter);
};

/**
 * Custom patterns are checked first and across all cards before falling back
 * to last4 — they exist specifically for the case where last4 alone is
 * ambiguous (two cards sharing the same last digits), so they need to win
 * even if a different card's last4 would otherwise also match.
 */
export const matchCard = (cards: Card[], sender: string, body: string): Card | null => {
  for (const card of cards) {
    if (!card.custom_pattern) continue;
    try {
      if (new RegExp(card.custom_pattern, 'i').test(body) || new RegExp(card.custom_pattern, 'i').test(sender)) {
        return card;
      }
    } catch {
      // an invalid user-entered regex shouldn't crash SMS processing
      continue;
    }
  }

  const extracted = extractLast4(body);
  if (!extracted) return null;

  return cards.find(c => c.last4 && digitsMatch(extracted, c.last4)) || null;
};
