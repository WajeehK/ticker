#!/usr/bin/env python3
"""Analyst consensus, price targets and a rule-based outlook.

Yahoo Finance quoteSummary (financialData, recommendationTrend, etc.) failed
twice from this environment (crumb endpoint HTTP 429). This module uses the
public Nasdaq analyst APIs instead. It never invents a number or a catalyst:
fields that the source omits are left out of the outlook.
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CTX = ssl.create_default_context()
NASDAQ = "https://api.nasdaq.com/api"
# Browser-like headers: Nasdaq's public website API rejects empty/UA-less clients.
ND_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}

# Yahoo quoteSummary was attempted this many times and then dropped.
YAHOO_SUMMARY_FAILURES = [
    "Yahoo quoteSummary crumb (TickerPWA UA): HTTP 429",
    "Yahoo quoteSummary crumb (Chrome UA): HTTP 429",
]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_json(url: str, headers: dict, tries: int = 2, timeout: int = 20):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                if r.status != 200:
                    last = f"HTTP {r.status}"
                    time.sleep(1.2 * (i + 1))
                    continue
                return json.loads(r.read().decode("utf-8")), None
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 * (i + 1))
                continue
            return None, last
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.0 * (i + 1))
    return None, last


def nasdaq_symbol(sym: str) -> str | None:
    """Nasdaq's analyst API covers US-listed tickers, not London (.L) or indices."""
    if not sym or sym.startswith("^") or sym.endswith("=X") or "-" in sym and sym.endswith("-USD"):
        return None
    if "." in sym:
        return None
    return sym


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse_mdy(s: str) -> str | None:
    """'11/9/2026' or '11/09/2026' -> ISO date."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def fetch_nasdaq(sym: str) -> tuple[dict | None, list[str]]:
    errors = []
    out: dict = {"source": "Nasdaq Global Indexes / Nasdaq Data Link public website API", "asOf": _now()}
    key = urllib.parse.quote(sym)

    data, err = _get_json(f"{NASDAQ}/analyst/{key}/targetprice", ND_HEADERS)
    if err or not data or not data.get("data"):
        errors.append(f"{sym} targetprice: {err or 'no data'}")
    else:
        d = data["data"] or {}
        ov = d.get("consensusOverview") or {}
        low, high, mean = _num(ov.get("lowPriceTarget")), _num(ov.get("highPriceTarget")), _num(ov.get("priceTarget"))
        buy, hold, sell = int(ov.get("buy") or 0), int(ov.get("hold") or 0), int(ov.get("sell") or 0)
        n = buy + hold + sell
        if mean is not None or n:
            out["targets"] = {
                "low": low,
                "high": high,
                "mean": mean,
                "median": None,  # Nasdaq does not publish a median
                "currency": "USD",
            }
            out["consensus"] = {
                "strongBuy": None,
                "buy": buy,
                "hold": hold,
                "sell": sell,
                "strongSell": None,
                "n": n or None,
                "key": None,  # filled from ratings or from counts
                "scheme": "buy-hold-sell",
            }
        hist = d.get("historicalConsensus") or []
        changes = []
        prev_key = None
        for row in hist:
            z = row.get("z") or {}
            keyc = z.get("consensus")
            date = z.get("date")
            if keyc and keyc != prev_key and prev_key is not None:
                changes.append({
                    "date": _parse_mdy(date) if date else None,
                    "label": f"Consensus moved from {prev_key} to {keyc}",
                    "from": prev_key,
                    "to": keyc,
                    "buy": z.get("buy"),
                    "hold": z.get("hold"),
                    "sell": z.get("sell"),
                })
            prev_key = keyc
        if changes:
            out["ratingChanges"] = changes[-6:]
        if hist:
            last = hist[-1].get("z") or {}
            out["consensusHistoryAsOf"] = _parse_mdy(last.get("date") or "") if last.get("date") else None

    data, err = _get_json(f"{NASDAQ}/analyst/{key}/ratings", ND_HEADERS)
    if err or not data or not data.get("data"):
        errors.append(f"{sym} ratings: {err or 'no data'}")
    else:
        d = data["data"] or {}
        mean_type = d.get("meanRatingType")
        if mean_type:
            out.setdefault("consensus", {})["key"] = str(mean_type).strip()
        summary = d.get("ratingsSummary") or ""
        # "Based on 11 analysts offering recommendations for 'MP'."
        if summary:
            out.setdefault("consensus", {})["summary"] = summary
        ups = []
        for row in (d.get("upgradesDowngrades") or []):
            # Keep whatever fields exist; do not invent.
            rec = {}
            for k in ("firm", "brokerName", "action", "fromGrade", "toGrade", "date", "epochGradeDate"):
                if row.get(k) not in (None, ""):
                    rec[k] = row[k]
            if rec:
                ups.append(rec)
        if ups:
            out["upgradesDowngrades"] = ups[:12]
        brokers = d.get("brokerNames") or []
        if brokers:
            out["brokers"] = list(brokers)

    # Fill consensus key from counts if ratings omitted it
    c = out.get("consensus") or {}
    if not c.get("key") and c.get("n"):
        b, h, s = c.get("buy") or 0, c.get("hold") or 0, c.get("sell") or 0
        if b >= h and b >= s and b:
            c["key"] = "Buy"
        elif s >= b and s >= h and s:
            c["key"] = "Sell"
        elif h:
            c["key"] = "Hold"
        out["consensus"] = c

    data, err = _get_json(f"{NASDAQ}/company/{key}/earnings-surprise", ND_HEADERS)
    if err or not data:
        errors.append(f"{sym} earnings-surprise: {err or 'no data'}")
    elif data.get("data"):
        rows = ((data["data"] or {}).get("earningsSurpriseTable") or {}).get("rows") or []
        past = []
        for row in rows[:8]:
            past.append({
                "fiscalQtrEnd": row.get("fiscalQtrEnd"),
                "dateReported": _parse_mdy(str(row.get("dateReported") or "")) or row.get("dateReported"),
                "eps": _num(row.get("eps")),
                "consensusForecast": _num(row.get("consensusForecast")),
                "surprisePct": _num(row.get("percentageSurprise")),
            })
        if past:
            out["earningsHistory"] = past
            # Last reported (first row is typically the most recent)
            out["lastEarnings"] = past[0]

    # Upcoming earnings — often empty; only store when present.
    data, err = _get_json(f"{NASDAQ}/calendar/earnings?symbol={key}", ND_HEADERS)
    if data and data.get("data"):
        # Keep a conservative extract if the shape is a list of rows
        cal = data["data"]
        nxt = None
        rows = cal.get("rows") if isinstance(cal, dict) else cal
        if isinstance(rows, list) and rows:
            nxt = rows[0]
        elif isinstance(cal, dict):
            nxt = cal
        if nxt:
            out["nextEarnings"] = nxt

    useful = out.get("targets") or out.get("consensus") or out.get("lastEarnings") or out.get("earningsHistory")
    if not useful:
        return None, errors
    return out, errors


def _sma_from_hist(data_dir: Path, sym: str) -> tuple[float | None, float | None]:
    path = data_dir / "hist" / f"{sym}.json"
    if not path.exists():
        return None, None
    try:
        d = json.loads(path.read_text())
    except Exception:
        return None, None
    closes = [b.get("c") for b in (d.get("daily") or []) if b.get("c") is not None]
    def dma(n):
        if len(closes) < n:
            return None
        return round(sum(closes[-n:]) / n, 4)
    return dma(50), dma(200)


def _fmt_money(n, currency="USD") -> str:
    if n is None:
        return "n/a"
    sign = "$" if currency in ("USD", None) else ("£" if currency == "GBP" else currency + " ")
    absn = abs(n)
    if absn >= 100:
        body = f"{n:,.2f}"
    elif absn >= 1:
        body = f"{n:,.2f}"
    else:
        body = f"{n:,.4f}".rstrip("0").rstrip(".")
    if n < 0:
        return f"-{sign}{body[1:]}" if body.startswith("-") else f"-{sign}{body}"
    return f"{sign}{body}"


def _fmt_pct(n, places=1) -> str:
    if n is None:
        return None
    return f"{n:+.{places}f}%"


def _date_en(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d")
        return d.strftime("%-d %b %Y")
    except Exception:
        return iso


def build_outlook(sym: str, quote: dict, analysis: dict, news_items: list, as_of: str) -> dict:
    """Rule-based sentences. Every figure comes from `analysis`, `quote`, or a news item."""
    sentences = []
    claims = []
    name = quote.get("name") or quote.get("shortName") or sym
    currency = (analysis.get("targets") or {}).get("currency") or quote.get("currency") or "USD"
    px = quote.get("price")

    cons = analysis.get("consensus") or {}
    key = cons.get("key")
    n = cons.get("n")
    buy, hold, sell = cons.get("buy"), cons.get("hold"), cons.get("sell")
    if key and n:
        parts = []
        if buy:
            parts.append(f"{buy} Buy")
        if hold:
            parts.append(f"{hold} Hold")
        if sell:
            parts.append(f"{sell} Sell")
        breakdown = ", ".join(parts) if parts else "no rating breakdown"
        sentences.append(
            f"Nasdaq’s latest published consensus on {name} is {key}, "
            f"based on {n} analyst rating{'' if n == 1 else 's'} ({breakdown})."
        )
        claims.append("consensus")
    elif key:
        sentences.append(f"Nasdaq’s published mean rating for {name} is {key}.")
        claims.append("consensus")

    tgt = analysis.get("targets") or {}
    mean, low, high = tgt.get("mean"), tgt.get("low"), tgt.get("high")
    if mean is not None and px not in (None, 0):
        upside = (mean - px) / px * 100
        direction = "above" if upside >= 0 else "below"
        sentences.append(
            f"The mean price target is {_fmt_money(mean, currency)}, which is "
            f"{abs(upside):.0f}% {direction} the latest Yahoo price of {_fmt_money(px, quote.get('currency') or currency)}."
        )
        claims.append("target")
        analysis["impliedUpsidePct"] = round(upside, 2)
    if low is not None and high is not None and mean is not None:
        sentences.append(
            f"Targets in that set range from {_fmt_money(low, currency)} to {_fmt_money(high, currency)}."
        )
        claims.append("target-range")

    sma50 = quote.get("sma50") if quote.get("sma50") is not None else analysis.get("sma50")
    sma200 = quote.get("sma200") if quote.get("sma200") is not None else analysis.get("sma200")
    mom_bits = []
    if px is not None and sma50:
        d50 = (px - sma50) / sma50 * 100
        mom_bits.append(f"{abs(d50):.1f}% {'above' if d50 >= 0 else 'below'} its 50-day average of {_fmt_money(sma50, quote.get('currency') or currency)}")
        analysis["vsSma50Pct"] = round(d50, 2)
    if px is not None and sma200:
        d200 = (px - sma200) / sma200 * 100
        mom_bits.append(f"{abs(d200):.1f}% {'above' if d200 >= 0 else 'below'} its 200-day average of {_fmt_money(sma200, quote.get('currency') or currency)}")
        analysis["vsSma200Pct"] = round(d200, 2)
    if mom_bits:
        tone = "stronger than" if (analysis.get("vsSma50Pct") or 0) >= 0 and (analysis.get("vsSma200Pct") or 0) >= 0 else (
            "weaker than" if (analysis.get("vsSma50Pct") or 0) < 0 and (analysis.get("vsSma200Pct") or analysis.get("vsSma50Pct") or 0) < 0 else "mixed against"
        )
        sentences.append("The share price is " + " and ".join(mom_bits) + f", so recent momentum is {tone} those averages.")
        claims.append("momentum")

    changes = analysis.get("ratingChanges") or []
    if changes:
        last = changes[-1]
        when = _date_en(last.get("date")) or "a recent month"
        sentences.append(f"In the Nasdaq historical consensus, the rating {last.get('label', 'changed').lower()} ({when}).")
        claims.append("rating-change")

    last_e = analysis.get("lastEarnings")
    if last_e and (last_e.get("eps") is not None or last_e.get("dateReported")):
        when = _date_en(last_e.get("dateReported")) or last_e.get("dateReported") or "the last report"
        fq = last_e.get("fiscalQtrEnd")
        fq_bit = f" for the fiscal quarter ending {fq}" if fq else ""
        forecast = last_e.get("consensusForecast")
        eps = last_e.get("eps")
        surprise = last_e.get("surprisePct")
        if eps is not None and forecast is not None:
            result = "ahead of" if (surprise or 0) > 0 else ("in line with" if surprise == 0 else "short of")
            sur_bit = f", a surprise of {surprise:+.1f}%" if surprise is not None else ""
            sentences.append(
                f"The last reported earnings{fq_bit} ({when}) showed EPS of {eps} against a consensus forecast of {forecast} "
                f"({result} that forecast{sur_bit})."
            )
        elif eps is not None:
            sentences.append(f"The last reported earnings{fq_bit} ({when}) showed EPS of {eps}.")
        claims.append("last-earnings")

    nxt = analysis.get("nextEarnings")
    if nxt:
        # Only mention fields that are actually present
        date = nxt.get("date") or nxt.get("earningsDate") or nxt.get("time")
        date_s = _date_en(str(date)[:10]) if date else None
        if date_s:
            sentences.append(f"The next earnings date in the Nasdaq calendar is {date_s}.")
            claims.append("next-earnings")
    else:
        # Explicit about the gap — do not invent a date
        if last_e:
            sentences.append("No upcoming earnings date was listed in the Nasdaq earnings calendar at the time of this refresh.")
            claims.append("no-next-earnings")

    last_div = quote.get("lastDiv")
    if last_div and last_div.get("date"):
        when = _date_en(datetime.utcfromtimestamp(last_div["date"]).date().isoformat()) if last_div["date"] else None
        amt = last_div.get("amount")
        if when and amt is not None:
            sentences.append(f"The last dividend recorded on the Yahoo chart is {_fmt_money(amt, quote.get('currency') or currency)}, dated {when}.")
            claims.append("dividend")

    # Catalyst headlines — only real fetched items, quoted by title + source
    cats = []
    def _stub(title: str) -> bool:
        t = (title or "").lower()
        return "stock price, news, quote and history" in t or "equity price and quote" in t
    seen_titles = set()
    for item in (news_items or []):
        title = (item.get("title") or "").strip()
        key = title.lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)
        source = (item.get("source") or "").strip()
        url = item.get("url") or item.get("link")
        if title and url and not _stub(title):
            cats.append({"title": title, "source": source, "url": url, "published": item.get("published")})
        if len(cats) >= 3:
            break
    if cats:
        bits = []
        for c in cats[:3]:
            src = f" ({c['source']})" if c["source"] else ""
            bits.append(f"“{c['title']}”{src}")
        sentences.append("Recent headlines: " + "; ".join(bits) + ".")
        claims.append("headlines")
        analysis["catalystHeadlines"] = cats

    if not sentences:
        sentences.append("Not enough analyst data or news was available to write an outlook for this asset.")

    return {
        "text": " ".join(sentences),
        "label": "Automated outlook from analyst data and news, not financial advice",
        "asOf": as_of,
        "claims": claims,
        "source": analysis.get("source") or "Nasdaq",
    }



def _flush(data_dir: Path, by: dict, as_of: str, errors: list, skipped: list, ok: int, universe: int) -> None:
    out = {
        "generated_at": as_of,
        "source": "Nasdaq public analyst API (Yahoo quoteSummary unavailable: crumb HTTP 429 twice)",
        "delay": (
            "Analyst consensus and price targets are from Nasdaq’s public website API, "
            "refreshed with the scheduled GitHub Action. They can lag the latest broker note. "
            "Price used for implied upside is the Yahoo quote in this app, delayed up to 15 minutes."
        ),
        "skipped": skipped,
        "errors": errors[-80:],
        "bySymbol": by,
        "covered": ok,
        "universe": universe,
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "analysis.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

def write_analysis(data_dir: Path, quotes: dict, ua: str) -> dict:
    as_of = _now()
    errors = list(YAHOO_SUMMARY_FAILURES)
    skipped = [
        "Yahoo quoteSummary dropped after two crumb failures (HTTP 429); analyst data comes from Nasdaq.",
        "Nasdaq /analyst/{symbol}/estimate returned 404 — forward EPS and revenue growth estimates are omitted.",
        "Nasdaq does not split Strong Buy / Strong Sell; consensus is Buy / Hold / Sell.",
        "Nasdaq did not publish a median price target — only low, mean and high are shown.",
        "London-listed (.L) and index symbols are not covered by the Nasdaq analyst API.",
    ]
    by: dict = {}
    symbols = [
        s for s, q in quotes.items()
        if q and q.get("ok") and q.get("kind") in ("equity", "etf")
    ]
    # Prefer the holdings-relevant names first so a mid-run interrupt still has them
    preferred = ["USAR", "MP"]
    symbols = [s for s in preferred if s in quotes] + [s for s in symbols if s not in preferred]

    news_path = data_dir / "news.json"
    news_by = {}
    if news_path.exists():
        try:
            news_by = (json.loads(news_path.read_text()).get("bySymbol") or {})
        except Exception:
            news_by = {}

    ok = 0
    for i, sym in enumerate(symbols):
        nd = nasdaq_symbol(sym)
        rec = {"asOf": as_of}
        q = quotes[sym]
        sma50 = q.get("sma50")
        sma200 = q.get("sma200")
        if sma50 is None or sma200 is None:
            a, b = _sma_from_hist(data_dir, sym)
            sma50 = sma50 if sma50 is not None else a
            sma200 = sma200 if sma200 is not None else b
        rec["sma50"] = sma50
        rec["sma200"] = sma200

        if not nd:
            rec["coverage"] = "none"
            rec["reason"] = "No Nasdaq analyst coverage for this listing (London, index, or non-US symbol)."
        else:
            payload, errs = fetch_nasdaq(nd)
            errors.extend(errs)
            if payload:
                rec.update(payload)
                rec["coverage"] = "nasdaq"
                ok += 1
            else:
                rec["coverage"] = "none"
                rec["reason"] = "Nasdaq returned no analyst or earnings data for this symbol."

        items = news_by.get(sym) or []
        rec["outlook"] = build_outlook(sym, q, rec, items, as_of)
        by[sym] = rec
        if nd:
            time.sleep(0.16)
        if sym in preferred or (i + 1) % 25 == 0:
            _flush(data_dir, by, as_of, errors, skipped, ok, len(symbols))
            print(f"  analysis {i+1}/{len(symbols)} ({ok} with data)", flush=True)

    _flush(data_dir, by, as_of, errors, skipped, ok, len(symbols))
    print(f"Wrote analysis for {len(by)} symbols, {ok} with Nasdaq data", flush=True)
    return {"bySymbol": by, "covered": ok, "universe": len(symbols), "skipped": skipped, "errors": errors[-80:]}


if __name__ == "__main__":
    ROOT = Path(__file__).resolve().parents[1]
    DATA = ROOT / "data"
    quotes = {}
    qf = DATA / "quotes.json"
    if qf.exists():
        quotes = json.loads(qf.read_text()).get("quotes") or {}
    UA = "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; khurramwajeeh-d0ymqp@mail.grokbot.com)"
    write_analysis(DATA, quotes, UA)
