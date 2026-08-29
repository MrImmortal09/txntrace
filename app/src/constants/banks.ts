import {
  HDFC_LOGO_SVG,
  ICICI_LOGO_SVG,
  SBI_LOGO_SVG,
  AXIS_LOGO_SVG,
  INDUSIND_LOGO_SVG,
  YESBANK_LOGO_SVG,
  IDFCFIRST_LOGO_SVG,
} from '../assets/bankLogos';

/**
 * Mirrors server/app/bank_styles.py — keep both in sync if a bank is added or
 * a logo/color changes. `color` is only used as the fallback badge color for
 * an unrecognized bank, where there's no real logo to show.
 */
export interface BankStyle {
  id: string;
  name: string;
  code: string;
  color: string;
  logo: string | null;
}

export const BANKS: BankStyle[] = [
  { id: 'hdfc', name: 'HDFC Bank', code: 'HDFC', color: '#004C8F', logo: HDFC_LOGO_SVG },
  { id: 'icici', name: 'ICICI Bank', code: 'ICICI', color: '#F37021', logo: ICICI_LOGO_SVG },
  { id: 'sbi', name: 'State Bank of India', code: 'SBI', color: '#2D2A81', logo: SBI_LOGO_SVG },
  { id: 'axis', name: 'Axis Bank', code: 'AXIS', color: '#97144D', logo: AXIS_LOGO_SVG },
  { id: 'indusind', name: 'IndusInd Bank', code: 'INDUS', color: '#B7202E', logo: INDUSIND_LOGO_SVG },
  { id: 'yesbank', name: 'Yes Bank', code: 'YES', color: '#00A19B', logo: YESBANK_LOGO_SVG },
  { id: 'idfcfirst', name: 'IDFC First Bank', code: 'IDFC', color: '#C99A2E', logo: IDFCFIRST_LOGO_SVG },
];

export const FALLBACK_BANK: BankStyle = { id: 'other', name: 'Other', code: '?', color: '#6B7280', logo: null };

/** Bank is stored as a free-text display name (e.g. "HDFC Bank"), so this
 * matches by substring rather than expecting an exact id — same reasoning as
 * bank_style_for() on the server side. */
export const bankStyleFor = (bankName: string | null | undefined): BankStyle => {
  if (!bankName) return FALLBACK_BANK;
  const lower = bankName.toLowerCase();
  const match = BANKS.find(b => lower.includes(b.id) || lower.includes(b.name.toLowerCase()));
  return match || FALLBACK_BANK;
};
