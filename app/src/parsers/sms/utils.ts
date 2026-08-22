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
