// Port of CompiledPatterns.kt

export const AmountPatterns = {
  RS_PATTERN: /Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
  INR_PATTERN: /INR\s*([0-9,]+(?:\.\d{2})?)/i,
  RUPEE_SYMBOL_PATTERN: /₹\s*([0-9,]+(?:\.\d{2})?)/i,
};

export const extractAmount = (message: string): number | null => {
  for (const pattern of Object.values(AmountPatterns)) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].replace(/,/g, '');
      const parsed = parseFloat(amountStr);
      if (!isNaN(parsed)) return parsed;
    }
  }
  return null;
};

/**
 * Currencies a card spend abroad can be billed in. Must match CURRENCIES in
 * server/app/exchange_rates.py: the server only fetches rates for these.
 */
export const FOREIGN_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD', 'CHF', 'HKD', 'THB',
  'MYR', 'CNY', 'SAR', 'NZD', 'SEK', 'NOK', 'DKK', 'KRW', 'IDR', 'PHP', 'VND',
  'QAR', 'KWD', 'OMR', 'BHD', 'LKR', 'NPR', 'BDT', 'ZAR', 'TRY',
];

// Case-sensitive on purpose: banks write the code in capitals, and a
// lower-case "try 2" in a message isn't Turkish lira.
const FOREIGN_AMOUNT_PATTERN = new RegExp(`\\b(${FOREIGN_CURRENCIES.join('|')})\\s?\\.?\\s*(\\d[\\d,]*(?:\\.\\d+)?)`);

// Where a rupee amount starts. Stricter than AmountPatterns on purpose: those
// are unanchored, so "Dear Cardmembers," or "14:05 Hrs," would count as a
// rupee amount sitting before the foreign one. Here "Rs" must start a word
// and be followed by a digit.
const RUPEE_AMOUNT_STARTS = [/\bRs\.?\s*\d/i, /\bINR\s*\d/i, /₹\s*\d/];

const firstRupeeIndex = (message: string): number => {
  const positions = RUPEE_AMOUNT_STARTS.map(pattern => message.search(pattern)).filter(i => i >= 0);
  return positions.length ? Math.min(...positions) : -1;
};

// "USD 100.00 (INR 8,400.00)" or "(approx. INR 8,400.00)": the bank's own
// rupee figure, right after the foreign one.
const BRACKETED_RUPEES =
  /^\s*\(\s*(?:(?:approx(?:imately)?|equiv(?:alent)?(?:\s+to)?|i\.?e\.?|~|≈)\.?\s*)?(?:Rs\.?|INR|₹)\s*(\d[\d,]*(?:\.\d+)?)\s*\)/i;

/**
 * The amount the transaction was made in, and its currency.
 *
 * A spend abroad reads "USD 1.00 spent on your IDFC FIRST Bank Credit Card
 * ... Avbl Limit: INR 79622.02". extractAmount only knows rupees, so it takes
 * the available limit. Banks put the spend before the balance or limit, so a
 * foreign amount that comes before every rupee amount is the spend; one that
 * comes after ("INR 8,312.00 (USD 100.00) spent") is only for information and
 * the rupee figure is what was billed. So is one in brackets right after the
 * foreign amount ("USD 100.00 (INR 8,400.00)"): the bank already converted it,
 * which beats an estimate from the day's rate.
 */
export const extractTransactionAmount = (message: string): { amount: number; currency: string } | null => {
  const foreign = message.match(FOREIGN_AMOUNT_PATTERN);
  if (foreign && foreign.index !== undefined) {
    const rupeeAt = firstRupeeIndex(message);
    // Only when the foreign amount comes first. "Rs.2,000.00 debited ...
    // markup on USD 23.00 (Rs 70.00)" is a ₹2,000 spend, not ₹70.
    if (rupeeAt === -1 || foreign.index < rupeeAt) {
      const billed = message.slice(foreign.index + foreign[0].length).match(BRACKETED_RUPEES);
      if (billed) return { amount: parseFloat(billed[1].replace(/,/g, '')), currency: 'INR' };
      const amount = parseFloat(foreign[2].replace(/,/g, ''));
      if (!isNaN(amount)) return { amount, currency: foreign[1] };
    }
  }
  const inr = extractAmount(message);
  return inr === null ? null : { amount: inr, currency: 'INR' };
};

export const MerchantPatterns = {
  TO_PATTERN: /to\s+([^\.\n]+?)(?:\s+on|\s+at|\s+Ref|\s+UPI)/i,
  FROM_PATTERN: /from\s+([^\.\n]+?)(?:\s+on|\s+at|\s+Ref|\s+UPI)/i,
  AT_PATTERN: /at\s+([^\.\n]+?)(?:\s+on|\s+Ref)/i,
  FOR_PATTERN: /for\s+([^\.\n]+?)(?:\s+on|\s+at|\s+Ref)/i,
};

export const extractMerchant = (message: string, isDebit: boolean): string | null => {
  const patterns = isDebit 
    ? [MerchantPatterns.AT_PATTERN, MerchantPatterns.TO_PATTERN, MerchantPatterns.FOR_PATTERN]
    : [MerchantPatterns.FROM_PATTERN];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return cleanMerchantName(match[1]);
    }
  }
  return null;
};

