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

export const isDebitTransaction = (message: string): boolean => {
  const lowerMsg = message.toLowerCase();
  return lowerMsg.includes('debited') || lowerMsg.includes('spent') || lowerMsg.includes('withdrawn') || lowerMsg.includes('sent') || lowerMsg.includes('paid');
};

export const isCreditTransaction = (message: string): boolean => {
  const lowerMsg = message.toLowerCase();
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
  const match = message.match(/(?:UPI(?:\s*(?:Ref|txn))?|RRN|Ref(?:\s*no\.?)?)[:\-/]?\s*(\d{9,})/i);
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

