"""
Generic bank-statement parsing: CSV, XLSX/legacy XLS, and PDF.

Unlike the SMS parsers in the mobile app (app/src/parsers/sms/*.ts), there are
no bank-specific templates here — this works off column-name and layout
heuristics, tuned against real statement exports (SBI card PDF, HDFC card PDF,
HDFC pipe-delimited CSV, an HDFC "xls" that's secretly modern xlsx, and a real
bank-account history export in genuine legacy binary xls via JasperReports).
Every quirk handled below — the header row sitting 15+ rows deep, comma-
separated dates, amounts with an embedded "Dr./Cr." suffix, a single
Debit/Credit indicator column instead of two amount columns, a non-comma CSV
delimiter — came from one of those real files, not guesswork. A new bank
format may still need a new quirk added here.
"""

import csv
import io
import re
from datetime import datetime
from typing import Any

import openpyxl
import pdfplumber
import xlrd
from dateutil import parser as dateutil_parser

DATE_KEYS = ["date"]
DESC_KEYS = ["narration", "description", "particular", "remark", "details", "transaction"]
DEBIT_KEYS = ["debit", "withdrawal", "withdrawn"]
CREDIT_KEYS = ["credit", "deposit"]
AMOUNT_KEYS = ["amount", "amt"]
BALANCE_KEYS = ["balance"]
DRCR_KEYS = ["dr/cr", "cr/dr", "indicator"]

AMOUNT_CLEAN_RE = re.compile(r"[^\d.\-]")
EMBEDDED_DRCR_RE = re.compile(r"\b(dr|cr)\b\.?\s*$", re.IGNORECASE)
# "01,06,2026" (day,month,year) — dateutil silently mis-parses this as today's
# date instead of raising, defaulting the day it can't extract from the comma
# tokenization to the system's current day. Comma-separated numeric dates need
# to become slash-separated before reaching dateutil, or dates corrupt silently.
COMMA_DATE_RE = re.compile(r"\b(\d{1,2}),(\d{1,2}),(\d{4})\b")

# How many leading rows to scan for the real column-header row before giving
# up. Real exports have had anywhere from 0 (clean CSV) to 16 rows (an XLSX
# with a full account-summary block above the transaction table) of preamble.
HEADER_SEARCH_ROWS = 60


def _find_col(headers: list[str], keys: list[str], claimed: set[str] | None = None) -> str | None:
    claimed = claimed or set()
    for h in headers:
        if h in claimed:
            continue
        low = h.lower().strip()
        if any(k in low for k in keys):
            return h
    return None


def _is_drcr_indicator_header(header: str) -> bool:
    """A header naming BOTH debit and credit together (e.g. "Debit /Credit",
    "Dr/Cr", "Type") indicates a column, not an amount column — as opposed to
    "Withdrawal Amt", which names only one side and does hold an amount.
    """
    low = header.lower()
    has_debit_word = any(k in low for k in DEBIT_KEYS)
    has_credit_word = any(k in low for k in CREDIT_KEYS)
    if has_debit_word and has_credit_word:
        return True
    return any(k in low for k in DRCR_KEYS)


def _normalize_date_string(raw: str) -> str:
    return COMMA_DATE_RE.sub(r"\1/\2/\3", raw)


def _parse_amount(raw: Any) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Strip a trailing "Dr."/"Cr." suffix before the digit-cleanup below —
    # its period would otherwise survive as a second decimal point (turning
    # "677.04 Dr." into "677.04.", which float() rejects). A bare "50 Dr."
    # only "worked" before this fix by accident: "50." alone is valid float
    # syntax, which masked the bug for whole-number amounts.
    s = EMBEDDED_DRCR_RE.sub("", s).strip()
    negative = s.startswith("(") and s.endswith(")")
    cleaned = AMOUNT_CLEAN_RE.sub("", s)
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return -abs(value) if negative else value


def _embedded_direction(raw: Any) -> str | None:
    """Detects "677.04 Dr." / "70913.95 Cr." style amounts where the direction
    is a suffix on the same value rather than a separate column."""
    if raw is None:
        return None
    match = EMBEDDED_DRCR_RE.search(str(raw))
    if not match:
        return None
    return "debit" if match.group(1).lower() == "dr" else "credit"