export const cleanMerchantName = (merchant: string): string => {
  let cleaned = merchant.trim();
  cleaned = cleaned.replace(/\s*\(.*?\)\s*$/, '');
  cleaned = cleaned.replace(/\s+Ref\s+No.*/i, '');
  cleaned = cleaned.replace(/\s+on\s+\d{2}.*/, '');
  cleaned = cleaned.replace(/\s+UPI.*/i, '');
  cleaned = cleaned.replace(/\s+at\s+\d{2}:\d{2}.*/, '');
  cleaned = cleaned.replace(/\s*-\s*$/, '');
  cleaned = cleaned.replace(/(\s+PVT\.?\s*LTD\.?|\s+PRIVATE\s+LIMITED)$/i, '');
  cleaned = cleaned.replace(/(\s+LTD\.?|\s+LIMITED)$/i, '');
  return cleaned.trim();
};

/**
 * Phrases that name a debit or payment that hasn't happened.
 *
 * A card-due reminder — "Total Amount of INR 36,483.00 is due on ICICI Bank Credit
 * Card XX5008. Amount will be debited from Savings Account XX577 on 10-Nov-26.
 * Please ignore if paid." — contains both "debited" and "paid", so the keyword
 * checks below read it as a debit. When the auto-debit does run, the bank sends a
 * separate debit SMS, so counting the reminder would also double the spend.
 *
 * These phrases are blanked rather than used to reject the whole message, so a real
 * alert that only mentions a later step ("Rs 500 debited ... will be credited back")
 * still keeps its past-tense keyword.
 */
const NOT_YET_HAPPENED_PATTERNS = [
  /\bwill\s+be\s+(?:auto[-\s]?)?(?:debited|credited|deducted|charged|paid|sent|received|added|deposited|withdrawn)\b/gi,
  /\b(?:if\s+(?:you\s+have\s+)?)?already\s+paid\b/gi,
  /\bif\s+(?:you\s+have\s+)?paid\b/gi,
];

const withoutPendingPhrases = (message: string): string =>
  NOT_YET_HAPPENED_PATTERNS.reduce((text, pattern) => text.replace(pattern, ' '), message.toLowerCase());

export const isDebitTransaction = (message: string): boolean => {
  const lowerMsg = withoutPendingPhrases(message);
  return lowerMsg.includes('debited') || lowerMsg.includes('spent') || lowerMsg.includes('withdrawn') || lowerMsg.includes('sent') || lowerMsg.includes('paid');
};

export const isCreditTransaction = (message: string): boolean => {
  const lowerMsg = withoutPendingPhrases(message);
  return lowerMsg.includes('credited') || lowerMsg.includes('deposited') || lowerMsg.includes('received') || lowerMsg.includes('added');
};

/**
 * Extracts the bank's own transaction reference (UPI ref / RRN), when present.
 *
 * Some banks send two SMS for one real transaction — e.g. IndusInd sends both a
 * generic debit alert and a UPI-specific one, worded completely differently but
 * sharing the same reference number. A dedupe key built from sender+body (see
 * contentKey in index.ts) treats those as two different transactions; this lets
 * callers key on the reference instead, when one is present.
 *
 * Matches "UPI:660719831342", "RRN:660730856024", and "Ref-UPI/660730856024/...".
 */
export const extractReference = (message: string): string | null => {
  const match = message.match(/(?:UPI(?:\s*(?:Ref|txn))?(?:\s*no\.?)?|RRN|Ref(?:\s*no\.?)?)[:\-/]?\s*(\d{9,})/i);
  return match ? match[1] : null;
};


/**
 * Extracts transaction date from SMS text if present, e.g. "on 29-Aug-26", "on 08/09/2026", "at 08-Sep-26".
 * Returns an ISO timestamp string or null if unparsed.
 */
export const extractDateFromSms = (message: string): string | null => {
  const dateMatch = message.match(/\b(?:on|at)\s+(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{2,4})\b/i);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthStr = dateMatch[2];
    let year = parseInt(dateMatch[3], 10);
    if (year < 100) year += 2000;

    let month = -1;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIdx = months.indexOf(monthStr.toLowerCase());
    if (monthIdx !== -1) {
      month = monthIdx;
    } else {
      const numMonth = parseInt(monthStr, 10);
      if (numMonth >= 1 && numMonth <= 12) month = numMonth - 1;
    }

    if (month !== -1 && day >= 1 && day <= 31) {
      const timeMatch = message.match(/\bat\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\b/i);
      let hours = 12, minutes = 0, seconds = 0;
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        if (timeMatch[3]) seconds = parseInt(timeMatch[3], 10);
      }
      const d = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
  }
  return null;
};

/**
 * Separates any sender prefix (e.g. "VM-HDFCBK:", "Sender: AX-ICICIB\n", "[SBI]") from the message body.
 */
export const extractSenderAndBody = (rawText: string, providedSender?: string): { sender: string; body: string } => {
  let sender = (providedSender || '').trim();
  let body = (rawText || '').trim();

  if (!sender) {
    const colonPrefixMatch = body.match(/^([A-Za-z0-9_-]{2,15}):\s*([\s\S]+)$/);
    if (colonPrefixMatch) {
      sender = colonPrefixMatch[1];
      body = colonPrefixMatch[2].trim();
    } else {
      const senderHeaderMatch = body.match(/^Sender:\s*([^\n]+)\n+([\s\S]+)$/i);
      if (senderHeaderMatch) {
        sender = senderHeaderMatch[1].trim();
        body = senderHeaderMatch[2].trim();
      } else {
        const bracketMatch = body.match(/^\[([A-Za-z0-9\s_-]{2,20})\]\s*([\s\S]+)$/);
        if (bracketMatch) {
          sender = bracketMatch[1].trim();
          body = bracketMatch[2].trim();
        }
      }
    }
  }

  return { sender, body };
};

