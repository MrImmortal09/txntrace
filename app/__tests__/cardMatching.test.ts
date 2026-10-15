import { Card, extractLast4, matchCard } from '../src/services/cardMatching';

// Real alerts, amounts and refs as received.
const HDFC_SWIGGY =
  'Spent Rs.460 On HDFC Bank Card 0904 At PTM*SWIGGY IN On 2026-10-12:01:55:33.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 0904 to 7308080808';
const SBI_CARD =
  'Rs.140.00 spent on your SBI Credit Card XX9684 at MSJEETRESTAURENT on 07-10-26 via UPI (Ref No. 664620942025). Trxn. not done by you? Report at https://sbicard.com/Dispute';
const ICICI_CARD =
  'ICICI Bank Credit Card XX3008 debited for INR 293.00 on 04-Sep-26 for UPI-661312948976-APOLLO. To dispute call 18001080/SMS BLOCK 3008 to 9215676766';
const IDFC_CARD = 'INR 250.00 spent on your IDFC FIRST Bank Credit Card ending XX1234 at SWIGGY on 10-OCT-26';

const card = (id: string, last4: string, custom_pattern: string | null = null): Card => ({
  id,
  name: id,
  bank: null,
  last4,
  credit_limit: null,
  is_credit_card: 1,
  custom_pattern,
});

describe('extractLast4', () => {
  it('reads masked card digits', () => {
    expect(extractLast4(SBI_CARD)).toBe('9684');
    expect(extractLast4(ICICI_CARD)).toBe('3008');
    expect(extractLast4(IDFC_CARD)).toBe('1234');
    expect(extractLast4('Rs 500 debited from A/c XX5678 on 01-Oct-26')).toBe('5678');
  });

  it('reads bare digits after "Card" when there is no mask', () => {
    expect(extractLast4(HDFC_SWIGGY)).toBe('0904');
    expect(extractLast4('Spent Rs.250.00 From HDFC Bank Card x1234 At SWIGGY On 2026-10-10:12:34:56')).toBe('1234');
    expect(extractLast4('Spent Rs. 450.00 at Starbucks on HDFC Bank Card ending 4321 on 14-Sep-26.')).toBe('4321');
    expect(extractLast4('Rs.99 spent on SBI Credit Card ending with 7788 at AMAZON')).toBe('7788');
  });

  it('does not take amounts, references or full card numbers as the last 4', () => {
    expect(extractLast4('Rs.1234 spent at SHOP on 10-Oct-26. Ref 556677889900')).toBeNull();
    expect(extractLast4('Your card 4111111111111111 was used')).toBeNull();
    expect(extractLast4('Pay your credit card bill of Rs.2000 by 15-Oct')).toBeNull();
  });
});

describe('matchCard with several cards', () => {
  const cards = [card('sbi_cashback', '5521'), card('sbi_other', '9684'), card('hdfc_swiggy', '0904'), card('icici', '3008')];

  it('links each alert to the card with its own digits, not just any card from the same bank', () => {
    expect(matchCard(cards, 'HDFCBK', HDFC_SWIGGY)?.id).toBe('hdfc_swiggy');
    expect(matchCard(cards, 'SBICRD', SBI_CARD)?.id).toBe('sbi_other');
    expect(matchCard(cards, 'ICICIT', ICICI_CARD)?.id).toBe('icici');
  });

  it('leaves an alert unlinked when no configured card has its digits', () => {
    expect(matchCard([card('sbi_cashback', '5521')], 'SBICRD', SBI_CARD)).toBeNull();
  });
});
