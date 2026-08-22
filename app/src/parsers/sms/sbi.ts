import { extractAmount, extractMerchant, isDebitTransaction, isCreditTransaction } from './utils';

export const canHandle = (sender: string): boolean => {
  return sender.toUpperCase().includes('SBI');
};

export const parseSms = (body: string, timestamp: string) => {
  const amount = extractAmount(body);
  if (amount === null) return null;

  const isDebit = isDebitTransaction(body);
  const isCredit = isCreditTransaction(body);
  
  if (!isDebit && !isCredit) return null;

  let merchant = extractMerchant(body, isDebit) || 'Unknown SBI Merchant';

  // SBI Specific UPI overrides
  if (body.toLowerCase().includes('upi/')) {
    const upiMatch = body.match(/UPI\/(?:CRADJ\/)?(?:P2A\/)?([^/]+)/i);
    if (upiMatch) merchant = upiMatch[1].trim();
  }

  return {
    amount,
    type: isDebit ? 'debit' : 'credit',
    merchant: merchant,
    date: timestamp,
    bank: 'SBI'
  };
};
