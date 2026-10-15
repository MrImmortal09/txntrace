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
 * Some card alerts print the digits with no mask run at all — HDFC's "Spent
 * Rs.460 On HDFC Bank Card 0904 At ...", "Card x1234", "Card ending in 4321",
 * "Card number 1234". Only taken when:
 * - the card is what paid ("on/from/using/via/with ... Card"), so a bank-side
 *   debit *towards* a card bill ("debited from your account towards Credit
 *   Card 5678") isn't booked as card spend;
 * - it's a lone 4-digit group, so neither an amount/reference nor the first
 *   group of a spaced-out card number ("Card 4628 XXXX XXXX 3001") is taken.
 */
const BARE_CARD_DIGITS =
  /\b(?:on|from|using|via|with)\s+(?:your\s+)?(?:(?!(?:towards|to|for)\b)[a-z]+\s+){0,4}card\s+(?:(?:no|num|number)\b\.?:?\s*|ending\s+(?:(?:with|in)\s+)?)?[xX*]?(\d{4})\b(?![\s-]*(?:[xX*]{2,}|\d))/i;

/**
 * Pulls the masked account/card reference out of a bank SMS — "A/c XX1234",
 * "Acct XX577", "A/C XXXXXXXX3577", "Card no. **3577", "526873XXXXXX6718".
 * Real examples vary on how many digits show (2 to 4) after the mask run, so
 * this just captures whatever digit run directly follows 2+ mask characters
 * rather than assuming exactly 4 — matchCard below handles the length
 * mismatch when comparing against a user-entered last4.
 */
export const extractLast4 = (body: string): string | null => {
  const masked = body.match(/(?:X{2,}|x{2,}|\*{2,})(\d{2,6})/);
  if (masked) return masked[1];
  const bare = body.match(BARE_CARD_DIGITS);
  return bare ? bare[1] : null;
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
