#!/usr/bin/env python3
"""Build a generic, sourced AI analysis card per ticker.

Every catalyst has a fetched source URL. Bull/bear sentences only use
Nasdaq consensus/earnings already in analysis.json, StockAnalysis page
facts, or dated news headlines. No holdings are written.
"""
from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

CTX = ssl.create_default_context()
UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
)
SA_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-GB,en;q=0.9",
}
PREFERRED = ("MP", "USAR", "AAPL", "NVDA", "TSLA", "SPY", "VUSA.L")

# Headlines that look like a dated catalyst, not a generic opinion piece.
CAT_RE = re.compile(
    r"\b(earnings|eps|revenue|q[1-4]\b|contract|award|deal|agreement|"
    r"department of defense|pentagon|\bdod\b|department of energy|"
    r"production|shipment|plant|facility|mine|magnet|commission|"
    r"policy|tariff|subsidy|export control|export ban|export restriction|"
    r"reprieve|quota|rare[- ]earth|ndpr|china)\b",
    re.I,
)
SKIP_RE = re.compile(
    r"could be worth|jump 10x|what does .* mean for|stock looks|"
    r"how risky|price, news, quote and history|equity price and quote",
    re.I,
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _date_en(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return datetime.strptime(str(iso)[:10], "%Y-%m-%d").strftime("%-d %b %Y")
    except Exception:
        return str(iso)[:10]


def _money(n, ccy="USD") -> str:
    if n is None:
        return "n/a"
    sign = "$" if ccy in ("USD", None) else ("£" if ccy == "GBP" else f"{ccy} ")
    return f"{sign}{abs(n):,.2f}" if abs(n) >= 1 else f"{sign}{abs(n):,.4f}".rstrip("0").rstrip(".")


def _get(url: str, timeout: int = 18) -> str | None:
    req = urllib.request.Request(url, headers=SA_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            if r.status != 200:
                return None
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None


def _sa_url(sym: str) -> str | None:
    if not sym or sym.startswith("^") or sym.endswith("=X") or "-USD" in sym:
        return None
    if sym.endswith(".L"):
        return f"https://stockanalysis.com/quote/lon/{sym[:-2].lower()}/"
    if "." in sym:
        return None
    return f"https://stockanalysis.com/stocks/{sym.lower()}/"


def parse_stockanalysis(sym: str, html: str) -> dict:
    out = {"url": _sa_url(sym), "earningsDate": None, "analysts": None, "target": None, "items": []}
    m = re.search(r'earningsDate:"([^"]+)"', html)
    if m:
        # StockAnalysis sometimes lists the last report as "Earnings Date"
        out["earningsDate"] = m.group(1)
    m = re.search(r'analysts:"([^"]+)"', html)
    if m:
        out["analysts"] = m.group(1)
    m = re.search(r'target:"([^"]+)"', html)
    if m:
        out["target"] = m.group(1)

    # News / filing / transcript links with a visible title
    seen = set()
    for href, inner in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S):
        title = unescape(re.sub(r"<[^>]+>", " ", inner))
        title = " ".join(title.split())
        if len(title) < 28 or title.lower() in seen:
            continue
        if not CAT_RE.search(title) or SKIP_RE.search(title):
            continue
        if href.startswith("/"):
            href = "https://stockanalysis.com" + href
        if not href.startswith("http"):
            continue
        seen.add(title.lower())
        # Prefer an explicit date in the title or nearby "published on Month D, YYYY"
        date = None
        dm = re.search(
            r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}",
            title,
        )
        if dm:
            try:
                date = datetime.strptime(dm.group(0), "%B %d, %Y").strftime("%Y-%m-%d")
            except Exception:
                date = None
        if not date:
            ym = re.search(r"\bQ[1-4]\s+20\d{2}\b", title)
            # leave date empty unless we have a calendar date
        out["items"].append({"title": title, "url": href, "source": "StockAnalysis", "published": date})
        if len(out["items"]) >= 8:
            break
    return out


def fetch_sa(sym: str) -> dict | None:
    url = _sa_url(sym)
    if not url:
        return None
    html = _get(url)
    if not html or "earningsDate" not in html and "Stock Price" not in html:
        return None
    return parse_stockanalysis(sym, html)


def _classify(title: str) -> str:
    t = title.lower()
    if re.search(r"earnings|eps|revenue|q[1-4]\b", t):
        return "earnings"
    if re.search(r"department of defense|pentagon|\bdod\b|government|department of energy", t):
        return "government"
    if re.search(r"contract|award|deal|agreement", t):
        return "contract"
    if re.search(r"export control|export ban|reprieve|quota|china|policy|tariff", t):
        return "policy"
    if re.search(r"rare[- ]earth|ndpr|pricing", t):
        return "pricing"
    if re.search(r"production|shipment|plant|facility|mine|magnet|commission", t):
        return "production"
    return "news"


def _eps(n):
    if n is None:
        return None
    try:
        x = float(n)
    except (TypeError, ValueError):
        return None
    sign = "-" if x < 0 else ""
    return f"{sign}${abs(x):.2f}"


def build_one(sym: str, quote: dict, analysis: dict, news_items: list, sa: dict | None, as_of: str) -> dict:
    name = (quote or {}).get("name") or (quote or {}).get("shortName") or sym
    ccy = ((analysis.get("targets") or {}).get("currency") if analysis else None) or (quote or {}).get("currency") or "USD"
    price = (quote or {}).get("price")
    cons = (analysis or {}).get("consensus") or {}
    targets = (analysis or {}).get("targets") or {}
    last_e = (analysis or {}).get("lastEarnings") or {}
    bull, bear, cats = [], [], []
    seen = set()

    def add_cat(date, title, url, source, kind):
        if not title or not url:
            return
        key = title.strip().lower()
        if key in seen or SKIP_RE.search(title):
            return
        seen.add(key)
        rec = {"title": title.strip(), "url": url, "source": source, "kind": kind}
        if date:
            rec["date"] = str(date)[:10]
            rec["dateLabel"] = _date_en(str(date)[:10])
        cats.append(rec)

    # Earnings from Nasdaq analysis
    if last_e.get("dateReported"):
        d = last_e["dateReported"]
        eps, fc, sur = last_e.get("eps"), last_e.get("consensusForecast"), last_e.get("surprisePct")
        qtr = last_e.get("fiscalQtrEnd") or "latest quarter"
        bits = f"Reported {qtr} results on {_date_en(d)}"
        if eps is not None and fc is not None:
            bits += f": EPS {_eps(eps)} vs {_eps(fc)} consensus"
            if sur is not None:
                bits += f" ({sur:+.0f}% surprise)"
        bits += "."
        add_cat(d, bits, "https://www.nasdaq.com/market-activity/stocks/" + re.sub(r"[^A-Z0-9]", "", sym.upper()) + "/earnings", "Nasdaq", "earnings")
        if eps is not None and fc is not None:
            if (sur or 0) >= 0:
                bull.append({"text": f"{name} {bits}", "source": "Nasdaq", "url": cats[-1]["url"]})
            else:
                bear.append({"text": f"{name} {bits}", "source": "Nasdaq", "url": cats[-1]["url"]})

    rating = None
    if isinstance(cons, dict):
        rating = cons.get("key") or cons.get("rating") or cons.get("consensus") or cons.get("label") or cons.get("recommendation")
    elif cons:
        rating = str(cons)

    mean = targets.get("mean")
    upside = (analysis or {}).get("impliedUpsidePct")
    if rating and mean is not None and price not in (None, 0):
        txt = (
            f"Nasdaq’s published consensus on {name} is {rating}"
            f" with a mean price target of {_money(mean, ccy)}"
        )
        if upside is not None:
            txt += f", {upside:+.0f}% versus the latest price of {_money(price, ccy)}"
        txt += "."
        url = "https://www.nasdaq.com/market-activity/stocks/" + re.sub(r"[^A-Z0-9]", "", sym.upper()) + "/analyst-research"
        rec = {"text": txt, "source": "Nasdaq", "url": url}
        low = (rating or "").lower()
        if any(w in low for w in ("buy", "overweight", "outperform")) and (upside or 0) >= 0:
            bull.append(rec)
        elif any(w in low for w in ("sell", "underweight", "underperform")) or (upside or 0) < 0:
            bear.append(rec)
        else:
            # Hold / mixed: mention in both, as a sourced stance, only if we have no other line
            pass

    vs50 = (analysis or {}).get("vsSma50Pct")
    sma50 = (analysis or {}).get("sma50")
    vs200 = (analysis or {}).get("vsSma200Pct")
    sma200 = (analysis or {}).get("sma200")
    if vs50 is not None and sma50 is not None and price is not None:
        side = bear if vs50 < 0 else bull
        side.append({
            "text": (
                f"The share price is {vs50:+.1f}% versus its 50-day average of {_money(sma50, ccy)}"
                + (f" and {vs200:+.1f}% versus its 200-day average of {_money(sma200, ccy)}" if vs200 is not None and sma200 is not None else "")
                + " (Yahoo Finance daily closes)."
            ),
            "source": "Yahoo Finance",
            "url": f"https://finance.yahoo.com/quote/{sym}/",
        })

    # StockAnalysis items
    if sa:
        sa_url = sa.get("url") or _sa_url(sym)
        if sa.get("analysts") and sa.get("target"):
            bull.append({
                "text": f"StockAnalysis lists analyst consensus as {sa['analysts']} with a stated target of {sa['target'] if str(sa['target']).lstrip('-+').startswith(('$','£')) else '$' + str(sa['target'])}.",
                "source": "StockAnalysis",
                "url": sa_url,
            }) if "buy" in (sa.get("analysts") or "").lower() or "overweight" in (sa.get("analysts") or "").lower() else None
            if "sell" in (sa.get("analysts") or "").lower():
                bear.append({
                    "text": f"StockAnalysis lists analyst consensus as {sa['analysts']} with a stated target of {sa['target'] if str(sa['target']).lstrip('-+').startswith(('$','£')) else '$' + str(sa['target'])}.",
                    "source": "StockAnalysis",
                    "url": sa_url,
                })
        for it in sa.get("items") or []:
            add_cat(it.get("published"), it["title"], it["url"], it.get("source") or "StockAnalysis", _classify(it["title"]))

    # Dated news headlines that look like catalysts
    for item in news_items or []:
        title = (item.get("title") or "").strip()
        url = item.get("url") or item.get("canonical") or item.get("link")
        if not title or not url:
            continue
        if not CAT_RE.search(title):
            continue
        add_cat(item.get("published"), title, url, item.get("source") or "News", _classify(title))
        if len([c for c in cats if c.get("kind") != "earnings"]) >= 6:
            break

    # Dedup bull/bear texts
    def uniq(rows):
        out, seen_t = [], set()
        for r in rows:
            k = (r.get("text") or "").strip()
            if not k or k in seen_t:
                continue
            seen_t.add(k)
            out.append(r)
        return out[:3]

    return {
        "asOf": as_of,
        "label": "AI-generated, not financial advice",
        "sourceNote": "Built from Nasdaq, Yahoo Finance, StockAnalysis and published headlines. No holdings data.",
        "bull": uniq(bull),
        "bear": uniq(bear),
        "catalysts": cats[:8],
    }


def write_ai_analysis(data_dir: Path, quotes: dict | None = None) -> dict:
    data_dir = Path(data_dir)
    as_of = _now()
    analysis, news = {}, {}
    try:
        analysis = json.loads((data_dir / "analysis.json").read_text()).get("bySymbol") or {}
    except Exception:
        analysis = {}
    try:
        news = json.loads((data_dir / "news.json").read_text()).get("bySymbol") or {}
    except Exception:
        news = {}
    if quotes is None:
        try:
            quotes = json.loads((data_dir / "quotes.json").read_text()).get("quotes") or {}
        except Exception:
            quotes = {}

    symbols = []
    seen = set()
    for group in (PREFERRED, analysis.keys(), quotes.keys()):
        for s in group:
            if not s or s in seen:
                continue
            q = quotes.get(s) or {}
            kind = q.get("kind") or ""
            if kind in ("crypto", "fx") or str(s).endswith("-USD") or str(s).endswith("=X"):
                continue
            if kind in ("commodity", "index", "yield") and s not in PREFERRED and s not in analysis:
                continue
            seen.add(s)
            symbols.append(s)

    # Fetch StockAnalysis for preferred names plus those with news, cap to keep the Action lean
    sa_targets = []
    for s in symbols:
        if s in PREFERRED or (s in news and len(sa_targets) < 40):
            if _sa_url(s):
                sa_targets.append(s)
    sa_by = {}
    if sa_targets:
        print(f"  ai analysis: fetching StockAnalysis for {len(sa_targets)} symbols", flush=True)
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = {pool.submit(fetch_sa, s): s for s in sa_targets}
            for fut in as_completed(futs):
                s = futs[fut]
                try:
                    rec = fut.result()
                except Exception:
                    rec = None
                if rec:
                    sa_by[s] = rec

    by = {}
    for s in symbols:
        rec = build_one(s, quotes.get(s) or {}, analysis.get(s) or {}, news.get(s) or [], sa_by.get(s), as_of)
        if rec["bull"] or rec["bear"] or rec["catalysts"]:
            by[s] = rec

    payload = {
        "generated_at": as_of,
        "label": "AI-generated, not financial advice",
        "bySymbol": by,
        "covered": len(by),
        "universe": len(symbols),
    }
    (data_dir / "ai_analysis.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote AI analysis for {len(by)} symbols", flush=True)
    return payload


if __name__ == "__main__":
    write_ai_analysis(Path(__file__).resolve().parents[1] / "data")
