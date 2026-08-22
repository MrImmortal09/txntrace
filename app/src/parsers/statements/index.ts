import { BankId, ParsedTransaction } from '../../types';
import { parseStatement as parseHdfc } from './hdfc';
import { parseStatement as parseIcici } from './icici';
import { parseStatement as parseSbi } from './sbi';
import { parseStatement as parseAxis } from './axis';
import { parseStatement as parseIndusind } from './indusind';
import { parseStatement as parseYesbank } from './yesbank';
import { parseStatement as parseIdfcfirst } from './idfcfirst';

export const parseStatement = (bankId: BankId, rawText: string, isCsv: boolean): ParsedTransaction[] => {
  switch (bankId) {
    case 'hdfc': return parseHdfc(rawText, isCsv);
    case 'icici': return parseIcici(rawText, isCsv);
    case 'sbi': return parseSbi(rawText, isCsv);
    case 'axis': return parseAxis(rawText, isCsv);
    case 'indusind': return parseIndusind(rawText, isCsv);
    case 'yesbank': return parseYesbank(rawText, isCsv);
    case 'idfcfirst': return parseIdfcfirst(rawText, isCsv);
    default: return [];
  }
};
