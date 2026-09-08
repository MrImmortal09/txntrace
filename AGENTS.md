# Agent Guidelines for TxnTrace

Welcome! This document defines operational standards, branch policies, and development guidelines for AI agents working in this repository.

---

## 🚀 Branch & Git Workflow (Important)

- **Directly commit to `main` (Preferred)** or create a Pull Request.
- Pushing directly to `main` triggers the automated CI/CD workflows:
  - **iOS Build & Signed Release**: Automatically builds, signs with ad-hoc certificate/provisioning profile, creates IPA, and publishes an OTA installable release on GitHub Releases.
  - **Server Deployment**: Automatically deploys the backend server on pushes touching `server/**`.
- Write concise, conventional commit messages:
  - `feat(...)`: New features or capabilities
  - `fix(...)`: Bug fixes
  - `chore(...)`: Dependency updates, build configs, or maintenance
  - `docs(...)`: Documentation changes

---

## 🏗️ Repository Architecture

### 1. Mobile App (`app/`)
- **Framework**: React Native 0.87 (React 19, TypeScript).
- **Database**: Local-first SQLite database via `@op-engineering/op-sqlite` (`txntrace.sqlite`).
- **Navigation**:
  - `Home`: Dashboard and spending summary.
  - `Daily`: "Needs Review" queue for unreviewed transactions, with quick split action, confirm action, and manual SMS paste (`+` button).
  - `Review`: Card-by-card swipe review interface.
  - `Friends`: Split balances and contact settlement tracking.
  - `More`: Settings, Statements, and SMS Logs.
- **SMS Parsers** (`app/src/parsers/sms/`):
  - Supported Indian banks: HDFC, ICICI, SBI, Axis, IndusInd, Yes Bank, IDFC First.
  - Ingestion mechanisms:
    - iOS Shortcuts Automation via `IngestSMSIntent.swift` & `SharedSMSStore`.
    - Manual paste via `PasteSMSModal` on the Daily screen (`ingestManualSMS`).
  - Deduplication: Handled via bank reference numbers (`extractReference`) and content hashing (`contentKey`).
- **Statement Parsers** (`app/src/parsers/statements/`):
  - Bank statement PDF/CSV/Excel ingestion.

### 2. Backend Server (`server/`)
- Python backend for remote sync, cards export, and server-side processing.

---

## 🛠️ Development & Coding Rules

1. **Verify Code Before Committing**:
   - Verify TypeScript types, component imports, and syntax.
   - Do not commit broken code to `main`.

2. **Theming**:
   - Always use the shared theme system (`useTheme()` from `src/theme/ThemeProvider`).
   - Avoid hardcoding colors like `#fff` or `#000` for background/text. Use `colors.background`, `colors.surface`, `colors.text`, `colors.textSecondary`, `colors.border`, etc., so both Light and Dark modes render properly.

3. **Database Schema & Migrations**:
   - SQLite table definitions reside in `app/src/db/schema.ts`.
   - When adding new columns, always use a migration wrapped in `try/catch` (e.g. `ALTER TABLE transactions ADD COLUMN ...`) since SQLite lacks `ADD COLUMN IF NOT EXISTS`.

4. **Preserve SMS Parsing Integrity**:
   - Do not loosen or break bank parsing regexes without verifying against real sample SMS formats across banks.
   - Always log incoming SMS messages into `sms_log` table (status `'parsed'` or `'unparsed'`) for diagnostic auditability.
