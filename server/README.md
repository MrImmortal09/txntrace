# TxnTrace Server

A single deployable FastAPI app: it serves both the statement-import web UI and the JSON API the mobile app syncs from. No separate frontend build or deployment — this is the whole thing.

- Upload a PDF/CSV/Excel bank statement, review the parsed rows, import them.
- Browse all transactions; click one for full details (date, bank, reference, balance, raw message, etc.).
- The mobile app pulls newly-imported transactions from here via **Settings → Sync from Web**.

Storage is a single SQLite file at `data/txntrace.sqlite` — no external database to set up.

## Run locally

```sh
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`. For the phone to sync, it needs to reach this machine's IP (not `localhost`) on the same network — find it with `ipconfig getifaddr en0` (Wi-Fi) on macOS, then enter e.g. `http://192.168.1.10:8000` in the app's Settings screen.

## Deploy to your own server

```sh
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run it under whatever process manager you prefer (systemd, supervisor, a `screen`/`tmux` session, or behind nginx as a reverse proxy). `data/` holds the SQLite file — back that directory up; it's the only state that matters.

## Statement parsing: generic, not bank-specific

Unlike the mobile app's SMS parsers (which are tuned against real bank message samples), the statement parser here works off column-name and layout heuristics — it looks for headers like "Date", "Narration"/"Description", "Debit"/"Withdrawal", "Credit"/"Deposit", "Balance" in CSV/XLSX, and a date-plus-amount pattern per line in PDFs with no extractable table. It hasn't been validated against real bank statement exports yet. If a statement doesn't parse well, the fix is almost always adjusting the header-matching keywords or date formats in `app/parsing.py` — send over a real (redacted) sample and it can be tuned the same way the SMS parsers were.

## API

- `POST /api/statements/parse` — multipart file upload, returns parsed rows (not yet saved).
- `POST /api/transactions` — commits `{bank, rows}` to the database; re-importing the same statement is a no-op (rows are deduped by bank+date+amount+type+description).
- `GET /api/transactions` — all transactions, newest first.
- `GET /api/transactions/export?since=<ISO timestamp>` — transactions created after `since`; this is what the mobile app calls.
