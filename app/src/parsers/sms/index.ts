import { db } from '../../db/schema';
import { extractReference } from './utils';
import { findAliasForName, applySettlement, looksLikePersonName } from '../../services/settlements';
import { matchCard, Card } from '../../services/cardMatching';
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
  /** Which ingestion path delivered this: the Shortcuts automation or the message filter extension. */
  source?: 'shortcut' | 'filter';
}

/**
 * Stable id derived from the message itself rather than the delivery path.
 *
 * The Shortcuts automation and the filter extension can both hand us the same
 * SMS, each with its own generated UUID, so a UUID primary key would let the
 * duplicate through INSERT OR IGNORE. Bank bodies carry a reference number and
 * running balance, so sender+body is effectively unique; the day bucket guards
 * the rare case of a genuinely identical body being re-delivered later.
 */
export const contentKey = (sender: string, body: string, isoDate: string): string => {
  const day = isoDate.slice(0, 10);
  const normalized = `${sender.trim().toUpperCase()}|${body.replace(/\s+/g, ' ').trim()}|${day}`;

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `sms_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};

const PARSERS = [hdfc, icici, sbi, axis, indusind, yesbank, idfcfirst];

/**
 * Guard for the sender-less fallback path.
 *
 * A "catch every message" Shortcuts automation also hands us personal messages,
 * and those can contain an amount plus a word like "paid" — enough for a parser
 * to invent a transaction. Requiring a banking marker as well keeps the review
 * queue from filling with chat.
 */
const BANK_MARKERS = /\b(a\/c|acct|account|avl\s*bal|available\s*bal|upi|imps|neft|rtgs|ref\s*no|txn|card\s*(no|ending|xx)|debited|credited|xx\d{2,}|x{2,}\d{2,})\b/i;

export const looksLikeBankSms = (body: string): boolean => BANK_MARKERS.test(body);

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

  // Fetched once per batch rather than per message — the registry is small
  // and configured on the web app, so re-querying it per SMS would just be
  // wasted work.
  const cardsRes = await db.execute('SELECT * FROM cards');
  const cardRows: any = cardsRes.rows;
  const cards: Card[] = cardRows?._array || cardRows || [];

  for (const msg of messages) {
    try {
      const date = new Date(msg.receivedAt || Date.now()).toISOString();

      // Shortcuts does not always give us a usable sender (an automation can fire
      // with it empty). First fallback: most bank SMS name the bank somewhere in
      // the body too ("...UPI:660887017514-ICICI Bank."), so re-run the same
      // canHandle checks against the body text itself before giving up on
      // routing by bank at all — this is what actually recovers the right bank
      // with no sender, rather than just picking whichever parser's generic
      // amount/debit-credit wording happens to match first. Only if *that* also
      // fails does it fall through to trying every parser blind, and only when
      // the body reads like a bank SMS at all.
      const parsed =
        routeSms(msg.sender, msg.body, date) ??
        routeSms(msg.body, msg.body, date) ??
        (looksLikeBankSms(msg.body) ? parseAnySms(msg.body, date) : null);

      // Every distinct message body gets its own log row, even if it turns out to
      // duplicate another message's transaction — the log is the audit trail, and
      // collapsing it here would hide the exact duplicate-wording cases (see below)
      // that this dedup logic exists to catch.
      const logKey = contentKey(msg.sender, msg.body, date);

      // Some banks send two differently-worded SMS for the same real transaction
      // (e.g. IndusInd sends a generic debit alert and a separate UPI-specific one).
      // Those have different bodies, so logKey treats them as unrelated — but they
      // share the bank's own reference number, so prefer that as the transactions
      // table's key whenever one can be found, falling back to logKey otherwise.
      const reference = extractReference(msg.body);
      const txnKey = reference ? `sms_ref_${reference}` : logKey;

      if (parsed) {
        const card = matchCard(cards, msg.sender, msg.body);

        // Raw sender/body are kept alongside the parsed fields — not for display,
        // but so a bad extraction (wrong merchant, wrong amount) can be diagnosed
        // and re-parsed later without needing the message to still exist on-device.
        const insertResult = await db.execute(
          `INSERT OR IGNORE INTO transactions
            (id, bank, amount, type, merchant_raw, date, source, sender, sms_body, reference, card_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [txnKey, parsed.bank, parsed.amount, parsed.type, parsed.merchant, parsed.date, 'sms', msg.sender, msg.body, reference, card?.id ?? null]
        );

        // Only run friend-matching on a row that was actually just inserted —
        // rowsAffected is 0 when INSERT OR IGNORE skipped a duplicate (same
        // reference number seen twice), and re-running settlement against a
        // transaction already processed would mark a second split settled for
        // money that was only ever received once.
        if (insertResult.rowsAffected > 0 && parsed.type === 'credit' && looksLikePersonName(parsed.merchant)) {
          const alias = await findAliasForName(parsed.merchant!);
          if (alias) {
            await applySettlement(alias.contact_id, alias.contact_name, parsed.amount, txnKey);
          } else {
            await db.execute('UPDATE transactions SET needs_contact_match = 1 WHERE id = ?', [txnKey]);
          }
        }
      } else {
        console.log(`No parser found or could not parse SMS from sender: ${msg.sender}`);
      }

      // Logged unconditionally — a failed parse is the case most worth seeing
      // later, since it never produces a transaction row to inspect otherwise.
      await db.execute(
        `INSERT OR IGNORE INTO sms_log
          (id, sender, body, received_at, source, status, bank, amount, type, merchant, reference, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logKey,
          msg.sender,
          msg.body,
          date,
          msg.source ?? 'unknown',
          parsed ? 'parsed' : 'unparsed',
          parsed?.bank ?? null,
          parsed?.amount ?? null,
          parsed?.type ?? null,
          parsed?.merchant ?? null,
          reference,
          new Date().toISOString(),
        ]
      );
    } catch (error) {
      console.error('Failed to process SMS:', error);
    }
  }
};
