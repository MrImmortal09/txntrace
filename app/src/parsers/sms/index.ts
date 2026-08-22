import { db } from '../../db/schema';
import * as hdfc from './hdfc';
import * as icici from './icici';
import * as sbi from './sbi';
import * as axis from './axis';
import * as indusind from './indusind';
import * as yesbank from './yesbank';
import * as idfcfirst from './idfcfirst';

export interface RawSMS {
  id: string;
  sender: string;
  body: string;
  receivedAt: string;
}

const PARSERS = [hdfc, icici, sbi, axis, indusind, yesbank, idfcfirst];

export const routeSms = (sender: string, body: string, timestamp: string) => {
  for (const parser of PARSERS) {
    if (parser.canHandle(sender)) {
      return parser.parseSms(body, timestamp);
    }
  }
  return null;
};

// Try all parsers without sender routing — used for clipboard/manual input
export const parseAnySms = (body: string, timestamp: string) => {
  for (const parser of PARSERS) {
    const result = parser.parseSms(body, timestamp);
    if (result) return result;
  }
  return null;
};

export const processSMSBatch = async (messages: RawSMS[]) => {
  if (!messages || messages.length === 0) return;

  console.log(`Processing ${messages.length} SMS messages...`);

  for (const msg of messages) {
    try {
      const date = new Date(msg.receivedAt || Date.now()).toISOString();
      const parsed = routeSms(msg.sender, msg.body, date);

      if (parsed) {
        await db.executeAsync(
          `INSERT OR IGNORE INTO transactions 
            (id, bank, amount, type, merchant_raw, date, source) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [msg.id, parsed.bank, parsed.amount, parsed.type, parsed.merchant, parsed.date, 'sms']
        );
      } else {
        console.log(`No parser found or could not parse SMS from sender: ${msg.sender}`);
      }
    } catch (error) {
      console.error('Failed to process SMS:', error);
    }
  }
};
