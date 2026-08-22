export type TransactionType = 'debit' | 'credit';

export interface ParsedTransaction {
  amount: number;
  type: TransactionType;
  merchant: string | null;
  reference: string | null;
  accountLast4: string | null;
  balance: number | null;
  creditLimit?: number | null;
  smsBody?: string;
  sender?: string;
  timestamp: number;
  bankName: string;
  transactionHash?: string | null;
  isFromCard: boolean;
  currency: string;
  fromAccount?: string | null;
  toAccount?: string | null;
  isMobileWallet?: boolean;
}

export type BankId = 
  | 'hdfc' 
  | 'icici' 
  | 'sbi' 
  | 'axis' 
  | 'indusind' 
  | 'yesbank' 
  | 'idfcfirst';
