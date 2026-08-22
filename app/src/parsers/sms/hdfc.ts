import { extractAmount, extractMerchant, isDebitTransaction, isCreditTransaction } from './utils';

export const canHandle = (sender: string): boolean => {
  return sender.toUpperCase().includes('HDFC');
};

export const parseSms = (body: string, timestamp: string) => {
  const amount = extractAmount(body);
  if (amount === null) return null;

  const isDebit = isDebitTransaction(body);
  const isCredit = isCreditTransaction(body);
  
  if (!isDebit && !isCredit) return null;

  let merchant = extractMerchant(body, isDebit) || 'Unknown HDFC Merchant';

  // HDFC specific merchant parsing
  if (body.toLowerCase().includes('spent rs.') && body.toLowerCase().includes('from hdfc bank card') && body.toLowerCase().includes(' at ') && body.toLowerCase().includes(' on ')) {
    const atIndex = body.toLowerCase().indexOf(' at ');
    const onIndex = body.toLowerCase().indexOf(' on ');
    if (atIndex !== -1 && onIndex !== -1 && onIndex > atIndex) {
      merchant = body.substring(atIndex + 4, onIndex).trim();
    }
  }

  return {
    amount,
    type: isDebit ? 'debit' : 'credit',
    merchant: merchant,
    date: timestamp,
    bank: 'HDFC Bank'
  };
};
