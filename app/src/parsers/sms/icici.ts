import { extractAmount, extractMerchant, isDebitTransaction, isCreditTransaction } from './utils';

export const canHandle = (sender: string): boolean => {
  return sender.toUpperCase().includes('ICICI');
};

export const parseSms = (body: string, timestamp: string) => {
  const amount = extractAmount(body);
  if (amount === null) return null;

  const isDebit = isDebitTransaction(body);
  const isCredit = isCreditTransaction(body);
  
  if (!isDebit && !isCredit) return null;

  let merchant = extractMerchant(body, isDebit) || 'Unknown ICICI Merchant';

  // Specific ICICI overrides
  if (body.toLowerCase().includes('info-')) {
    const infoMatch = body.match(/Info-([^\.\n]+)/i);
    if (infoMatch) merchant = infoMatch[1].trim();
  }

  return {
    amount,
    type: isDebit ? 'debit' : 'credit',
    merchant: merchant,
    date: timestamp,
    bank: 'ICICI Bank'
  };
};
