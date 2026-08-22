# PennyWise AI — reference source (MIT licensed)

Pulled directly from https://github.com/sarim2000/pennywiseai-tracker
(parser-core module) on 2026-08-20. Original project by sarim2000, MIT license —
keep attribution in your repo's NOTICE/README when you port this.

## What's here

Root level — shared base logic all banks inherit:
- `BankParser.kt` — abstract base: transaction-message filtering (skips OTP,
  promo, "payment request", "is due" reminders), generic amount/account/
  balance/merchant extraction, card detection, merchant name cleaning.
- `BaseIndianBankParser.kt` — India-specific defaults on top of BankParser.
- `CompiledPatterns.kt` — the shared regex library (Amount, Account, Balance,
  Merchant, Cleaning, Date/Time patterns) reused across every bank parser.
  THIS is the highest-value file to port first — almost everything else
  builds on it.
- `ParsedTransaction.kt`, `TransactionType.kt`, `MandateInfo.kt`, `Constants.kt`
  — core data model.
- `BankParserFactory.kt` / `BankParserRegistry.kt` — how an incoming sender ID
  gets routed to the right bank parser.

`bank/` — one file per target bank:
- HDFCBankParser.kt, ICICIBankParser.kt, SBIBankParser.kt, AxisBankParser.kt,
  IndusIndBankParser.kt, YesBankParser.kt, IDFCFirstBankParser.kt

## Porting notes (Kotlin → TypeScript regex)

- `Regex("""...""", RegexOption.IGNORE_CASE)` → `/.../ i`
- `RegexOption.DOT_MATCHES_ALL` → `s` flag
- Kotlin `.find(str)` → JS `.exec(str)`, `match.groupValues[1]` → `match[1]`
- Kotlin `.matches(regex)` (full-string match) → JS needs `^...$` anchors + `.test()`
- Triple-quoted raw strings need no changes to the regex body itself — copy the
  pattern between the `"""..."""` directly into a JS `/.../ ` literal.

## Structure to preserve when porting

Each bank parser overrides, in this order of importance:
1. `canHandle(sender)` — the DLT sender-ID routing (e.g. `^[A-Z]{2}-HDFCBK-S$`)
2. `extractMerchant(message, sender)` — the bank-specific merchant heuristics
   (VPA parsing, NEFT/RTGS company extraction, salary detection, ATM location)
3. `isTransactionMessage(message)` — usually just extends the base skip-list
   with a couple of bank-specific keywords (see HDFC's version for the pattern)

Keep this same layering in TypeScript: a shared base module + one file per bank
that only overrides what's actually different.
