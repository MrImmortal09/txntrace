"""
Shared bank identity used to show a real logo next to each bank's
transactions. Logos are the actual bank marks (fetched from Wikimedia
Commons, server/app/static/banks/*.svg) — this is the user's own personal,
non-distributed app, not something bundling trademarked artwork into a
public release. `color` is kept as the fallback badge color for an
unrecognized bank, where there's no real logo to show. This list is mirrored
in the mobile app at app/src/constants/banks.ts — keep both in sync if a bank
is added or a logo/color changes.
"""

BANKS = [
    {"id": "hdfc", "name": "HDFC Bank", "code": "HDFC", "color": "#004C8F", "logo": "/static/banks/hdfc.svg"},
    {"id": "icici", "name": "ICICI Bank", "code": "ICICI", "color": "#F37021", "logo": "/static/banks/icici.svg"},
    {"id": "sbi", "name": "State Bank of India", "code": "SBI", "color": "#2D2A81", "logo": "/static/banks/sbi.svg"},
    {"id": "axis", "name": "Axis Bank", "code": "AXIS", "color": "#97144D", "logo": "/static/banks/axis.svg"},
    {"id": "indusind", "name": "IndusInd Bank", "code": "INDUS", "color": "#B7202E", "logo": "/static/banks/indusind.svg"},
    {"id": "yesbank", "name": "Yes Bank", "code": "YES", "color": "#00A19B", "logo": "/static/banks/yesbank.svg"},
    {"id": "idfcfirst", "name": "IDFC First Bank", "code": "IDFC", "color": "#C99A2E", "logo": "/static/banks/idfcfirst.svg"},
]

FALLBACK = {"id": "other", "name": "Other", "code": "?", "color": "#6B7280", "logo": None}


def bank_style_for(bank_name: str | None) -> dict:
    """Transactions store the bank as a free-text display name (e.g. "HDFC
    Bank", however the statement-upload form or an SMS parser wrote it), not
    the short id used in BANKS — so this matches by substring, the same way
    the mobile SMS parsers' canHandle() functions already do (e.g. checking
    sender.includes('HDFC')), rather than expecting an exact id match.
    """
    if not bank_name:
        return FALLBACK
    lower = bank_name.lower()
    for bank in BANKS:
        if bank["id"] in lower or bank["name"].lower() in lower:
            return bank
    return FALLBACK
