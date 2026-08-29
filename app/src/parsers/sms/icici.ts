import { extractAmount, extractMerchant, cleanMerchantName, isDebitTransaction, isCreditTransaction } from './utils';

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

  // "Dear Customer, Acct XX577 is credited with Rs 1.00 on 29-Aug-26 from Mr ANURAG
  // YADAV. UPI:..." — the shared FROM_PATTERN in utils.ts requires whitespace right
  // before the "UPI" boundary word, but ICICI puts a period there ("YADAV. UPI:"),
  // so it never matches and merchant falls through to "Unknown ICICI Merchant".
  const creditFromMatch = body.match(/from\s+([^.\n]+?)\.\s*UPI/i);
  if (creditFromMatch) merchant = cleanMerchantName(creditFromMatch[1]);

  // "ICICI Bank Acct XX577 debited for Rs 225.76 on 29-Aug-26; CONNAUGHT PLAZA
  // credited." — a UPI payment OUT, where the payee's name sits between the ";"
  // and "credited" rather than after "to/at/for", so none of the debit patterns
  // in utils.ts apply either.
  const debitToMatch = body.match(/;\s*([^.\n]+?)\s+credited/i);
  if (debitToMatch) merchant = cleanMerchantName(debitToMatch[1]);

  return {
    amount,
    type: isDebit ? 'debit' : 'credit',
    merchant: merchant,
    date: timestamp,
    bank: 'ICICI Bank'
  };
};
