#!/usr/bin/env python3
"""IPO calendar for the Ticker PWA.

Primary source: Nasdaq public IPO calendar API
  https://api.nasdaq.com/api/ipo/calendar?date=YYYY-MM
  for the previous, current and next month (upcoming, priced, filed, withdrawn).

Fallback: stockanalysis.com/ipos pages (calendar, recent, filings) when a
Nasdaq section is empty or the API fails. UK / LSE notable IPOs are attempted
from free sources and skipped if none is usable.

Never invents prices, dates, deal sizes or returns. Current price and
performance since IPO come from Yahoo Finance when a quote is available.
Logos prefer Financial Modeling Prep image-stock (and CompaniesMarketCap),
otherwise an original generated circular mark.
"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
IMG = ROOT / "img"
IPO_IMG = IMG / "ipos"
CTX = ssl.create_default_context()

# Browser-like headers: Nasdaq's public website API rejects empty/UA-less clients
# and can stall on a short timeout. Same pattern as pipeline/analysis.py.
ND_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/market-activity/ipos",
}
SA_HEADERS = {
    "User-Agent": ND_HEADERS["User-Agent"],
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
IMG_HEADERS = {
    "User-Agent": ND_HEADERS["User-Agent"],
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}

FMP = "https://financialmodelingprep.com/image-stock/{sym}.png"
CMC = "https://companiesmarketcap.com/img/company-logos/256/{sym}.png"

# Module cache so calendar_tickers() and write_ipos() share one fetch.
_CACHE: dict = {}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def month_keys(today: date | None = None) -> list[str]:
    today = today or date.today()
    out = []
    y, m = today.year, today.month
    for delta in (-1, 0, 1):
        mm = m + delta
        yy = y
        if mm < 1:
            yy, mm = yy - 1, 12
        elif mm > 12:
            yy, mm = yy + 1, 1
        out.append(f"{yy}-{mm:02d}")
    return out


def _get(url: str, headers: dict, tries: int = 3, timeout: int = 45) -> tuple[int, bytes]:
    last = "no attempt"
    for i in range(tries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504) and i + 1 < tries:
                time.sleep(2.5 * (i + 1))
                continue
            raise
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            if i + 1 < tries:
                time.sleep(1.5 * (i + 1))
                continue
            raise RuntimeError(last)
    raise RuntimeError(last)


def parse_money(text) -> float | None:
    if text is None:
        return None
    s = str(text).strip()
    if not s or s in {"-", "—", "N/A", "n/a", "NA"}:
        return None
    s = s.replace(",", "").replace(" ", "")
    m = re.match(r"^\$?(-?\d+(?:\.\d+)?)([KMBTkmbt])?$", s)
    if not m:
        # e.g. $168,888,880 already stripped commas; or "$90,988,000.00"
        m2 = re.search(r"(-?\d+(?:\.\d+)?)", str(text).replace(",", ""))
        if not m2:
            return None
        try:
            return float(m2.group(1))
        except ValueError:
            return None
    n = float(m.group(1))
    suf = (m.group(2) or "").upper()
    if suf == "K":
        n *= 1e3
    elif suf == "M":
        n *= 1e6
    elif suf == "B":
        n *= 1e9
    elif suf == "T":
        n *= 1e12
    return n


def parse_shares(text) -> int | None:
    n = parse_money(text)
    if n is None:
        return None
    return int(round(n))


def parse_date(text) -> str | None:
    if not text:
        return None
    s = str(text).strip()
    if not s or s in {"-", "—"}:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%b %d %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    # "Nov 19" (no year) — assume current year if the month is near today
    m = re.match(r"^([A-Za-z]{3,9})\s+(\d{1,2})$", s)
    if m:
        try:
            d = datetime.strptime(f"{m.group(1)} {m.group(2)} {date.today().year}", "%b %d %Y")
            return d.date().isoformat()
        except ValueError:
            try:
                d = datetime.strptime(f"{m.group(1)} {m.group(2)} {date.today().year}", "%B %d %Y")
                return d.date().isoformat()
            except ValueError:
                return None
    return None


def tidy_name(name: str | None) -> str | None:
    if not name:
        return name
    s = re.sub(r"\s+", " ", str(name)).strip()
    if s.isupper() and len(s) > 4:
        s = s.title()
        for src, dst in (
            (" Inc.", " Inc."),
            (" Ltd", " Ltd"),
            (" Llc", " LLC"),
            (" Plc", " PLC"),
            (" Ag", " AG"),
            (" Pbc", " PBC"),
            (" Corp.", " Corp."),
            (" Co ", " Co "),
        ):
            s = s.replace(src, dst)
    return s


def tidy_ticker(text) -> str | None:
    if text is None:
        return None
    s = str(text).strip().upper()
    s = re.sub(r"[^A-Z0-9.\-]", "", s)
    return s or None


def tidy_exchange(text) -> str | None:
    if not text:
        return None
    s = re.sub(r"\s+", " ", str(text)).strip()
    return s or None


# ---------- Nasdaq ----------

def fetch_nasdaq_month(ym: str) -> dict:
    url = f"https://api.nasdaq.com/api/ipo/calendar?date={ym}"
    status, raw = _get(url, ND_HEADERS)
    if status != 200:
        raise RuntimeError(f"Nasdaq calendar {ym}: HTTP {status}")
    data = json.loads(raw.decode("utf-8"))
    return data


def _rows(block) -> list[dict]:
    if not isinstance(block, dict):
        return []
    rows = block.get("rows") or []
    return [r for r in rows if isinstance(r, dict)]


def _deal_id(row: dict, source: str, status: str) -> str:
    did = row.get("dealID") or row.get("dealId")
    if did:
        return f"nasdaq:{did}"
    tick = tidy_ticker(row.get("proposedTickerSymbol") or row.get("ticker") or row.get("s"))
    dt = parse_date(row.get("pricedDate") or row.get("expectedPriceDate") or row.get("filedDate") or row.get("ipoDate"))
    base = tick or re.sub(r"[^a-z0-9]+", "-", (row.get("companyName") or row.get("n") or "deal").lower()).strip("-")
    return f"{source}:{status}:{base}:{dt or 'na'}"


def from_nasdaq_row(row: dict, status: str, ym: str) -> dict:
    ticker = tidy_ticker(row.get("proposedTickerSymbol"))
    rec = {
        "id": _deal_id(row, "nasdaq", status),
        "ticker": ticker,
        "company": tidy_name(row.get("companyName")),
        "exchange": tidy_exchange(row.get("proposedExchange")),
        "status": status,
        "source": "Nasdaq IPO calendar",
        "month": ym,
        "market": "US",
    }
    price_txt = row.get("proposedSharePrice")
    # Upcoming often uses a range in proposedSharePrice; priced is a single figure.
    if price_txt and "-" in str(price_txt) and not re.match(r"^\s*-?\d", str(price_txt)):
        rec["priceRange"] = str(price_txt).strip()
    elif price_txt and re.search(r"-", str(price_txt)) and re.search(r"\d", str(price_txt)):
        rec["priceRange"] = str(price_txt).strip()
        # mid if both ends parse
        parts = re.split(r"\s*-\s*", str(price_txt))
        lows, highs = parse_money(parts[0]) if parts else None, parse_money(parts[-1]) if len(parts) > 1 else None
        if lows is not None and highs is not None:
            rec["ipoPriceLow"] = lows
            rec["ipoPriceHigh"] = highs
        elif lows is not None:
            rec["ipoPrice"] = lows
            rec["ipoPriceText"] = str(price_txt).strip()
    else:
        px = parse_money(price_txt)
        if px is not None:
            rec["ipoPrice"] = px
            rec["ipoPriceText"] = str(price_txt).strip()
    shares = parse_shares(row.get("sharesOffered"))
    if shares is not None:
        rec["sharesOffered"] = shares
        rec["sharesText"] = str(row.get("sharesOffered")).strip()
    deal = parse_money(row.get("dollarValueOfSharesOffered"))
    if deal is not None:
        rec["dealSize"] = deal
        rec["dealSizeText"] = str(row.get("dollarValueOfSharesOffered")).strip()
    if status == "priced":
        rec["pricedDate"] = parse_date(row.get("pricedDate"))
        rec["date"] = rec["pricedDate"]
    elif status == "upcoming":
        rec["expectedDate"] = parse_date(
            row.get("expectedPriceDate") or row.get("pricedDate") or row.get("expectedDate")
        )
        rec["date"] = rec["expectedDate"]
        if rec.get("ipoPrice") is None and rec.get("priceRange") is None and price_txt:
            rec["priceRange"] = str(price_txt).strip()
    elif status == "filed":
        rec["filedDate"] = parse_date(row.get("filedDate"))
        rec["date"] = rec["filedDate"]
    elif status == "withdrawn":
        rec["filedDate"] = parse_date(row.get("filedDate"))
        rec["withdrawnDate"] = parse_date(row.get("withdrawDate") or row.get("withdrawnDate"))
        rec["date"] = rec["withdrawnDate"] or rec["filedDate"]
    return rec


def collect_nasdaq(months: list[str]) -> tuple[dict[str, list], list[str], list[str]]:
    bags = {"upcoming": [], "priced": [], "filed": [], "withdrawn": []}
    errors: list[str] = []
    used: list[str] = []
    for ym in months:
        try:
            payload = fetch_nasdaq_month(ym)
            used.append(ym)
            data = payload.get("data") or {}
            for status in ("upcoming", "priced", "filed", "withdrawn"):
                for row in _rows(data.get(status)):
                    bags[status].append(from_nasdaq_row(row, status, ym))
            print(
                f"  Nasdaq {ym}: priced={len(_rows(data.get('priced')))} "
                f"upcoming={len(_rows(data.get('upcoming')))} "
                f"filed={len(_rows(data.get('filed')))} "
                f"withdrawn={len(_rows(data.get('withdrawn')))}",
                flush=True,
            )
        except Exception as e:
            errors.append(f"Nasdaq {ym}: {e}")
            print(f"  Nasdaq {ym} FAIL {e}", flush=True)
    return bags, used, errors


# ---------- StockAnalysis fallback ----------

class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables: list[dict] = []
        self._t = None
        self._r = None
        self._cell = None
        self._href = None

    def handle_starttag(self, tag, attrs):
        ad = dict(attrs)
        if tag == "table":
            self._t = {"headers": [], "rows": []}
            self.tables.append(self._t)
        elif tag == "tr" and self._t is not None:
            self._r = []
        elif tag in ("td", "th") and self._r is not None:
            self._cell = ""
            self._href = None
        elif tag == "a" and self._cell is not None:
            href = ad.get("href") or ""
            if href:
                self._href = href

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._r is not None:
            text = re.sub(r"\s+", " ", self._cell).strip()
            self._r.append({"text": text, "href": self._href})
            self._cell = None
            self._href = None
        elif tag == "tr" and self._r is not None and self._t is not None:
            if self._r and any(c["text"] for c in self._r):
                self._t["rows"].append(self._r)
            self._r = None
        elif tag == "table":
            self._t = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell += data


def _ticker_from_cell(cell: dict) -> str | None:
    t = tidy_ticker(cell.get("text"))
    if t:
        return t
    href = cell.get("href") or ""
    m = re.search(r"/stocks/([a-z0-9.-]+)/?", href, re.I)
    if m:
        return tidy_ticker(m.group(1))
    return None


def _header_map(row: list[dict]) -> dict[str, int]:
    m = {}
    for i, c in enumerate(row):
        key = re.sub(r"[^a-z]+", "", (c.get("text") or "").lower())
        if key:
            m[key] = i
    return m


def parse_sa_tables(html: str, kind: str) -> list[dict]:
    p = _TableParser()
    p.feed(html)
    out = []
    for tb in p.tables:
        if not tb["rows"]:
            continue
        headers = _header_map(tb["rows"][0])
        # skip tiny nav tables (Date / Symbol / Name only, 1 data row sidebar)
        if "companyname" not in headers and "name" not in headers:
            continue
        # Sidebar widgets are Date/Symbol/Name only — not a full calendar table.
        if kind == "priced" and "ipoprice" not in headers and "price" not in headers:
            continue
        if kind == "upcoming" and "pricerange" not in headers and "dealsize" not in headers and "ipodate" not in headers:
            continue
        start = 1 if headers else 0
        for raw in tb["rows"][start:]:
            def col(*names):
                for n in names:
                    i = headers.get(n)
                    if i is not None and i < len(raw):
                        return raw[i]
                return {}

            name = (col("companyname", "name").get("text") or "").strip()
            ticker = _ticker_from_cell(col("symbol"))
            if not name and not ticker:
                continue
            rec = {
                "company": tidy_name(name),
                "ticker": ticker,
                "exchange": tidy_exchange(col("exchange").get("text")),
                "source": "StockAnalysis IPO calendar",
                "market": "US",
                "status": kind,
            }
            if kind == "upcoming":
                rec["expectedDate"] = parse_date(col("ipodate", "date").get("text"))
                rec["date"] = rec["expectedDate"]
                pr = (col("pricerange", "ipoprice").get("text") or "").strip()
                if pr:
                    rec["priceRange"] = pr
                    parts = re.split(r"\s*-\s*", pr)
                    lo, hi = parse_money(parts[0]) if parts else None, parse_money(parts[-1]) if len(parts) > 1 else None
                    if lo is not None:
                        rec["ipoPriceLow"] = lo
                    if hi is not None:
                        rec["ipoPriceHigh"] = hi
                sh = col("sharesoffered").get("text")
                if sh:
                    rec["sharesOffered"] = parse_shares(sh)
                    rec["sharesText"] = sh.strip()
                ds = col("dealsize").get("text")
                if ds:
                    rec["dealSize"] = parse_money(ds)
                    rec["dealSizeText"] = ds.strip()
            elif kind == "priced":
                rec["pricedDate"] = parse_date(col("ipodate", "date").get("text"))
                rec["date"] = rec["pricedDate"]
                ip = col("ipoprice", "price").get("text")
                if ip:
                    rec["ipoPrice"] = parse_money(ip)
                    rec["ipoPriceText"] = ip.strip()
                # SA current / return are not copied — Yahoo is the source of record.
            elif kind == "filed":
                rec["filedDate"] = parse_date(col("filingdate", "date").get("text"))
                rec["date"] = rec["filedDate"]
                pr = (col("pricerange").get("text") or "").strip()
                if pr and pr not in {"-", "—"}:
                    rec["priceRange"] = pr
                sh = col("sharesoffered").get("text")
                if sh and sh not in {"-", "—"}:
                    rec["sharesOffered"] = parse_shares(sh)
                    rec["sharesText"] = sh.strip()
            rec["id"] = f"sa:{kind}:{ticker or 'x'}:{rec.get('date') or 'na'}"
            out.append(rec)
    return out


def fetch_sa(path: str) -> str:
    url = "https://stockanalysis.com" + path
    status, raw = _get(url, SA_HEADERS, timeout=30)
    if status != 200:
        raise RuntimeError(f"StockAnalysis {path}: HTTP {status}")
    return raw.decode("utf-8", "replace")


def collect_stockanalysis(need: set[str]) -> tuple[dict[str, list], list[str]]:
    bags = {"upcoming": [], "priced": [], "filed": []}
    errors: list[str] = []
    pages = []
    if "upcoming" in need:
        pages.append(("/ipos/calendar/", "upcoming"))
    if "priced" in need:
        pages.append(("/ipos/", "priced"))
        pages.append((f"/ipos/{date.today().year}/", "priced"))
    if "filed" in need:
        pages.append(("/ipos/filings/", "filed"))
    seen_pages = set()
    for path, kind in pages:
        if path in seen_pages:
            continue
        seen_pages.add(path)
        try:
            html = fetch_sa(path)
            rows = parse_sa_tables(html, kind)
            bags[kind].extend(rows)
            print(f"  StockAnalysis {path}: {kind}={len(rows)}", flush=True)
        except Exception as e:
            errors.append(f"StockAnalysis {path}: {e}")
            print(f"  StockAnalysis {path} FAIL {e}", flush=True)
    return bags, errors


def in_window(iso: str | None, months: list[str]) -> bool:
    if not iso:
        return False
    return iso[:7] in months


def ticker_key(t: str | None) -> str | None:
    if not t:
        return None
    return t.upper()


def merge_fallback(primary: dict[str, list], fallback: dict[str, list], months: list[str]) -> None:
    """Add fallback rows when the Nasdaq section lacks that deal (by ticker)."""
    for status in ("upcoming", "priced", "filed"):
        have = {ticker_key(r.get("ticker")) for r in primary.get(status, []) if r.get("ticker")}
        # Also treat unit tickers (XYZU) as the same deal as XYZ when merging priced.
        have_base = {k[:-1] if k.endswith("U") and len(k) >= 5 else k for k in have}
        added = 0
        for rec in fallback.get(status, []):
            if status != "upcoming" and not in_window(rec.get("date"), months):
                continue
            # Upcoming may sit just outside the strict month window; keep if dated today or later
            # and within 90 days, or inside the window.
            if status == "upcoming":
                d = rec.get("date")
                if d:
                    try:
                        dt = date.fromisoformat(d)
                        if d[:7] not in months and not (date.today() <= dt <= date.today() + timedelta(days=90)):
                            continue
                    except ValueError:
                        continue
            t = ticker_key(rec.get("ticker"))
            base = t[:-1] if t and t.endswith("U") and len(t) >= 5 else t
            if t and (t in have or (base and base in have_base)):
                continue
            # Also skip if this ticker already shows up as priced (for filed/upcoming).
            primary.setdefault(status, []).append(rec)
            if t:
                have.add(t)
                if base:
                    have_base.add(base)
            added += 1
        if added:
            print(f"  merged {added} {status} row(s) from StockAnalysis", flush=True)


def drop_duplicates(bags: dict[str, list]) -> None:
    """Keep a deal in the most advanced status only (priced > upcoming > filed)."""
    ranked = {"priced": 3, "upcoming": 2, "filed": 1, "withdrawn": 0}

    def keys(rec):
        out = set()
        t = ticker_key(rec.get("ticker"))
        if t:
            out.add("t:" + t)
            if t.endswith("U") and len(t) >= 5:
                out.add("t:" + t[:-1])
        if rec.get("company"):
            out.add("n:" + rec["company"].lower())
        return out

    claimed: set[str] = set()
    for status in ("priced", "upcoming", "filed", "withdrawn"):
        kept = []
        for rec in bags.get(status, []):
            ks = keys(rec)
            if status != "priced" and ks and ks & claimed:
                continue
            kept.append(rec)
            claimed |= ks
        bags[status] = kept


def sort_bags(bags: dict[str, list]) -> None:
    def key(rec, default="0000-01-01"):
        return rec.get("date") or default

    bags["upcoming"] = sorted(bags.get("upcoming") or [], key=lambda r: key(r, "9999-12-31"))
    bags["priced"] = sorted(bags.get("priced") or [], key=lambda r: key(r), reverse=True)
    bags["filed"] = sorted(bags.get("filed") or [], key=lambda r: key(r), reverse=True)
    bags["withdrawn"] = sorted(bags.get("withdrawn") or [], key=lambda r: key(r), reverse=True)


def _name_matches(quote: dict, company: str | None) -> bool:
    if not company or not quote:
        return False
    hay = ((quote.get("name") or "") + " " + (quote.get("shortName") or "")).lower()
    core = re.sub(
        r",?\s+(inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|llc|plc|ag|pbc|group)\b.*$",
        "",
        company.lower(),
    ).strip()
    tokens = [t for t in re.split(r"\W+", core) if len(t) >= 4]
    return bool(tokens) and any(tok in hay for tok in tokens[:3])


def quote_candidates(ticker: str | None) -> list[str]:
    if not ticker:
        return []
    t = ticker.upper()
    out = [t]
    # Nasdaq often lists SPAC units as XXXXU; Yahoo common stock is usually XXXX.
    if t.endswith("U") and 4 <= len(t) <= 6 and t[:-1].isalpha():
        out.append(t[:-1])
    # unique, stable order
    seen = set()
    uniq = []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


# ---------- Calendar entry point (used to extend the Yahoo universe) ----------

def load_calendar(force: bool = False) -> dict:
    if _CACHE.get("calendar") and not force:
        return _CACHE["calendar"]
    months = month_keys()
    print(f"IPO calendar months {months}", flush=True)
    bags, used, errors = collect_nasdaq(months)
    nasdaq_ok = bool(used)
    need = set()
    if not nasdaq_ok:
        need.update({"upcoming", "priced", "filed"})
    else:
        if not bags["upcoming"]:
            need.add("upcoming")
        # Nasdaq mid-month lag: priced list can miss very recent listings.
        need.add("priced")
    if need:
        fb, fb_err = collect_stockanalysis(need)
        errors.extend(fb_err)
        merge_fallback(bags, fb, months)
    today = date.today().isoformat()
    moved = 0
    kept_priced = []
    for rec in bags.get("priced") or []:
        d = rec.get("pricedDate") or rec.get("date")
        if d and d > today:
            rec["status"] = "upcoming"
            rec["expectedDate"] = rec.get("expectedDate") or d
            rec.pop("pricedDate", None)
            bags.setdefault("upcoming", []).append(rec)
            moved += 1
        else:
            kept_priced.append(rec)
    bags["priced"] = kept_priced
    if moved:
        print(f"  reclassified {moved} future-dated row(s) as upcoming", flush=True)
    drop_duplicates(bags)
    sort_bags(bags)
    cal = {
        "months": months,
        "nasdaqMonths": used,
        "bags": bags,
        "errors": errors,
        "fetchedAt": _now(),
        "nasdaqOk": nasdaq_ok,
    }
    _CACHE["calendar"] = cal
    return cal


def calendar_tickers() -> list[str]:
    """Recent IPO tickers to add to the Yahoo refresh universe."""
    cal = load_calendar()
    out: list[str] = []
    seen = set()
    # Priced deals should already trade. Upcoming/filed usually will not.
    for rec in cal["bags"].get("priced") or []:
        tick = rec.get("ticker")
        if tick and tick not in seen:
            seen.add(tick)
            out.append(tick)
    return out


# ---------- Quotes, news, logos ----------

def attach_quotes(bags: dict[str, list], quotes: dict) -> list[str]:
    missing = []
    seen_missing = set()
    for status, rows in bags.items():
        for rec in rows:
            cands = quote_candidates(rec.get("ticker"))
            q = None
            used = None
            for i, s in enumerate(cands):
                cand = quotes.get(s)
                if not (cand and cand.get("ok") and cand.get("price") is not None):
                    continue
                if i > 0 and not _name_matches(cand, rec.get("company")):
                    continue
                q = cand
                used = s
                break
            if q is None:
                rec["quoteable"] = False
                rec.pop("currentPrice", None)
                rec.pop("returnPct", None)
                rec.pop("quoteSymbol", None)
                for s in cands:
                    if s not in seen_missing:
                        seen_missing.add(s)
                        missing.append(s)
                continue
            rec["quoteable"] = True
            rec["quoteSymbol"] = used
            rec["currentPrice"] = q["price"]
            rec["currentCurrency"] = q.get("currency") or "USD"
            ipo = rec.get("ipoPrice")
            try:
                if ipo not in (None, 0) and rec["currentPrice"] is not None:
                    rec["returnPct"] = (float(rec["currentPrice"]) - float(ipo)) / float(ipo) * 100.0
                else:
                    rec.pop("returnPct", None)
            except (TypeError, ValueError, ZeroDivisionError):
                rec.pop("returnPct", None)
    return missing


def _fetch_one_quote(sym: str) -> tuple[dict | None, dict | None]:
    """Lazy import of refresh helpers to avoid a circular import at module load."""
    import refresh as R

    daily = R.chart(sym, "5y", "1d")
    if not daily:
        return None, None
    meta = daily.get("meta") or {}
    daily_bars = R.bars(daily, ohlc=True)
    closes = [b["c"] for b in daily_bars]
    q = R.pack_quote(sym, meta, closes)
    if not q:
        return None, None
    q.setdefault("session", "regular")
    intra = []
    try:
        raw_i = R.chart(sym, "1d", "5m", prepost=True)
        if raw_i:
            intra = R.bars(raw_i, ohlc=False)
    except Exception:
        intra = []
    scale = 0.01 if q.get("unit") == "pence" else 1.0
    divs = R.dividends_from(daily, scale)
    if q.get("unit") == "pence":
        def _sc(rows):
            out = []
            for b in rows:
                nb = dict(b)
                for k in ("o", "h", "l", "c"):
                    if k in nb and nb[k] is not None:
                        nb[k] = nb[k] * 0.01
                out.append(nb)
            return out
        daily_bars = _sc(daily_bars)
        intra = _sc(intra)
    if divs:
        q["lastDiv"] = divs[-1]
    hist = {
        "symbol": sym,
        "currency": q["currency"],
        "daily": daily_bars,
        "intraday": intra,
        "dividends": divs,
        "periods": R.period_windows(meta),
        "session": q.get("session"),
    }
    return q, hist


def fetch_missing_quotes(symbols: list[str], quotes: dict) -> dict:
    added = {}
    hist_dir = DATA / "hist"
    hist_dir.mkdir(parents=True, exist_ok=True)
    for sym in symbols:
        if quotes.get(sym) and quotes[sym].get("ok") and quotes[sym].get("price") is not None:
            continue
        try:
            q, hist = _fetch_one_quote(sym)
            if not q:
                print(f"  IPO quote {sym}: no data", flush=True)
                time.sleep(0.12)
                continue
            quotes[sym] = q
            added[sym] = q
            if hist:
                (hist_dir / f"{sym}.json").write_text(json.dumps(hist, separators=(",", ":")), encoding="utf-8")
            print(f"  IPO quote {sym}: {q.get('currency')} {q.get('price')}", flush=True)
        except Exception as e:
            print(f"  IPO quote {sym} FAIL {e}", flush=True)
        time.sleep(0.18)
    return added


def attach_news(bags: dict[str, list], news: dict | None) -> None:
    news = news or {}
    by = news.get("bySymbol") or {}
    pool = list(news.get("market") or []) + list(news.get("crypto") or [])

    def matches(item, rec):
        title = ((item.get("title") or "") + " " + (item.get("summary") or "")).lower()
        tickers = [t.lower() for t in quote_candidates(rec.get("ticker")) if t and len(t) >= 2]
        for t in tickers:
            if re.search(r"\b" + re.escape(t.lower()) + r"\b", title):
                return True
        name = (rec.get("company") or "").lower()
        # Strip corporate suffixes for a stabler phrase match.
        core = re.sub(
            r",?\s+(inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|llc|plc|ag|pbc|group|holdings?|acquisition corp\.?.*)$",
            "",
            name,
            flags=re.I,
        ).strip()
        if core and len(core) >= 5 and core in title:
            return True
        return False

    for rows in bags.values():
        for rec in rows:
            found = []
            seen = set()
            for t in quote_candidates(rec.get("ticker")):
                for item in by.get(t) or []:
                    key = (item.get("title") or "") + "|" + (item.get("url") or "")
                    if key in seen:
                        continue
                    seen.add(key)
                    found.append(item)
            for item in pool:
                if not matches(item, rec):
                    continue
                key = (item.get("title") or "") + "|" + (item.get("url") or "")
                if key in seen:
                    continue
                seen.add(key)
                found.append(item)
            # Keep a compact snapshot (title, source, time, url, thumbnail) — no article body.
            slim = []
            for item in found[:8]:
                slim.append({
                    k: item[k]
                    for k in ("title", "source", "published", "url", "thumbnail", "summary")
                    if item.get(k)
                })
            rec["news"] = slim


def _valid_logo(data: bytes):
    try:
        from PIL import Image
        im = Image.open(BytesIO(data))
        im.load()
        if min(im.size) < 64:
            return None
        return im
    except Exception:
        return None


def _fit_square(im, size: int = 256):
    from PIL import Image
    im = im.convert("RGBA")
    w, h = im.size
    side = max(w, h, size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    scale = (side * 0.86) / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((side - nw) // 2, (side - nh) // 2), resized)
    if side != size:
        canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    return canvas


def _hash_color(seed: str) -> tuple[str, str, str]:
    h = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    # Pleasant, high-contrast palettes that work on dark and light (not the old cyan accent).
    palettes = [
        ("#14532d", "#22c55e", "#f7fee7"),
        ("#1e3a5f", "#3b82f6", "#eff6ff"),
        ("#3b2f0b", "#d4a017", "#fffbeb"),
        ("#4a1c14", "#f97316", "#fff7ed"),
        ("#3b0764", "#c084fc", "#faf5ff"),
        ("#1a2e05", "#84cc16", "#f7fee7"),
        ("#0f172a", "#94a3b8", "#f8fafc"),
        ("#4c0519", "#fb7185", "#fff1f2"),
        ("#164e63", "#22d3ee", "#ecfeff"),
        ("#1c1917", "#f59e0b", "#fffbeb"),
        ("#1e1b4b", "#818cf8", "#eef2ff"),
        ("#3f3f46", "#e4e4e7", "#18181b"),
    ]
    return palettes[int(h[:8], 16) % len(palettes)]


def make_mark_svg(label: str, seed: str) -> bytes:
    letters = re.sub(r"[^A-Z0-9]", "", (label or "IPO").upper())[:4] or "IPO"
    bg, mid, fg = _hash_color(seed)
    size = 92 if len(letters) <= 2 else (72 if len(letters) == 3 else 56)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <radialGradient id="g" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="{mid}"/>
      <stop offset="100%" stop-color="{bg}"/>
    </radialGradient>
  </defs>
  <circle cx="128" cy="128" r="128" fill="url(#g)"/>
  <circle cx="128" cy="128" r="118" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3"/>
  <text x="128" y="146" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif"
        font-size="{size}" font-weight="700" fill="{fg}" letter-spacing="-1">{letters}</text>
</svg>
'''
    return svg.encode("utf-8")


def safe_stem(rec: dict) -> str:
    t = rec.get("ticker") or ""
    t = re.sub(r"[^A-Za-z0-9._-]", "", t)
    if t:
        return t
    slug = re.sub(r"[^a-z0-9]+", "-", (rec.get("id") or "deal").lower()).strip("-")
    return slug[:40] or "deal"


def ensure_logos(bags: dict[str, list], manifest: dict) -> dict:
    IPO_IMG.mkdir(parents=True, exist_ok=True)
    stats = {"fmp": 0, "cmc": 0, "mark": 0, "reuse": 0}
    for rows in bags.values():
        for rec in rows:
            ticker = rec.get("ticker")
            stem = safe_stem(rec)
            # Reuse an existing stock logo if we already have a crisp one.
            reused = None
            for key in ([ticker] if ticker else []):
                if not key:
                    continue
                rec_m = manifest.get(key)
                if rec_m and rec_m.get("src"):
                    p = ROOT / rec_m["src"]
                    if p.exists() and p.stat().st_size > 40:
                        reused = rec_m
                        rec["logo"] = rec_m["src"]
                        break
            if reused:
                stats["reuse"] += 1
                continue
            got = None
            source = None
            # FMP/CMC often serve a recycled mark for a not-yet-listed ticker.
            # Only try official bitmaps for priced / quoteable names.
            may_fetch = (rec.get("status") == "priced") or rec.get("quoteable")
            for key in ([ticker] if ticker and may_fetch else []):
                for label, url in (("fmp", FMP.format(sym=key)), ("cmc", CMC.format(sym=key))):
                    try:
                        status, raw = _get(url, IMG_HEADERS, tries=2, timeout=20)
                    except Exception:
                        continue
                    if status != 200:
                        continue
                    im = _valid_logo(raw)
                    if im is None:
                        continue
                    square = _fit_square(im, 256)
                    dest = IPO_IMG / f"{key}.png"
                    square.save(dest, "PNG")
                    got = f"img/ipos/{key}.png"
                    source = (
                        f"Financial Modeling Prep image-stock/{key}.png"
                        if label == "fmp"
                        else f"CompaniesMarketCap 256px logo for {key}"
                    )
                    stats[label] += 1
                    break
                if got:
                    break
            if not got:
                dest = IPO_IMG / f"{stem}.svg"
                dest.write_bytes(make_mark_svg(ticker or (rec.get("company") or "IPO")[:4], rec.get("id") or stem))
                got = f"img/ipos/{stem}.svg"
                source = "Original Ticker IPO mark (generated; no official logo was available)"
                stats["mark"] += 1
            rec["logo"] = got
            entry = {"src": got, "kind": "stock", "chip": got.endswith(".png"), "source": source}
            if ticker:
                manifest[ticker] = entry
            manifest[rec["id"]] = entry
    print(
        f"  IPO logos: FMP {stats['fmp']}, CompaniesMarketCap {stats['cmc']}, "
        f"generated marks {stats['mark']}, reused {stats['reuse']}",
        flush=True,
    )
    return stats


def try_uk_ipos() -> dict:
    """Optional notable UK / LSE IPOs. Skip unless a free structured source works."""
    # lse.co.uk is Cloudflare-blocked; official LSE 'new issues' pages are JS shells
    # without a public JSON calendar (probed 2026-11-14). Do not scrape a captcha
    # or invent names.
    return {
        "skipped": True,
        "reason": (
            "No free structured LSE IPO calendar was available "
            "(lse.co.uk blocked, official LSE pages have no public JSON calendar)."
        ),
        "items": [],
    }


def write_ipos(data_dir: Path, quotes: dict, ua: str | None = None) -> dict:
    """Write data/ipos.json, logos under img/ipos, and return any newly fetched quotes."""
    cal = load_calendar()
    bags = cal["bags"]
    added = {}
    attach_quotes(bags, quotes)
    # Only priced deals are expected to have a Yahoo quote. Upcoming/filed
    # tickers usually 404 and are left as not quoteable.
    to_fetch = []
    seen = set()
    for rec in bags.get("priced") or []:
        tick = rec.get("ticker")
        if tick and tick not in seen:
            seen.add(tick)
            if not (quotes.get(tick) and quotes[tick].get("ok") and quotes[tick].get("price") is not None):
                to_fetch.append(tick)
    if to_fetch:
        print(f"Fetching Yahoo quotes for {len(to_fetch)} IPO tickers", flush=True)
        added = fetch_missing_quotes(to_fetch, quotes)
        attach_quotes(bags, quotes)

    news = None
    news_path = data_dir / "news.json"
    if news_path.exists():
        try:
            news = json.loads(news_path.read_text(encoding="utf-8"))
        except Exception:
            news = None
    attach_news(bags, news)

    man_path = IMG / "manifest.json"
    manifest = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {}
    ensure_logos(bags, manifest)
    man_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    uk = try_uk_ipos()
    sources = ["Nasdaq IPO calendar (api.nasdaq.com/api/ipo/calendar)"]
    if any(r.get("source", "").startswith("StockAnalysis") for rows in bags.values() for r in rows):
        sources.append("StockAnalysis IPO pages (fallback)")
    counts = {k: len(bags.get(k) or []) for k in ("upcoming", "priced", "filed", "withdrawn")}
    out = {
        "generated_at": _now(),
        "asOf": cal.get("fetchedAt") or _now(),
        "source": sources[0],
        "sources": sources,
        "months": cal["months"],
        "nasdaqMonths": cal.get("nasdaqMonths") or [],
        "counts": counts,
        "upcoming": bags.get("upcoming") or [],
        "priced": bags.get("priced") or [],
        "filed": bags.get("filed") or [],
        "withdrawn": bags.get("withdrawn") or [],
        "uk": uk,
        "disclaimer": "IPO terms come from the listed source as of the refresh. Not an offer. Not financial advice.",
        "errors": cal.get("errors") or [],
    }
    dest = data_dir / "ipos.json"
    dest.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {dest} upcoming={counts['upcoming']} priced={counts['priced']} "
        f"filed={counts['filed']} withdrawn={counts['withdrawn']}",
        flush=True,
    )
    return added


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    quotes = {}
    qpath = DATA / "quotes.json"
    if qpath.exists():
        try:
            payload = json.loads(qpath.read_text(encoding="utf-8"))
            quotes = payload.get("quotes") or {}
        except Exception:
            quotes = {}
    added = write_ipos(DATA, quotes)
    if added:
        if qpath.exists():
            payload = json.loads(qpath.read_text(encoding="utf-8"))
        else:
            payload = {"source": "Yahoo Finance", "quotes": {}, "errors": []}
        payload.setdefault("quotes", {}).update(added)
        qpath.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        print(f"Merged {len(added)} IPO quotes into data/quotes.json", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
