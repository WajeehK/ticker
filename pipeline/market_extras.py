#!/usr/bin/env python3
"""Market extras written by the scheduled refresh: news, Fear & Greed, earnings dates.

All fetches are server-side (RSS and some APIs have no CORS). Never invents items.
Earnings are attempted twice; if they fail, they are omitted and reported.
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

CTX = ssl.create_default_context()

FEEDS = [
    ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml"),
    ("Google Business", "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-GB&gl=GB&ceid=GB:en"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
]

# Core symbols get their own Google News query (kept small to avoid rate limits)
NEWS_CORE = [
    "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "SPY", "QQQ",
    "VUSA.L", "HSBA.L", "AZN.L", "SHEL.L", "BP.L", "GSK.L", "ULVR.L",
    "JPM", "LLY", "AVGO", "AMD", "^GSPC", "^FTSE",
]

QUERIES = {
    "AAPL": "AAPL Apple stock",
    "NVDA": "NVDA Nvidia stock",
    "TSLA": "TSLA Tesla stock",
    "MSFT": "MSFT Microsoft stock",
    "AMZN": "AMZN Amazon stock",
    "GOOGL": "GOOGL Alphabet Google stock",
    "META": "META Facebook stock",
    "SPY": "SPY S&P 500 ETF",
    "QQQ": "QQQ Nasdaq ETF",
    "VUSA.L": "Vanguard S&P 500 VUSA ETF",
    "HSBA.L": "HSBC share price",
    "AZN.L": "AstraZeneca share price",
    "SHEL.L": "Shell share price",
    "BP.L": "BP share price",
    "GSK.L": "GSK share price",
    "ULVR.L": "Unilever share price",
    "JPM": "JPMorgan stock",
    "LLY": "Eli Lilly stock",
    "AVGO": "Broadcom AVGO stock",
    "AMD": "AMD stock",
    "^GSPC": "S&P 500 index",
    "^FTSE": "FTSE 100 index",
}


def _open(url: str, ua: str, tries: int = 2, timeout: int = 20) -> bytes | None:
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                if r.status != 200:
                    last = f"HTTP {r.status}"
                    time.sleep(1.2 * (i + 1))
                    continue
                return r.read()
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 * (i + 1))
                continue
            return None
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.0 * (i + 1))
    return None


def _parse_rss(raw: bytes, source: str, limit: int = 15) -> list[dict]:
    items = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return items
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        if not title or not link:
            continue
        pub = (it.findtext("pubDate") or it.findtext("published") or "").strip()
        iso = ""
        if pub:
            try:
                iso = parsedate_to_datetime(pub).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except Exception:
                iso = pub
        # Google News titles often end with " - Publisher"
        publisher = source
        if " - " in title:
            maybe = title.rsplit(" - ", 1)
            if len(maybe[1]) < 40:
                title, publisher = maybe[0], maybe[1]
        items.append({"title": title, "url": link, "source": publisher, "published": iso})
        if len(items) >= limit:
            break
    return items


def fear_greed(ua: str) -> dict | None:
    raw = _open("https://api.alternative.me/fng/?limit=1&format=json", ua)
    if not raw:
        return None
    try:
        d = json.loads(raw)
        row = (d.get("data") or [None])[0]
        if not row:
            return None
        return {
            "value": int(row.get("value")),
            "classification": row.get("value_classification"),
            "asOf": int(row.get("timestamp")) if str(row.get("timestamp", "")).isdigit() else None,
            "source": "alternative.me Fear and Greed Index",
        }
    except Exception:
        return None


def fetch_earnings(symbols: list[str], ua: str, errors: list[str]) -> dict:
    """Try Yahoo quoteSummary calendarEvents. Give up after two failures."""
    out = {}
    fails = 0
    for sym in symbols:
        if fails >= 2:
            errors.append("earnings: Yahoo calendarEvents failed twice; skipped for the rest")
            break
        url = (
            "https://query1.finance.yahoo.com/v10/finance/quoteSummary/"
            + urllib.parse.quote(sym, safe="")
            + "?modules=calendarEvents"
        )
        raw = _open(url, ua, tries=2)
        if not raw:
            fails += 1
            errors.append(f"earnings {sym}: no data")
            continue
        try:
            d = json.loads(raw)
        except Exception as e:
            fails += 1
            errors.append(f"earnings {sym}: {e}")
            continue
        err = (d.get("quoteSummary") or {}).get("error")
        if err or not (d.get("quoteSummary") or {}).get("result"):
            fails += 1
            errors.append(f"earnings {sym}: {err or 'empty'}")
            continue
        fails = 0
        res = d["quoteSummary"]["result"][0]
        cal = (res.get("calendarEvents") or {}).get("earnings") or {}
        dates = cal.get("earningsDate") or []
        # dates may be {raw, fmt} dicts
        picked = []
        for x in dates:
            if isinstance(x, dict) and x.get("raw"):
                picked.append(int(x["raw"]))
            elif isinstance(x, (int, float)):
                picked.append(int(x))
        if picked:
            out[sym] = {"earningsDates": picked}
    return out


def write_market(data_dir: Path, quotes: dict, ua: str) -> None:
    errors: list[str] = []
    market: list[dict] = []
    seen = set()
    for source, url in FEEDS:
        raw = _open(url, ua)
        if not raw:
            errors.append(f"news feed failed: {source}")
            continue
        for it in _parse_rss(raw, source, limit=12):
            key = it["title"].lower()
            if key in seen:
                continue
            seen.add(key)
            market.append(it)
        time.sleep(0.3)

    by_symbol: dict = {}
    for sym in NEWS_CORE:
        q = QUERIES.get(sym) or sym
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
            {"q": q, "hl": "en-GB", "gl": "GB", "ceid": "GB:en"}
        )
        raw = _open(url, ua)
        if not raw:
            errors.append(f"symbol news failed: {sym}")
            time.sleep(0.4)
            continue
        items = _parse_rss(raw, "Google News", limit=6)
        if items:
            by_symbol[sym] = items
        time.sleep(0.35)

    fng = fear_greed(ua)
    if not fng:
        errors.append("fear & greed: unavailable")

    # earnings only for a short core; two failures and we stop
    earn_syms = [s for s in ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "AZN.L", "HSBA.L", "SHEL.L"] if s in (quotes or {})]
    earnings = fetch_earnings(earn_syms, ua, errors)

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fng": fng,
        "market": market[:40],
        "bySymbol": by_symbol,
        "earnings": earnings,
        "errors": errors,
        "delay": "News and the Fear & Greed Index are refreshed with the scheduled quotes job (about every 15 minutes; Actions can run late).",
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "news.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(
        f"  market extras: {len(market)} headlines, {len(by_symbol)} symbol feeds, "
        f"fng={'yes' if fng else 'no'}, earnings={len(earnings)}, errors={len(errors)}",
        flush=True,
    )
    for e in errors:
        print("   ", e, flush=True)


if __name__ == "__main__":
    import sys
    ua = "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; khurramwajeeh-d0ymqp@mail.grokbot.com)"
    root = Path(__file__).resolve().parents[1]
    quotes = {}
    qf = root / "data" / "quotes.json"
    if qf.exists():
        quotes = json.loads(qf.read_text()).get("quotes") or {}
    write_market(root / "data", quotes, ua)
