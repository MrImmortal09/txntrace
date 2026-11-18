"""Foreign-currency to INR rates, fetched from API Ninjas once a day and
served from the database to every user.

A card spend abroad arrives as "USD 1.00 spent ...", and the app converts it
to rupees at these rates plus the card's forex markup. Rates are the same for
everyone, so the server fetches them once and the phones only ever read the
stored copy: the number of API calls stays at one per currency per day no
matter how many people use the app.
"""

import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from .db import get_db

log = logging.getLogger("txntrace.rates")

API_NINJAS_KEY = os.environ.get("API_NINJAS_KEY")
API_URL = "https://api.api-ninjas.com/v1/exchangerate"

# Must match FOREIGN_CURRENCIES in the app's parsers/sms/utils.ts: the app only
# recognises these codes in a message, so a rate for anything else is unused.
CURRENCIES = (
    "USD", "EUR", "GBP", "AED", "SGD", "JPY", "AUD", "CAD", "CHF", "HKD", "THB",
    "MYR", "CNY", "SAR", "NZD", "SEK", "NOK", "DKK", "KRW", "IDR", "PHP", "VND",
    "QAR", "KWD", "OMR", "BHD", "LKR", "NPR", "BDT", "ZAR", "TRY",
)

REFRESH_EVERY = timedelta(hours=24)
# How often the background thread wakes to see whether a day has passed. A
# failed fetch is retried on the next wake rather than a day later.
CHECK_EVERY_SECONDS = 3600

_refresh_lock = threading.Lock()


def _stale_currencies() -> list[str]:
    """Currencies with no rate yet, or one fetched over a day ago. Checked per
    currency so one that failed is retried at the next hourly check rather
    than waiting a day behind the ones that succeeded."""
    with get_db() as conn:
        rows = conn.execute("SELECT currency, fetched_at FROM exchange_rates").fetchall()
    cutoff = datetime.now(timezone.utc) - REFRESH_EVERY
    fresh = {r["currency"] for r in rows if r["fetched_at"] and datetime.fromisoformat(r["fetched_at"]) > cutoff}
    return [c for c in CURRENCIES if c not in fresh]


def _fetch_rate(client: httpx.Client, currency: str) -> float | None:
    try:
        resp = client.get(API_URL, params={"pair": f"{currency}_INR"}, headers={"X-Api-Key": API_NINJAS_KEY})
        if resp.status_code != 200:
            log.warning("Rate for %s: API Ninjas returned %s", currency, resp.status_code)
            return None
        rate = resp.json().get("exchange_rate")
        return float(rate) if rate and float(rate) > 0 else None
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        log.warning("Rate for %s failed: %s", currency, exc)
        return None


def refresh_if_stale() -> bool:
    """Fetches each currency whose stored rate is missing or a day old, so a
    currency is fetched at most once a day once it succeeds. One that fails
    keeps its previous rate and is tried again at the next check."""
    if not API_NINJAS_KEY:
        return False
    with _refresh_lock:
        stale = _stale_currencies()
        if not stale:
            return False

        now = datetime.now(timezone.utc).isoformat()
        fetched = []
        with httpx.Client(timeout=10.0) as client:
            for currency in stale:
                rate = _fetch_rate(client, currency)
                if rate is not None:
                    fetched.append((currency, rate, now))
        if fetched:
            with get_db() as conn:
                conn.cursor().executemany(
                    """INSERT INTO exchange_rates (currency, inr_per_unit, fetched_at) VALUES (%s, %s, %s)
                       ON CONFLICT (currency) DO UPDATE SET
                         inr_per_unit = EXCLUDED.inr_per_unit, fetched_at = EXCLUDED.fetched_at""",
                    fetched,
                )
        log.info("Fetched %d of %d stale exchange rates", len(fetched), len(stale))
        return True


def _refresh_loop() -> None:
    while True:
        try:
            refresh_if_stale()
        except Exception:  # A bad day at the API must not kill the thread.
            log.exception("Exchange rate refresh failed")
        time.sleep(CHECK_EVERY_SECONDS)


def start_background_refresh() -> None:
    if not API_NINJAS_KEY:
        log.warning("API_NINJAS_KEY is not set; exchange rates won't be fetched.")
        return
    threading.Thread(target=_refresh_loop, name="exchange-rates", daemon=True).start()


def stored_rates() -> dict:
    with get_db() as conn:
        rows = conn.execute("SELECT currency, inr_per_unit, fetched_at FROM exchange_rates").fetchall()
    return {
        "base": "INR",
        "rates": {r["currency"]: r["inr_per_unit"] for r in rows},
        "fetched_at": max((r["fetched_at"] for r in rows), default=None),
    }
