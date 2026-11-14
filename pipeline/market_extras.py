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
from html import unescape
from pathlib import Path

CTX = ssl.create_default_context()

FEEDS = [
    ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml"),
    ("Google Business", "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-GB&gl=GB&ceid=GB:en"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
]

# Core symbols get their own Google News query (kept small to avoid rate limits)
NEWS_CORE = [
    "USAR", "MP",
    "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "SPY", "QQQ",
    "VUSA.L", "HSBA.L", "AZN.L", "SHEL.L", "BP.L", "GSK.L", "ULVR.L",
    "JPM", "LLY", "AVGO", "AMD", "^GSPC", "^FTSE",
]

QUERIES = {
    "USAR": 'USAR "USA Rare Earth" OR "rare earth" stock',
    "MP": 'MP Materials "rare earth" OR "rare earths" stock',
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
        thumb = None
        # media:content / media:thumbnail (Google News sometimes includes one)
        for tag in it.iter():
            tn = tag.tag.lower() if isinstance(tag.tag, str) else ""
            if tn.endswith("thumbnail") or tn.endswith("content") or tn.endswith("enclosure"):
                url_t = tag.attrib.get("url") or tag.attrib.get("href")
                typ = (tag.attrib.get("type") or "") + (tag.attrib.get("medium") or "")
                if url_t and (not typ or "image" in typ or url_t.endswith((".jpg",".jpeg",".png",".webp"))):
                    thumb = url_t
                    break
        if not thumb:
            desc = it.findtext("description") or ""
            if "<img" in desc and "src=" in desc:
                import re as _re
                m = _re.search(r'<img[^>]+src=["\']([^"\']+)', desc)
                if m:
                    thumb = m.group(1)
        rec = {"title": title, "url": link, "source": publisher, "published": iso}
        if thumb:
            rec["thumbnail"] = thumb
        items.append(rec)
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



import re
from bs4 import BeautifulSoup

MARKET_RE = re.compile(
    r"\b("
    r"stock|stocks|share|shares|equity|equities|etf|etfs|nasdaq|nyse|dow|ftse|s&p|sp500|"
    r"market|markets|wall street|ipo|earnings|dividend|dividends|trader|trading|investor|"
    r"investors|broker|portfolio|ticker|listed|valuation|bull|bear|rally|selloff|sell-off|"
    r"futures|commodity|commodities|oil|crude|brent|wti|gold|silver|copper|natural gas|"
    r"inflation|interest rate|interest rates|federal reserve|the fed|bank of england|"
    r"recession|bond|bonds|gilt|yield|bitcoin|crypto|cryptocurrency|ethereum"
    r")\b",
    re.I,
)
CRYPTO_RE = re.compile(
    r"\b("
    r"crypto|cryptocurrency|cryptocurrencies|bitcoin|btc|ethereum|ether|eth|solana|sol|"
    r"blockchain|token|tokens|defi|stablecoin|coinbase|binance|kraken|web3|altcoin|"
    r"memecoin|dogecoin|xrp|ripple"
    r")\b",
    re.I,
)
TICKER_RE = re.compile(r"\b([A-Z]{1,5}|[A-Z0-9]+(?:\.[A-Z])?)\b")


def _norm_title(t: str) -> str:
    t = (t or "").lower().strip()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[\'\u2018\u2019\u201c\u201d\"]+", "", t)
    # drop trailing source after a dash if short
    t = re.sub(r"\s+[-–—]\s+[^-–—]{2,40}$", "", t)
    return t


def _is_crypto_item(it: dict) -> bool:
    src = (it.get("source") or "")
    blob = " ".join([it.get("title") or "", it.get("source") or "", it.get("summary") or ""])
    if src.lower() in ("coindesk", "cointelegraph", "the block", "decrypt"):
        return True
    return bool(CRYPTO_RE.search(blob))


def _is_market_item(it: dict, tickers: set[str], names: list[str]) -> bool:
    title = it.get("title") or ""
    blob = title + " " + (it.get("summary") or "")
    if MARKET_RE.search(blob):
        return True
    if _is_crypto_item(it):
        return True
    up = title.upper()
    skip = {"NOW", "ALL", "FOR", "THE", "ARE", "HAS", "WHO", "NEW", "OUT", "DAY", "ONE", "TWO", "CAN", "MAY", "SAY", "GET", "OWN", "PER", "VIA", "AND", "BUT", "NOT", "YOU", "ITS", "WAS", "HIS", "HER", "OUR", "ANY", "BIG", "LOW", "TOP", "INC", "LTD", "PLC", "CEO", "ATO", "SEE", "SET", "SUN", "AIR", "GAS"}
    for t in tickers:
        tu = (t or "").upper().split(".")[0]
        if not tu or tu in skip or len(tu) < 2:
            continue
        if re.search(r"\b" + re.escape(tu) + r"\b", up):
            return True
    low = title.lower()
    skip_tok = {"the", "usa", "united", "group", "global", "international", "plc", "inc", "ltd", "holdings", "land"}
    for n in names:
        if n and len(n) > 3 and n in low:
            return True
        tok = (n.split() or [""])[0]
        if tok and len(tok) > 4 and tok not in skip_tok and tok in low:
            return True
    return False


def _enrich_one(it: dict, ua: str) -> dict:
    """Best-effort og:image + article text. Never invents body copy."""
    url = it.get("url") or ""
    if not url:
        return it
    raw = _open(url, ua, tries=1, timeout=12)
    if not raw:
        return it
    try:
        html = raw.decode("utf-8", "replace")
    except Exception:
        return it
    soup = BeautifulSoup(html, "lxml")
    def _meta(*keys):
        for k in keys:
            tag = soup.find("meta", property=k) or soup.find("meta", attrs={"name": k})
            if tag and tag.get("content"):
                return tag["content"].strip()
        return None
    img = it.get("thumbnail") or _meta("og:image", "og:image:url", "twitter:image")
    if img and img.startswith("//"):
        img = "https:" + img
    if img:
        it["thumbnail"] = img
    title = _meta("og:title")
    if title and len(title) > 8 and not it.get("title"):
        it["title"] = unescape(title)
    # article body
    article = soup.find("article") or soup.find("div", attrs={"itemprop": "articleBody"})
    root = article or soup
    paras = []
    for p in root.find_all("p"):
        tx = " ".join(p.get_text(" ", strip=True).split())
        if len(tx) < 40:
            continue
        if re.search(r"cookie|subscribe|sign in|log in|advertisement|enable javascript", tx, re.I):
            continue
        paras.append(tx)
        if len(paras) >= 40:
            break
    text = "\n\n".join(paras).strip()
    if len(text) > 280:
        it["text"] = text[:12000]
        it["excerpt"] = (paras[0] if paras else text[:400])[:400]
    return it


def _enrich_many(items: list[dict], ua: str, limit: int) -> None:
    n = 0
    for it in items:
        if n >= limit:
            break
        need = (not it.get("thumbnail")) or (not it.get("text"))
        if not need:
            continue
        try:
            _enrich_one(it, ua)
            n += 1
        except Exception:
            pass
        time.sleep(0.2)

def write_market(data_dir: Path, quotes: dict, ua: str) -> None:
    errors: list[str] = []
    raw_items: list[dict] = []
    seen = set()
    for source, url in FEEDS:
        raw = _open(url, ua)
        if not raw:
            errors.append(f"news feed failed: {source}")
            continue
        for it in _parse_rss(raw, source, limit=16):
            key = _norm_title(it["title"])
            if not key or key in seen:
                continue
            seen.add(key)
            it["_feed"] = source
            raw_items.append(it)
        time.sleep(0.3)

    tickers = set((quotes or {}).keys())
    names = []
    for rec in (quotes or {}).values():
        n = (rec or {}).get("name") or (rec or {}).get("shortName") or ""
        n = n.split(",")[0].split("(")[0].strip().lower()
        if n:
            names.append(n)
    market: list[dict] = []
    crypto: list[dict] = []
    for it in raw_items:
        if _is_crypto_item(it):
            crypto.append(it)
            continue
        if _is_market_item(it, tickers, names):
            market.append(it)

    def _query_for(sym: str, rec: dict | None) -> str:
        if sym in QUERIES:
            return QUERIES[sym]
        name = (rec or {}).get("name") or (rec or {}).get("shortName") or ""
        kind = (rec or {}).get("kind") or ""
        if kind == "index":
            return f"{name} {sym} index".strip()
        # ticker + company name; no invented keywords
        return f"{sym} {name} stock".strip()

    by_symbol: dict = {}
    rest = [
        s for s, rec in (quotes or {}).items()
        if rec and rec.get("ok") and rec.get("kind") in ("equity", "etf", "index") and s not in NEWS_CORE
    ]
    news_symbols = [s for s in NEWS_CORE] + rest
    for sym in news_symbols:
        rec = (quotes or {}).get(sym) or {}
        q = _query_for(sym, rec)
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
            {"q": q, "hl": "en-GB", "gl": "GB", "ceid": "GB:en"}
        )
        raw = _open(url, ua)
        if not raw:
            errors.append(f"symbol news failed: {sym}")
            time.sleep(0.4)
            continue
        items = _parse_rss(raw, "Google News", limit=8)
        uniq, local = [], set()
        for it in items:
            k = _norm_title(it["title"])
            if not k or k in local or k in seen:
                continue
            local.add(k)
            uniq.append(it)
        if uniq:
            by_symbol[sym] = uniq
        time.sleep(0.28)

    fng = fear_greed(ua)
    if not fng:
        errors.append("fear & greed: unavailable")

    # earnings only for a short core; two failures and we stop
    earn_syms = [s for s in ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "AZN.L", "HSBA.L", "SHEL.L"] if s in (quotes or {})]
    earnings = fetch_earnings(earn_syms, ua, errors)

    # Deduped, readable cards: og:image + extracted article text for the top items
    _enrich_many(market[:18] + crypto[:10], ua, limit=24)
    for items in list(by_symbol.values())[:12]:
        _enrich_many(items[:2], ua, limit=2)

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fng": fng,
        "market": market[:40],
        "crypto": crypto[:24],
        "bySymbol": by_symbol,
        "earnings": earnings,
        "errors": errors,
        "delay": "News and the Fear & Greed Index are refreshed with the scheduled quotes job (about every 15 minutes; Actions can run late). Headlines are deduped and limited to market or company stories; crypto wires sit on the Crypto tab.",
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "news.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(
        f"  market extras: {len(market)} market, {len(crypto)} crypto, {len(by_symbol)} symbol feeds, "
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
