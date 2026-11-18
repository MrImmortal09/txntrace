import { extractTransactionAmount, extractMerchant, isDebitTransaction, isCreditTransaction } from './utils';

export const canHandle = (sender: string): boolean => {
  return sender.toUpperCase().includes('IDFC');
};

export const parseSms = (body: string, timestamp: string) => {
  const money = extractTransactionAmount(body);
  if (money === null) return null;

  const isDebit = isDebitTransaction(body);
  const isCredit = isCreditTransaction(body);
  
  if (!isDebit && !isCredit) return null;

  let merchant = extractMerchant(body, isDebit) || 'Unknown IDFC First Merchant';

  return {
    amount: money.amount,
    currency: money.currency,
    type: isDebit ? 'debit' : 'credit',
    merchant: merchant,
    date: timestamp,
    bank: 'IDFC First Bank'
  };
};
