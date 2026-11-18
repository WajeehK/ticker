#!/usr/bin/env python3
"""Build a searchable stock/ETF universe from public index lists.

Trading 212's official instruments endpoint requires an API key, and their
website is behind a Cloudflare challenge, so this file is assembled from
publicly published constituents of the S&P 500, Nasdaq-100 and FTSE 100,
plus a curated list of widely held ETFs (with issuer and published expense
ratio where known). It is not an official Trading 212 dump; it covers the
liquid names T212 users typically trade.
"""
from __future__ import annotations

import csv
import json
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UA = (
    "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; "
    "khurramwajeeh-d0ymqp@mail.grokbot.com)"
)
CTX = ssl.create_default_context()

SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
N100_WIKI = "https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies"
FTSE_WIKI = "https://en.wikipedia.org/wiki/FTSE_100_Index"

# Popular ETFs on Trading 212, with published ongoing charges / ER (percent).
# Figures are typical published fund documents and can change; not advice.
ETFS = [
    # US core
    ("SPY", "SPDR S&P 500 ETF Trust", "State Street", 0.09, "USD"),
    ("VOO", "Vanguard S&P 500 ETF", "Vanguard", 0.03, "USD"),
    ("IVV", "iShares Core S&P 500 ETF", "iShares", 0.03, "USD"),
    ("VTI", "Vanguard Total Stock Market ETF", "Vanguard", 0.03, "USD"),
    ("QQQ", "Invesco QQQ Trust", "Invesco", 0.20, "USD"),
    ("QQQM", "Invesco NASDAQ 100 ETF", "Invesco", 0.15, "USD"),
    ("IWM", "iShares Russell 2000 ETF", "iShares", 0.19, "USD"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF", "State Street", 0.16, "USD"),
    ("VEA", "Vanguard FTSE Developed Markets ETF", "Vanguard", 0.03, "USD"),
    ("VWO", "Vanguard FTSE Emerging Markets ETF", "Vanguard", 0.07, "USD"),
    ("EFA", "iShares MSCI EAFE ETF", "iShares", 0.32, "USD"),
    ("EEM", "iShares MSCI Emerging Markets ETF", "iShares", 0.68, "USD"),
    ("VIG", "Vanguard Dividend Appreciation ETF", "Vanguard", 0.06, "USD"),
    ("SCHD", "Schwab US Dividend Equity ETF", "Charles Schwab", 0.06, "USD"),
    ("SPYD", "SPDR Portfolio S&P 500 High Dividend ETF", "State Street", 0.07, "USD"),
    ("VYM", "Vanguard High Dividend Yield ETF", "Vanguard", 0.06, "USD"),
    ("DVY", "iShares Select Dividend ETF", "iShares", 0.38, "USD"),
    ("VNQ", "Vanguard Real Estate ETF", "Vanguard", 0.13, "USD"),
    # sectors / themes
    ("XLK", "Technology Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLF", "Financial Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLE", "Energy Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLV", "Health Care Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLY", "Consumer Discretionary Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLI", "Industrial Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLP", "Consumer Staples Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLU", "Utilities Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLB", "Materials Select Sector SPDR", "State Street", 0.08, "USD"),
    ("XLC", "Communication Services Select Sector SPDR", "State Street", 0.08, "USD"),
    ("SMH", "VanEck Semiconductor ETF", "VanEck", 0.35, "USD"),
    ("SOXX", "iShares Semiconductor ETF", "iShares", 0.35, "USD"),
    ("ARKK", "ARK Innovation ETF", "ARK", 0.75, "USD"),
    ("BOTZ", "Global X Robotics & Artificial Intelligence ETF", "Global X", 0.68, "USD"),
    ("AIQ", "Global X Artificial Intelligence & Technology ETF", "Global X", 0.68, "USD"),
    ("WCLD", "WisdomTree Cloud Computing ETF", "WisdomTree", 0.45, "USD"),
    ("IBIT", "iShares Bitcoin Trust", "iShares", 0.25, "USD"),
    ("FBTC", "Fidelity Wise Origin Bitcoin Fund", "Fidelity", 0.25, "USD"),
    # bonds / commodities
    ("BND", "Vanguard Total Bond Market ETF", "Vanguard", 0.03, "USD"),
    ("AGG", "iShares Core US Aggregate Bond ETF", "iShares", 0.03, "USD"),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "iShares", 0.15, "USD"),
    ("IEF", "iShares 7-10 Year Treasury Bond ETF", "iShares", 0.15, "USD"),
    ("SHY", "iShares 1-3 Year Treasury Bond ETF", "iShares", 0.15, "USD"),
    ("HYG", "iShares iBoxx High Yield Corporate Bond ETF", "iShares", 0.49, "USD"),
    ("LQD", "iShares iBoxx Investment Grade Corporate Bond ETF", "iShares", 0.14, "USD"),
    ("GLD", "SPDR Gold Shares", "State Street", 0.40, "USD"),
    ("IAU", "iShares Gold Trust", "iShares", 0.25, "USD"),
    ("SLV", "iShares Silver Trust", "iShares", 0.50, "USD"),
    ("USO", "United States Oil Fund", "USCF", 0.60, "USD"),
    # UK / LSE
    ("VUSA.L", "Vanguard S&P 500 UCITS ETF", "Vanguard", 0.07, "GBP"),
    ("VUAG.L", "Vanguard S&P 500 UCITS ETF (Acc)", "Vanguard", 0.07, "GBP"),
    ("VWRL.L", "Vanguard FTSE All-World UCITS ETF", "Vanguard", 0.22, "GBP"),
    ("VWRP.L", "Vanguard FTSE All-World UCITS ETF (Acc)", "Vanguard", 0.22, "GBP"),
    ("VUKE.L", "Vanguard FTSE 100 UCITS ETF", "Vanguard", 0.09, "GBP"),
    ("ISF.L", "iShares Core FTSE 100 UCITS ETF", "iShares", 0.07, "GBP"),
    ("CSP1.L", "iShares Core S&P 500 UCITS ETF", "iShares", 0.07, "GBP"),
    ("IUSA.L", "iShares S&P 500 UCITS ETF", "iShares", 0.07, "GBP"),
    ("SGLN.L", "iShares Physical Gold ETC", "iShares", 0.12, "GBP"),
    ("IGLT.L", "iShares Core UK Gilts UCITS ETF", "iShares", 0.07, "GBP"),
    ("VHYL.L", "Vanguard FTSE All-World High Dividend Yield UCITS ETF", "Vanguard", 0.29, "GBP"),
    ("VFEM.L", "Vanguard FTSE Emerging Markets UCITS ETF", "Vanguard", 0.22, "GBP"),
    ("VMID.L", "Vanguard FTSE 250 UCITS ETF", "Vanguard", 0.10, "GBP"),
    ("SWDA.L", "iShares Core MSCI World UCITS ETF", "iShares", 0.20, "GBP"),
    ("IWDA.L", "iShares Core MSCI World UCITS ETF (Acc)", "iShares", 0.20, "GBP"),
    ("EIMI.L", "iShares Core MSCI EM IMI UCITS ETF", "iShares", 0.18, "GBP"),
    ("EQQQ.L", "Invesco EQQQ Nasdaq-100 UCITS ETF", "Invesco", 0.30, "GBP"),
    ("CNDX.L", "iShares NASDAQ 100 UCITS ETF", "iShares", 0.33, "GBP"),
    ("INRG.L", "iShares Global Clean Energy UCITS ETF", "iShares", 0.65, "GBP"),
]