def _parse_date(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.isoformat()
    s = _normalize_date_string(str(raw).strip())
    if not s:
        return None
    try:
        return dateutil_parser.parse(s, dayfirst=True).isoformat()
    except (ValueError, OverflowError):
        return None


def rows_from_dicts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Applies the header-matching heuristic to already-tabular rows (from CSV or XLSX)."""
    if not rows:
        return []

    headers = list(rows[0].keys())

    # An indicator column (holds only "Dr"/"Cr"/blank, paired with a separate
    # amount column) must be identified before a bare debit/credit-amount
    # column search runs, or a header like "Debit /Credit" gets misread as a
    # dedicated debit-amount column purely because it contains "debit".
    drcr_col = next((h for h in headers if _is_drcr_indicator_header(h)), None)
    claimed = {drcr_col} if drcr_col else set()

    date_col = _find_col(headers, DATE_KEYS, claimed)
    desc_col = _find_col(headers, DESC_KEYS, claimed | {date_col or ""})
    debit_col = _find_col(headers, DEBIT_KEYS, claimed)
    credit_col = _find_col(headers, CREDIT_KEYS, claimed | {debit_col or ""})
    amount_col = None if (debit_col or credit_col) else _find_col(headers, AMOUNT_KEYS, claimed)
    balance_col = _find_col(headers, BALANCE_KEYS, claimed)

    results = []
    for row in rows:
        date_iso = _parse_date(row.get(date_col)) if date_col else None
        if not date_iso:
            continue

        debit_val = _parse_amount(row.get(debit_col)) if debit_col else None
        credit_val = _parse_amount(row.get(credit_col)) if credit_col else None
        amount_raw = row.get(amount_col) if amount_col else None
        amount_val = _parse_amount(amount_raw)
        balance_val = _parse_amount(row.get(balance_col)) if balance_col else None

        amount, txn_type = None, None
        if debit_val:
            amount, txn_type = abs(debit_val), "debit"
        elif credit_val:
            amount, txn_type = abs(credit_val), "credit"
        elif amount_val is not None:
            embedded = _embedded_direction(amount_raw)
            if embedded:
                amount, txn_type = abs(amount_val), embedded
            elif drcr_col:
                indicator = str(row.get(drcr_col, "")).strip().lower()
                amount, txn_type = abs(amount_val), ("credit" if indicator[:2] == "cr" else "debit")
            else:
                amount, txn_type = abs(amount_val), ("credit" if amount_val > 0 else "debit")

        if amount is None or txn_type is None:
            continue

        results.append(
            {
                "date": date_iso,
                "merchant": (str(row.get(desc_col)).strip() if desc_col and row.get(desc_col) else None),
                "amount": amount,
                "type": txn_type,
                "balance": balance_val,
                "raw": {k: (str(v) if v is not None else None) for k, v in row.items()},
            }
        )
    return results


_OTHER_COLUMN_KEYS = DESC_KEYS + DEBIT_KEYS + CREDIT_KEYS + AMOUNT_KEYS + BALANCE_KEYS


def _looks_like_header_row(cells: list) -> bool:
    """Requires a date-like cell AND at least 3 distinct cells total that look
    like column labels. Counting matched *cells* rather than keyword hits
    matters here: a metadata line like "Transaction Date from: 01,06,2026"
    contains both "date" and (via "Transaction") a DESC_KEYS hit, but both
    come from that one single cell — a real header has several separate
    labeled columns (date, description, amount, ...), a label/value metadata
    line does not, however many keywords happen to appear in its one label.
    """
    has_date = False
    matched_cells = 0
    for c in cells:
        if c in (None, ""):
            continue
        low = str(c).lower()
        is_date_cell = "date" in low
        is_other_cell = any(k in low for k in _OTHER_COLUMN_KEYS)
        if is_date_cell:
            has_date = True
        if is_date_cell or is_other_cell:
            matched_cells += 1
    return has_date and matched_cells >= 3


def parse_csv(raw_bytes: bytes) -> list[dict[str, Any]]:
    text = raw_bytes.decode("utf-8-sig", errors="replace")
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    # Real exports have used plain comma CSV and a "~|~"-delimited pseudo-CSV
    # (still a .csv file, just not comma-separated) with the same ~10-row
    # metadata preamble problem XLSX has. Sniff the delimiter from whichever
    # line looks most like the real header, not necessarily the first line.
    delimiter = "~|~" if any("~|~" in line for line in lines[:HEADER_SEARCH_ROWS]) else ","

    def split_line(line: str) -> list[str]:
        return [c.strip() for c in (line.split(delimiter) if delimiter == "~|~" else next(csv.reader([line])))]

    header_idx = 0
    for i, line in enumerate(lines[:HEADER_SEARCH_ROWS]):
        if _looks_like_header_row(split_line(line)):
            header_idx = i
            break

    headers = split_line(lines[header_idx])
    rows = []
    for line in lines[header_idx + 1 :]:
        cells = split_line(line)
        if not any(cells):
            continue
        rows.append({headers[i]: cells[i] for i in range(min(len(headers), len(cells)))})
    return rows_from_dicts(rows)


def _parse_xlsx_bytes(raw_bytes: bytes) -> list[dict[str, Any]]:
    workbook = openpyxl.load_workbook(io.BytesIO(raw_bytes), data_only=True)
    sheet = workbook.active
    return _rows_from_grid(list(sheet.iter_rows(values_only=True)))


def _parse_legacy_xls_bytes(raw_bytes: bytes) -> list[dict[str, Any]]:
    workbook = xlrd.open_workbook(file_contents=raw_bytes)
    sheet = workbook.sheet_by_index(0)
    grid = [sheet.row_values(i) for i in range(sheet.nrows)]
    return _rows_from_grid(grid)


def _rows_from_grid(all_rows: list[tuple]) -> list[dict[str, Any]]:
    if not all_rows:
        return []

    header_idx = 0
    for i, row in enumerate(all_rows[:HEADER_SEARCH_ROWS]):
        if _looks_like_header_row(list(row)):
            header_idx = i
            break

    headers = [str(c).strip() if c not in (None, "") else f"col_{i}" for i, c in enumerate(all_rows[header_idx])]
    rows = []
    for row in all_rows[header_idx + 1 :]:
        if all(c in (None, "") for c in row):
            continue
        rows.append({headers[i]: row[i] for i in range(min(len(headers), len(row)))})
    return rows_from_dicts(rows)


def parse_xlsx(raw_bytes: bytes) -> list[dict[str, Any]]:
    """Handles both real .xlsx content and the common case of a bank naming an
    actual modern .xlsx file with an .xls extension (openpyxl's own file-type
    check only looks at the extension when given a path, but is bypassed
    entirely when given bytes — which is what this always does). Genuine
    legacy binary .xls (OLE2/BIFF, e.g. exports from JasperReports-based bank
    tools) isn't valid zip content at all and needs xlrd instead; the ZIP
    magic bytes are what actually distinguish the two, not the extension.
    """
    if raw_bytes[:2] == b"PK":
        return _parse_xlsx_bytes(raw_bytes)
    return _parse_legacy_xls_bytes(raw_bytes)


LINE_DATE_RE = re.compile(
    r"\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}|\d{1,2}[/\-][A-Za-z]{3,9}[/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b"
)
LINE_AMOUNT_RE = re.compile(r"[\d,]+\.\d{2}")
TRAILING_CODE_RE = re.compile(r"\b(C|D|Cr|Dr)\.?\s*$")


def _line_direction(line: str, amount_str: str) -> str:
    """Layered because real formats disagree on how direction is marked:
    SBI trails the amount with a standalone C/D code; an HDFC card statement
    instead prefixes the amount with "+" for credits and nothing for debits;
    only as a last resort does a plain "cr"/"dr" substring get trusted, since
    that's prone to false-positives against ordinary description text.
    """
    trailing = TRAILING_CODE_RE.search(line)
    if trailing:
        return "credit" if trailing.group(1).upper().startswith("C") else "debit"

    amount_pos = line.rfind(amount_str)
    if amount_pos > 0 and line[:amount_pos].rstrip().endswith("+"):
        return "credit"

    lower_line = line.lower()
    if "cr" in lower_line and "dr" not in lower_line:
        return "credit"
    return "debit"


def parse_pdf(raw_bytes: bytes) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
        for page in pdf.pages:
            table = page.extract_table()
            if table and len(table) > 1:
                headers = [str(h).strip() if h else f"col_{i}" for i, h in enumerate(table[0])]
                rows = [dict(zip(headers, row)) for row in table[1:]]
                results.extend(rows_from_dicts(rows))
                continue

            # No detectable table on this page — fall back to a per-line
            # heuristic. A line needs a decimal amount to count; a line with
            # no date of its own (e.g. a tax/fee line directly under a dated
            # transaction) inherits the most recently seen date rather than
            # being dropped, since real statements do this often.
            text = page.extract_text() or ""
            last_date_iso: str | None = None
            for line in text.splitlines():
                amount_matches = LINE_AMOUNT_RE.findall(line)
                if not amount_matches:
                    continue

                date_match = LINE_DATE_RE.search(line)
                date_iso = _parse_date(date_match.group(1)) if date_match else None
                if date_iso:
                    last_date_iso = date_iso
                elif last_date_iso:
                    date_iso = last_date_iso
                else:
                    continue

                amount = _parse_amount(amount_matches[0])
                if amount is None:
                    continue

                description = line
                if date_match:
                    description = description.replace(date_match.group(1), "")
                description = description.strip()

                results.append(
                    {
                        "date": date_iso,
                        "merchant": description or None,
                        "amount": amount,
                        "type": _line_direction(line, amount_matches[0]),
                        "balance": _parse_amount(amount_matches[-1]) if len(amount_matches) > 1 else None,
                        "raw": {"line": line},
                    }
                )
    return results


def parse_statement(filename: str, raw_bytes: bytes) -> list[dict[str, Any]]:
    lower = filename.lower()
    if lower.endswith(".csv"):
        return parse_csv(raw_bytes)
    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        return parse_xlsx(raw_bytes)
    if lower.endswith(".pdf"):
        return parse_pdf(raw_bytes)
    raise ValueError(f"Unsupported file type: {filename}")
