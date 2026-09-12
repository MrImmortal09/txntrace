import { db } from '../../db/schema';
import { extractReference, extractDateFromSms, extractSenderAndBody } from './utils';
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
  /** Which ingestion path delivered this: the Shortcuts automation, the message filter extension, or manual paste. */
  source?: 'shortcut' | 'filter' | 'manual';
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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

      let location: string | null = msg.location ? msg.location.trim() : null;
      let latitude: number | null =
        msg.latitude !== undefined && msg.latitude !== null && !isNaN(msg.latitude) ? Number(msg.latitude) : null;
      let longitude: number | null =
        msg.longitude !== undefined && msg.longitude !== null && !isNaN(msg.longitude) ? Number(msg.longitude) : null;

      // If location is provided as "lat, lng" text, parse coordinates
      if (location && (latitude === null || longitude === null)) {
        const coordMatch = location.match(/^([-+]?\d{1,2}(?:\.\d+)?),\s*([-+]?\d{1,3}(?:\.\d+)?)$/);
        if (coordMatch) {
          latitude = parseFloat(coordMatch[1]);
          longitude = parseFloat(coordMatch[2]);
        }
      }

      if (parsed) {
        const card = matchCard(cards, msg.sender, msg.body);

        // Raw sender/body are kept alongside the parsed fields — not for display,
        // but so a bad extraction (wrong merchant, wrong amount) can be diagnosed
        // and re-parsed later without needing the message to still exist on-device.
        const insertResult = await db.execute(
          `INSERT OR IGNORE INTO transactions
            (id, bank, amount, type, merchant_raw, date, source, sender, sms_body, reference, card_id, location, latitude, longitude)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            txnKey,
            parsed.bank,
            parsed.amount,
            parsed.type,
            parsed.merchant,
            parsed.date,
            'sms',
            msg.sender,
            msg.body,
            reference,
            card?.id ?? null,
            location,
            latitude,
            longitude,
          ]
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
          (id, sender, body, received_at, source, status, bank, amount, type, merchant, reference, logged_at, location)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          location,
        ]
      );
    } catch (error) {
      console.error('Failed to process SMS:', error);
    }
  }
};

export interface IngestManualSMSParams {
  body: string;
  sender?: string;
  bank?: string;
}

export interface IngestManualSMSResult {
  success: boolean;
  duplicate?: boolean;
  transaction?: {
    id: string;
    bank: string;
    amount: number;
    type: 'debit' | 'credit';
    merchant: string | null;
    date: string;
  };
  error?: string;
}

export const previewParsedSMS = (rawBody: string, rawSender?: string, bankOverride?: string) => {
  const trimmed = (rawBody || '').trim();
  if (!trimmed) {
    return null;
  }

  const { sender: detectedSender, body } = extractSenderAndBody(trimmed, rawSender);
  const effectiveSender = bankOverride || detectedSender;
  const normalizedBody = body.replace(/\s+/g, ' ').trim();
  const now = new Date().toISOString();
  const date = extractDateFromSms(body) || now;

  let parsed: any = null;
  if (bankOverride) {
    parsed = routeSms(bankOverride, body, date) ?? routeSms(bankOverride, normalizedBody, date);
  }

  if (!parsed) {
    parsed =
      routeSms(effectiveSender, body, date) ??
      routeSms(body, body, date) ??
      routeSms(effectiveSender, normalizedBody, date) ??
      routeSms(normalizedBody, normalizedBody, date) ??
      parseAnySms(body, date) ??
      parseAnySms(normalizedBody, date);
  }

  const reference = extractReference(body) || extractReference(normalizedBody);

  return {
    sender: effectiveSender,
    body,
    date,
    reference,
    parsed,
  };
};

export const ingestManualSMS = async (params: IngestManualSMSParams): Promise<IngestManualSMSResult> => {
  if (!params.body || !params.body.trim()) {
    return { success: false, error: 'Please enter or paste an SMS message.' };
  }

  const { sender: detectedSender, body } = extractSenderAndBody(params.body, params.sender);
  const effectiveSender = params.bank || detectedSender;
  const normalizedBody = body.replace(/\s+/g, ' ').trim();
  const now = new Date().toISOString();
  const date = extractDateFromSms(body) || now;

  let parsed: any = null;
  if (params.bank) {
    parsed = routeSms(params.bank, body, date) ?? routeSms(params.bank, normalizedBody, date);
  }

  if (!parsed) {
    parsed =
      routeSms(effectiveSender, body, date) ??
      routeSms(body, body, date) ??
      routeSms(effectiveSender, normalizedBody, date) ??
      routeSms(normalizedBody, normalizedBody, date) ??
      parseAnySms(body, date) ??
      parseAnySms(normalizedBody, date);
  }

  const reference = extractReference(body) || extractReference(normalizedBody);
  const logKey = contentKey(effectiveSender, body, date);
  const txnKey = reference ? `sms_ref_${reference}` : logKey;

  if (!parsed) {
    // Log as unparsed so there's an audit trail in sms_log
    try {
      await db.execute(
        `INSERT OR IGNORE INTO sms_log
          (id, sender, body, received_at, source, status, bank, amount, type, merchant, reference, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logKey,
          effectiveSender,
          body,
          date,
          'manual',
          'unparsed',
          null,
          null,
          null,
          null,
          reference,
          now,
        ]
      );
    } catch (e) {
      console.error('Failed to log unparsed manual SMS:', e);
    }

    return {
      success: false,
      error: 'Could not extract transaction details. Make sure the message includes an amount (e.g. Rs 500) and debit/credit status.',
    };
  }

  try {
    const cardsRes = await db.execute('SELECT * FROM cards');
    const cardRows: any = cardsRes.rows;
    const cards: Card[] = cardRows?._array || cardRows || [];
    const card = matchCard(cards, effectiveSender, body);

    // Check if already exists in transactions
    const existingRes = await db.execute(
      'SELECT id, bank, amount, type, merchant_raw, date FROM transactions WHERE id = ?',
      [txnKey]
    );
    const existingRows: any = existingRes.rows;
    const existingArr = existingRows?._array || existingRows || [];
    if (existingArr.length > 0) {
      const existingTxn = existingArr[0];
      return {
        success: true,
        duplicate: true,
        transaction: {
          id: existingTxn.id,
          bank: existingTxn.bank,
          amount: existingTxn.amount,
          type: existingTxn.type,
          merchant: existingTxn.merchant_raw,
          date: existingTxn.date,
        },
      };
    }

    const insertResult = await db.execute(
      `INSERT OR IGNORE INTO transactions
        (id, bank, amount, type, merchant_raw, date, source, sender, sms_body, reference, card_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sms', ?, ?, ?, ?, ?, ?)`,
      [
        txnKey,
        parsed.bank,
        parsed.amount,
        parsed.type,
        parsed.merchant,
        parsed.date,
        effectiveSender,
        body,
        reference,
        card?.id ?? null,
        now,
        now,
      ]
    );

    if (insertResult.rowsAffected > 0 && parsed.type === 'credit' && looksLikePersonName(parsed.merchant)) {
      const alias = await findAliasForName(parsed.merchant!);
      if (alias) {
        await applySettlement(alias.contact_id, alias.contact_name, parsed.amount, txnKey);
      } else {
        await db.execute('UPDATE transactions SET needs_contact_match = 1 WHERE id = ?', [txnKey]);
      }
    }

    await db.execute(
      `INSERT OR IGNORE INTO sms_log
        (id, sender, body, received_at, source, status, bank, amount, type, merchant, reference, logged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logKey,
        effectiveSender,
        body,
        date,
        'manual',
        'parsed',
        parsed.bank,
        parsed.amount,
        parsed.type,
        parsed.merchant,
        reference,
        now,
      ]
    );

    return {
      success: true,
      duplicate: false,
      transaction: {
        id: txnKey,
        bank: parsed.bank,
        amount: parsed.amount as number,
        type: parsed.type as 'debit' | 'credit',
        merchant: parsed.merchant,
        date: parsed.date,
      },
    };
  } catch (error: any) {
    console.error('Failed to ingest manual SMS:', error);
    return {
      success: false,
      error: error?.message || 'Failed to save transaction to database.',
    };
  }
};