def fetch(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,text/csv,*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


def yahoo_us(sym: str) -> str:
    return sym.replace(".", "-").strip().upper()


def yahoo_lse(ticker: str) -> str:
    t = ticker.strip().upper().replace(" ", "")
    t = t.replace(".", "-")
    if t.endswith(".L"):
        return t
    return t + ".L"


def upsert(bag: dict, rec: dict) -> None:
    i = rec["id"]
    if i in bag:
        cur = bag[i]
        for k, v in rec.items():
            if k == "indices":
                cur["indices"] = sorted(set((cur.get("indices") or []) + (v or [])))
            elif k == "sector" and cur.get("sector") and v and cur["sector"] != v:
                pass
            elif v not in (None, "", [], {}):
                if not cur.get(k):
                    cur[k] = v
        return
    bag[i] = rec


class WikiTable(HTMLParser):
    def __init__(self, wanted_heads: tuple[str, ...]):
        super().__init__()
        self.wanted = wanted_heads
        self.tables: list[list[list[str]]] = []
        self._table = None
        self._row = None
        self._cell = None
        self._capture = False
        self._buf = []
        self._in_th = False
        self._heads: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            cls = " ".join(dict(attrs).get("class", "").split())
            if "wikitable" in cls:
                self._table = []
                self._heads = []
        elif self._table is not None and tag == "tr":
            self._row = []
        elif self._table is not None and tag in ("td", "th"):
            self._cell = []
            self._in_th = tag == "th"
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            text = re.sub(r"\s+", " ", "".join(self._cell)).strip()
            text = re.sub(r"\[[0-9]+\]", "", text).strip()
            self._row.append(text)
            if self._in_th:
                self._heads.append(text)
            self._cell = None
            self._in_th = False
        elif tag == "tr" and self._row is not None and self._table is not None:
            if self._row:
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            heads = [h.lower() for h in (self._table[0] if self._table else [])]
            blob = " ".join(heads)
            if all(w.lower() in blob for w in self.wanted):
                self.tables.append(self._table)
            self._table = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_sp500(text: str, bag: dict) -> int:
    n = 0
    rows = csv.DictReader(StringIO(text))
    for row in rows:
        raw = (row.get("Symbol") or row.get("Ticker") or "").strip()
        if not raw:
            continue
        sid = yahoo_us(raw)
        name = (row.get("Security") or row.get("Name") or sid).strip()
        sector = (row.get("GICS Sector") or row.get("Sector") or "").strip()
        sub = (row.get("GICS Sub-Industry") or "").strip()
        upsert(bag, {
            "id": sid, "symbol": sid, "name": name, "kind": "equity",
            "currency": "USD", "exchange": "US", "sector": sector or None,
            "industry": sub or None, "indices": ["SPX"], "liquid": True,
        })
        n += 1
    return n


def colmap(header: list[str], *names: str) -> int | None:
    low = [h.lower() for h in header]
    for n in names:
        for i, h in enumerate(low):
            if n in h:
                return i
    return None


def parse_n100(html: str, bag: dict) -> int:
    p = WikiTable(("ticker", "company"))
    p.feed(html)
    n = 0
    for table in p.tables:
        if not table:
            continue
        header = table[0]
        ti = colmap(header, "ticker", "symbol")
        ni = colmap(header, "company", "name")
        si = colmap(header, "industry", "icb industry", "sector")
        if ti is None or ni is None:
            continue
        for row in table[1:]:
            if len(row) <= max(ti, ni):
                continue
            raw = row[ti].split()[0] if row[ti] else ""
            if not raw or not re.match(r"^[A-Z][A-Z0-9.\-]{0,7}$", raw):
                continue
            sid = yahoo_us(raw)
            upsert(bag, {
                "id": sid, "symbol": sid, "name": row[ni], "kind": "equity",
                "currency": "USD", "exchange": "NASDAQ",
                "sector": (row[si] if si is not None and si < len(row) else None) or None,
                "indices": ["NDX"], "liquid": True,
            })
            n += 1
    return n


def parse_ftse(html: str, bag: dict) -> int:
    p = WikiTable(("ticker", "company"))
    p.feed(html)
    n = 0
    for table in p.tables:
        if not table:
            continue
        header = table[0]
        ti = colmap(header, "ticker", "symbol", "epic")
        ni = colmap(header, "company", "name")
        si = colmap(header, "sector", "industry")
        ii = colmap(header, "isin")
        if ti is None or ni is None:
            continue
        for row in table[1:]:
            if len(row) <= max(ti, ni):
                continue
            raw = row[ti].split()[0] if row[ti] else ""
            if not raw:
                continue
            sid = yahoo_lse(raw)
            upsert(bag, {
                "id": sid, "symbol": sid.replace(".L", ""), "name": row[ni],
                "kind": "equity", "currency": "GBP", "exchange": "LSE",
                "sector": (row[si] if si is not None and si < len(row) else None) or None,
                "isin": (row[ii] if ii is not None and ii < len(row) else None) or None,
                "indices": ["FTSE"], "liquid": True,
            })
            n += 1
    return n


def add_etfs(bag: dict) -> int:
    n = 0
    for sid, name, issuer, er, ccy in ETFS:
        rec = {
            "id": sid, "symbol": sid.replace(".L", ""), "name": name,
            "kind": "etf", "currency": ccy,
            "exchange": "LSE" if sid.endswith(".L") else "US",
            "issuer": issuer, "expenseRatio": er, "liquid": True,
            "indices": [],
        }
        upsert(bag, rec)
        # if already existed as equity, force etf kind + metadata
        bag[sid]["kind"] = "etf"
        bag[sid]["issuer"] = issuer
        bag[sid]["expenseRatio"] = er
        n += 1
    return n


def write_instruments(data_dir: Path | None = None) -> dict:
    data_dir = data_dir or DATA
    data_dir.mkdir(parents=True, exist_ok=True)
    bag: dict = {}
    notes = []
    try:
        raw = fetch(SP500_CSV).decode("utf-8", "replace")
        n = parse_sp500(raw, bag)
        notes.append(f"S&P 500: {n}")
        print(f"S&P 500 {n}", flush=True)
    except Exception as e:
        notes.append(f"S&P 500 failed: {e}")
        print("S&P 500 failed:", e, flush=True)
    try:
        html = fetch(N100_WIKI).decode("utf-8", "replace")
        n = parse_n100(html, bag)
        notes.append(f"Nasdaq-100: {n}")
        print(f"Nasdaq-100 {n}", flush=True)
    except Exception as e:
        notes.append(f"Nasdaq-100 failed: {e}")
        print("Nasdaq-100 failed:", e, flush=True)
    try:
        html = fetch(FTSE_WIKI).decode("utf-8", "replace")
        n = parse_ftse(html, bag)
        notes.append(f"FTSE 100: {n}")
        print(f"FTSE 100 {n}", flush=True)
    except Exception as e:
        notes.append(f"FTSE 100 failed: {e}")
        print("FTSE 100 failed:", e, flush=True)
    n = add_etfs(bag)
    notes.append(f"Curated ETFs: {n}")
    print(f"ETFs {n}", flush=True)

    items = sorted(bag.values(), key=lambda r: (r.get("kind") or "", r.get("id") or ""))
    out = {
        "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": (
            "Public index constituents (S&P 500, Nasdaq-100, FTSE 100) and a curated "
            "ETF list with published expense ratios. This is not an official Trading 212 "
            "instrument dump — their public API requires a personal API key. Quotes for "
            "a liquid subset are refreshed by the Action; other symbols can be searched "
            "and quoted on demand."
        ),
        "notes": notes,
        "count": len(items),
        "instruments": items,
    }
    path = data_dir / "instruments.json"
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(items)} instruments to {path}", flush=True)
    return out


def liquid_ids(data_dir: Path | None = None) -> list[str]:
    path = (data_dir or DATA) / "instruments.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [r["id"] for r in (data.get("instruments") or []) if r.get("id") and r.get("liquid")]


if __name__ == "__main__":
    write_instruments()
