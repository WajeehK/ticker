#!/usr/bin/env python3
"""Stock Fear & Greed and market crash-risk gauges.

Written during the quotes refresh. Never invents a reading: any input that
cannot be fetched is marked unavailable and dropped from the composite.

Fear & Greed, in order:
  1. CNN Fear & Greed Index from the public graphdata endpoint, if it returns
     a usable score. Source labelled "CNN Fear & Greed Index".
  2. Otherwise a transparent composite from Yahoo data already in this repo:
     VIX vs 50-day average, S&P 500 vs 125-day MA, breadth (% of Ticker's
     US stock universe above their 50-day MA), TLT vs SPY 20-day return,
     HYG vs LQD 20-day return.

Crash risk is always the Yahoo composite: VIX vs VIX3M term structure,
S&P drawdown from the 52-week high, S&P vs 200-day MA, breadth, HYG vs LQD,
and the 10-year minus 3-month yield curve (^TNX − ^IRX).
"""
from __future__ import annotations

import json
import math
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HIST = DATA / "hist"
CTX = ssl.create_default_context()
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
# CNN's public graphdata endpoint returns 418 for a non-browser UA. We only
# use a generic browser UA for this one documented public feed.
CNN_UA = (
    "Mozilla/5.0 (compatible; TickerPWA/1.0; +https://wajeehk.github.io/ticker/; "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36)"
)
TICKER_UA = (
    "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; "
    "khurramwajeeh-d0ymqp@mail.grokbot.com)"
)

FG_LABELS = (
    (25, "Extreme Fear"),
    (45, "Fear"),
    (56, "Neutral"),
    (76, "Greed"),
    (101, "Extreme Greed"),
)
RISK_LABELS = (
    (25, "Low"),
    (50, "Elevated"),
    (75, "High"),
    (101, "Extreme"),
)

CNN_PARTS = [
    ("market_momentum_sp500", "Market momentum (S&P 500)"),
    ("stock_price_strength", "Stock price strength"),
    ("stock_price_breadth", "Stock price breadth"),
    ("put_call_options", "Put / call options"),
    ("market_volatility_vix", "Market volatility (VIX)"),
    ("junk_bond_demand", "Junk bond demand"),
    ("safe_haven_demand", "Safe-haven demand"),
]


def _get(url: str, ua: str, tries: int = 3, timeout: int = 20, headers: dict | None = None) -> bytes | None:
    last = None
    hdrs = {"User-Agent": ua, "Accept": "application/json,*/*"}
    if headers:
        hdrs.update(headers)
    for i in range(tries):
        req = urllib.request.Request(url, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                if r.status != 200:
                    last = f"HTTP {r.status}"
                    time.sleep(1.2 * (i + 1))
                    continue
                data = r.read()
                if not data:
                    last = "empty"
                    continue
                return data
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (418, 429, 500, 502, 503, 504):
                time.sleep(1.5 * (i + 1))
                continue
            return None
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.0 * (i + 1))
    print("  fetch fail", url[:90], last)
    return None


def _closes(hist: dict | None) -> list[tuple[int, float]]:
    out = []
    if not hist:
        return out
    for b in hist.get("daily") or []:
        t, c = b.get("t"), b.get("c")
        if t is not None and c is not None and is_finite(c):
            out.append((int(t), float(c)))
    out.sort()
    return out


def is_finite(n) -> bool:
    try:
        return n is not None and math.isfinite(float(n))
    except (TypeError, ValueError):
        return False


def load_hist(sym: str) -> dict | None:
    p = HIST / f"{sym}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def sma(vals: list[float], n: int) -> float | None:
    if len(vals) < n:
        return None
    return sum(vals[-n:]) / n


def ret(vals: list[float], n: int) -> float | None:
    if len(vals) < n + 1 or vals[-1 - n] == 0:
        return None
    return vals[-1] / vals[-1 - n] - 1.0


def clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def fg_label(score: float) -> str:
    for cap, name in FG_LABELS:
        if score < cap:
            return name
    return "Extreme Greed"


def risk_label(score: float) -> str:
    # 0–25 Low, 25–50 Elevated, 50–75 High, 75–100 Extreme (upper bound inclusive).
    if score <= 25:
        return "Low"
    if score <= 50:
        return "Elevated"
    if score <= 75:
        return "High"
    return "Extreme"


def title_rating(s: str | None) -> str:
    if not s:
        return ""
    s = str(s).replace("_", " ").strip()
    return " ".join(w.capitalize() if w.lower() != "and" else "and" for w in s.split())


def cnn_fetch() -> dict | None:
    # Try the project UA first; fall back to the documented browser-like UA
    # because this host answers 418 to obviously non-browser clients.
    raw = _get(CNN_URL, TICKER_UA, tries=1)
    if not raw:
        raw = _get(
            CNN_URL,
            CNN_UA,
            tries=2,
            headers={"Referer": "https://edition.cnn.com/markets/fear-and-greed", "Origin": "https://edition.cnn.com"},
        )
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    fg = data.get("fear_and_greed") or {}
    score = fg.get("score")
    if not is_finite(score):
        return None
    score = float(score)
    hist = ((data.get("fear_and_greed_historical") or {}).get("data")) or []
    spark = []
    for pt in hist:
        y = pt.get("y")
        x = pt.get("x")
        if is_finite(y):
            # x is ms
            t = int(x / 1000) if is_finite(x) and x > 1e11 else (int(x) if is_finite(x) else None)
            spark.append({"t": t, "v": round(float(y), 2)})
    if len(spark) > 120:
        spark = spark[:: max(1, len(spark) // 90)][-90:]
    parts = []
    for key, label in CNN_PARTS:
        block = data.get(key) or {}
        sc = block.get("score")
        if not is_finite(sc):
            parts.append({"id": key, "label": label, "available": False, "reason": "CNN did not return a score for this input"})
            continue
        parts.append({
            "id": key,
            "label": label,
            "available": True,
            "score": round(float(sc), 1),
            "rating": title_rating(block.get("rating")),
        })
    ts = fg.get("timestamp")
    return {
        "score": round(score, 1),
        "rating": title_rating(fg.get("rating")) or fg_label(score),
        "asOf": ts,
        "previousClose": fg.get("previous_close") if is_finite(fg.get("previous_close")) else None,
        "previous1Week": fg.get("previous_1_week") if is_finite(fg.get("previous_1_week")) else None,
        "spark": spark,
        "parts": parts,
        "source": "CNN Fear & Greed Index (graphdata)",
        "sourceUrl": "https://edition.cnn.com/markets/fear-and-greed",
        "method": "cnn",
    }


def yahoo_chart(sym: str, ua: str, range_="1y", interval="1d") -> dict | None:
    url = CHART.format(sym=urllib.parse.quote(sym, safe=""))
    raw = _get(f"{url}?range={range_}&interval={interval}", ua, tries=2)
    if not raw:
        return None
    try:
        d = json.loads(raw)
    except Exception:
        return None
    res = ((d.get("chart") or {}).get("result") or [None])[0]
    return res


def ensure_hist(sym: str, ua: str) -> dict | None:
    existing = load_hist(sym)
    if existing and len(existing.get("daily") or []) >= 60:
        return existing
    res = yahoo_chart(sym, ua, "5y", "1d")
    if not res:
        return existing
    ts = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    vols = quote.get("volume") or []
    daily = []
    for i, t in enumerate(ts):
        c = closes[i] if i < len(closes) else None
        if t is None or c is None or not is_finite(c):
            continue
        bar = {"t": int(t), "c": float(c)}
        if i < len(vols) and vols[i] is not None:
            bar["v"] = vols[i]
        daily.append(bar)
    if not daily:
        return existing
    meta = res.get("meta") or {}
    payload = {
        "symbol": sym,
        "currency": meta.get("currency") or "USD",
        "daily": daily,
        "intraday": [],
        "dividends": [],
        "session": "regular",
    }
    HIST.mkdir(parents=True, exist_ok=True)
    (HIST / f"{sym}.json").write_text(json.dumps(payload, separators=(",", ":")))
    print(f"  wrote hist {sym} ({len(daily)} days), last {daily[-1]['c']}")
    return payload


def last_price(sym: str, quotes: dict, hist: dict | None) -> float | None:
    q = quotes.get(sym) or {}
    if is_finite(q.get("price")):
        return float(q["price"])
    cls = _closes(hist)
    return cls[-1][1] if cls else None


def us_breadth(quotes: dict) -> tuple[float | None, int, int]:
    """Return (pct above 50d MA, above, sample size). US equities only."""
    above = total = 0
    for sid, q in (quotes or {}).items():
        if not q or q.get("kind") != "equity":
            continue
        if str(sid).endswith(".L"):
            continue
        px, ma = q.get("price"), q.get("sma50")
        if not is_finite(px) or not is_finite(ma):
            continue
        total += 1
        if float(px) > float(ma):
            above += 1
    if total == 0:
        return None, 0, 0
    return 100.0 * above / total, above, total


def yahoo_fear(quotes: dict, ua: str) -> dict:
    parts = []

    def add_unavail(pid, label, reason):
        parts.append({"id": pid, "label": label, "available": False, "reason": reason})

    # VIX vs 50d
    vix_h = ensure_hist("^VIX", ua)
    vix_cls = [c for _, c in _closes(vix_h)]
    vix = last_price("^VIX", quotes, vix_h)
    vix50 = sma(vix_cls, 50)
    if vix is not None and vix50 not in (None, 0):
        z = (vix50 - vix) / (0.35 * vix50)
        sc = round(50 + 50 * clamp(z), 1)
        parts.append({
            "id": "vix",
            "label": "VIX vs 50-day average",
            "available": True,
            "value": round(vix, 2),
            "ref": round(vix50, 2),
            "unit": "pts",
            "detail": f"VIX {vix:.2f} vs 50-day average {vix50:.2f} (ratio {vix/vix50:.2f}). Lower than average leans to greed.",
            "score": sc,
            "rating": fg_label(sc),
        })
    else:
        add_unavail("vix", "VIX vs 50-day average", "VIX history or the 50-day average was not available")

    # S&P vs 125d MA
    spx_h = load_hist("^GSPC")
    spx_cls = [c for _, c in _closes(spx_h)]
    spx = last_price("^GSPC", quotes, spx_h)
    ma125 = sma(spx_cls, 125)
    if spx is not None and ma125 not in (None, 0):
        z = (spx / ma125 - 1) / 0.08
        sc = round(50 + 50 * clamp(z), 1)
        parts.append({
            "id": "spx125",
            "label": "S&P 500 vs 125-day average",
            "available": True,
            "value": round(spx, 2),
            "ref": round(ma125, 2),
            "unit": "pts",
            "detail": f"S&P 500 {spx:.2f} vs 125-day average {ma125:.2f} ({(spx/ma125-1)*100:+.2f}%). Above the average leans to greed.",
            "score": sc,
            "rating": fg_label(sc),
        })
    else:
        add_unavail("spx125", "S&P 500 vs 125-day average", "S&P 500 history was not long enough for a 125-day average")

    # Breadth
    pct_b, n_above, n_tot = us_breadth(quotes)
    if pct_b is not None:
        sc = round(pct_b, 1)
        parts.append({
            "id": "breadth",
            "label": "Breadth (% above 50-day average)",
            "available": True,
            "value": round(pct_b, 1),
            "ref": 50,
            "unit": "%",
            "detail": f"{n_above} of {n_tot} US stocks in Ticker's universe trade above their 50-day average ({pct_b:.1f}%). This is not NYSE/Nasdaq official breadth.",
            "score": sc,
            "rating": fg_label(sc),
            "sample": n_tot,
            "above": n_above,
        })
    else:
        add_unavail("breadth", "Breadth (% above 50-day average)", "Not enough US stock quotes with a 50-day average")

    # TLT vs SPY 20d
    tlt = [c for _, c in _closes(load_hist("TLT"))]
    spy = [c for _, c in _closes(load_hist("SPY"))]
    tlt20, spy20 = ret(tlt, 20), ret(spy, 20)
    if tlt20 is not None and spy20 is not None:
        rel = tlt20 - spy20
        z = -rel / 0.06
        sc = round(50 + 50 * clamp(z), 1)
        parts.append({
            "id": "haven",
            "label": "TLT vs SPY (20-day)",
            "available": True,
            "value": round(rel * 100, 2),
            "ref": 0,
            "unit": "pp",
            "detail": f"20-day return: TLT {tlt20*100:+.2f}% vs SPY {spy20*100:+.2f}% (spread {rel*100:+.2f} pp). Treasuries beating equities leans to fear.",
            "score": sc,
            "rating": fg_label(sc),
        })
    else:
        add_unavail("haven", "TLT vs SPY (20-day)", "TLT or SPY did not have 20 daily closes")

    # HYG vs LQD 20d
    hyg = [c for _, c in _closes(load_hist("HYG"))]
    lqd = [c for _, c in _closes(load_hist("LQD"))]
    hyg20, lqd20 = ret(hyg, 20), ret(lqd, 20)
    if hyg20 is not None and lqd20 is not None:
        rel = hyg20 - lqd20
        z = rel / 0.03
        sc = round(50 + 50 * clamp(z), 1)
        parts.append({
            "id": "credit",
            "label": "HYG vs LQD (20-day)",
            "available": True,
            "value": round(rel * 100, 2),
            "ref": 0,
            "unit": "pp",
            "detail": f"20-day return: high-yield HYG {hyg20*100:+.2f}% vs investment-grade LQD {lqd20*100:+.2f}% (spread {rel*100:+.2f} pp). High yield leading leans to greed.",
            "score": sc,
            "rating": fg_label(sc),
        })
    else:
        add_unavail("credit", "HYG vs LQD (20-day)", "HYG or LQD did not have 20 daily closes")

    usable = [p for p in parts if p.get("available") and is_finite(p.get("score"))]
    if not usable:
        return {
            "score": None,
            "rating": None,
            "parts": parts,
            "source": "Yahoo Finance composite (no inputs were available)",
            "method": "yahoo-composite",
            "available": False,
        }
    score = round(sum(p["score"] for p in usable) / len(usable), 1)
    return {
        "score": score,
        "rating": fg_label(score),
        "parts": parts,
        "used": len(usable),
        "source": "Ticker composite from Yahoo Finance (VIX, S&P 500, breadth, TLT/SPY, HYG/LQD)",
        "method": "yahoo-composite",
        "available": True,
        "note": "Equal-weighted average of the available inputs. CNN's index was not used.",
    }


def yahoo_crash(quotes: dict, ua: str) -> dict:
    parts = []

    def add_unavail(pid, label, reason, threshold):
        parts.append({"id": pid, "label": label, "available": False, "reason": reason, "threshold": threshold})

    # Term structure
    vix_h = ensure_hist("^VIX", ua)
    vix3_h = ensure_hist("^VIX3M", ua)
    vix = last_price("^VIX", quotes, vix_h)
    vix3 = last_price("^VIX3M", quotes, vix3_h)
    thr_term = "Contango (VIX below VIX3M) is typical. Backwardation (VIX above VIX3M) is treated as stress."
    if vix is not None and vix3 not in (None, 0):
        ratio = vix / vix3
        risk = round(100 * clamp((ratio - 0.85) / 0.35, 0, 1), 1)
        parts.append({
            "id": "term",
            "label": "VIX vs VIX3M term structure",
            "available": True,
            "value": round(ratio, 3),
            "unit": "ratio",
            "detail": f"VIX {vix:.2f} / VIX3M {vix3:.2f} = {ratio:.3f} ({'backwardation' if ratio > 1 else 'contango'}).",
            "threshold": thr_term,
            "score": risk,
            "level": risk_label(risk),
        })
    else:
        add_unavail("term", "VIX vs VIX3M term structure", "VIX or VIX3M was not available", thr_term)

    # S&P drawdown from 52w high
    qsp = quotes.get("^GSPC") or {}
    spx_h = load_hist("^GSPC")
    spx = last_price("^GSPC", quotes, spx_h)
    high52 = qsp.get("high52")
    if not is_finite(high52):
        cls = [c for _, c in _closes(spx_h)]
        if len(cls) >= 200:
            high52 = max(cls[-252:]) if len(cls) >= 252 else max(cls)
    thr_dd = "A shallow pullback (within about 5% of the 52-week high) scores Low; around −10% is High; about −20% or worse is Extreme."
    if spx is not None and is_finite(high52) and high52:
        dd = (spx / float(high52) - 1) * 100
        risk = round(100 * clamp((-dd) / 20.0, 0, 1), 1)
        parts.append({
            "id": "drawdown",
            "label": "S&P 500 drawdown from 52-week high",
            "available": True,
            "value": round(dd, 2),
            "ref": round(float(high52), 2),
            "unit": "%",
            "detail": f"S&P 500 {spx:.2f} vs 52-week high {float(high52):.2f} ({dd:+.2f}%).",
            "threshold": thr_dd,
            "score": risk,
            "level": risk_label(risk),
        })
    else:
        add_unavail("drawdown", "S&P 500 drawdown from 52-week high", "S&P 500 price or 52-week high was not available", thr_dd)

    # S&P vs 200d
    spx_cls = [c for _, c in _closes(spx_h)]
    ma200 = qsp.get("sma200") if is_finite(qsp.get("sma200")) else sma(spx_cls, 200)
    thr_200 = "Above the 200-day average scores lower risk; a break below it raises the reading; about 12% below maps to Extreme."
    if spx is not None and ma200 not in (None, 0):
        pct = (spx / float(ma200) - 1) * 100
        risk = round(50 - 50 * clamp(pct / 12.0), 1)
        parts.append({
            "id": "spx200",
            "label": "S&P 500 vs 200-day average",
            "available": True,
            "value": round(spx, 2),
            "ref": round(float(ma200), 2),
            "unit": "pts",
            "detail": f"S&P 500 {spx:.2f} vs 200-day average {float(ma200):.2f} ({pct:+.2f}%).",
            "threshold": thr_200,
            "score": risk,
            "level": risk_label(risk),
        })
    else:
        add_unavail("spx200", "S&P 500 vs 200-day average", "S&P 500 history was not long enough for a 200-day average", thr_200)

    # Breadth
    pct_b, n_above, n_tot = us_breadth(quotes)
    thr_br = "A majority of the US stock universe above their 50-day average scores Low; fewer than about 25% scores Extreme."
    if pct_b is not None:
        risk = round(100 - pct_b, 1)
        parts.append({
            "id": "breadth",
            "label": "Breadth (% above 50-day average)",
            "available": True,
            "value": round(pct_b, 1),
            "ref": 50,
            "unit": "%",
            "detail": f"{n_above} of {n_tot} US stocks in Ticker's universe are above their 50-day average ({pct_b:.1f}%). Not official exchange breadth.",
            "threshold": thr_br,
            "score": risk,
            "level": risk_label(risk),
            "sample": n_tot,
            "above": n_above,
        })
    else:
        add_unavail("breadth", "Breadth (% above 50-day average)", "Not enough US stock quotes with a 50-day average", thr_br)

    # HYG vs LQD
    hyg = [c for _, c in _closes(load_hist("HYG"))]
    lqd = [c for _, c in _closes(load_hist("LQD"))]
    hyg20, lqd20 = ret(hyg, 20), ret(lqd, 20)
    thr_cr = "High yield (HYG) beating investment-grade (LQD) over 20 days scores lower risk; a lag of about 4 percentage points maps to Extreme."
    if hyg20 is not None and lqd20 is not None:
        rel = hyg20 - lqd20
        risk = round(50 - 50 * clamp(rel / 0.04), 1)
        parts.append({
            "id": "credit",
            "label": "HYG vs LQD (20-day)",
            "available": True,
            "value": round(rel * 100, 2),
            "ref": 0,
            "unit": "pp",
            "detail": f"20-day return: HYG {hyg20*100:+.2f}% vs LQD {lqd20*100:+.2f}% (spread {rel*100:+.2f} pp).",
            "threshold": thr_cr,
            "score": risk,
            "level": risk_label(risk),
        })
    else:
        add_unavail("credit", "HYG vs LQD (20-day)", "HYG or LQD did not have 20 daily closes", thr_cr)

    # Yield curve TNX - IRX
    tnx_h = ensure_hist("^TNX", ua)
    irx_h = ensure_hist("^IRX", ua)
    tnx = last_price("^TNX", quotes, tnx_h)
    irx = last_price("^IRX", quotes, irx_h)
    thr_yc = "A positive 10-year minus 3-month slope is typical. A flat curve raises the reading; an inversion of about 1 percentage point maps to Extreme."
    if tnx is not None and irx is not None:
        slope = tnx - irx  # both already in percent
        risk = round(50 - 50 * clamp(slope / 1.0), 1)
        parts.append({
            "id": "curve",
            "label": "Yield curve (10-year − 3-month)",
            "available": True,
            "value": round(slope, 3),
            "unit": "pp",
            "detail": f"10-year yield {tnx:.3f}% minus 3-month yield {irx:.3f}% = {slope:+.3f} pp ({'inverted' if slope < 0 else 'upward-sloping'}).",
            "threshold": thr_yc,
            "score": risk,
            "level": risk_label(risk),
        })
    else:
        add_unavail("curve", "Yield curve (10-year − 3-month)", "10-year (^TNX) or 3-month (^IRX) yield was not available", thr_yc)

    usable = [p for p in parts if p.get("available") and is_finite(p.get("score"))]
    if not usable:
        return {
            "score": None,
            "level": None,
            "parts": parts,
            "source": "Yahoo Finance composite (no inputs were available)",
            "available": False,
        }
    score = round(sum(p["score"] for p in usable) / len(usable), 1)
    return {
        "score": score,
        "level": risk_label(score),
        "parts": parts,
        "used": len(usable),
        "source": "Ticker composite from Yahoo Finance (VIX/VIX3M, S&P 500, breadth, HYG/LQD, Treasury curve)",
        "available": True,
        "note": "Equal-weighted average of the available inputs. Missing inputs are skipped, not filled in.",
    }


def write_sentiment(data_dir: Path, quotes: dict, ua: str) -> dict:
    print("Market sentiment…")
    fear_cnn = None
    try:
        fear_cnn = cnn_fetch()
        if fear_cnn:
            print(f"  CNN Fear & Greed {fear_cnn['score']} {fear_cnn['rating']}")
        else:
            print("  CNN Fear & Greed unavailable; using Yahoo composite")
    except Exception as e:
        print("  CNN fetch error:", e)
        fear_cnn = None

    fear_yahoo = yahoo_fear(quotes, ua)
    if fear_yahoo.get("available"):
        print(f"  Yahoo F&G composite {fear_yahoo['score']} {fear_yahoo['rating']} ({fear_yahoo.get('used')} inputs)")
    else:
        print("  Yahoo F&G composite unavailable")

    fear = fear_cnn or fear_yahoo
    # If CNN won, still keep the Yahoo composite under fallback for transparency
    crash = yahoo_crash(quotes, ua)
    if crash.get("available"):
        print(f"  Crash risk {crash['score']} {crash['level']} ({crash.get('used')} inputs)")
    else:
        print("  Crash risk unavailable")

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "disclaimer": "Indicator, not a prediction, not financial advice.",
        "fearGreed": fear,
        "fearGreedFallback": fear_yahoo if fear_cnn else None,
        "crashRisk": crash,
    }
    path = data_dir / "market_sentiment.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {path}")
    return out


def main() -> int:
    quotes_path = DATA / "quotes.json"
    quotes = {}
    if quotes_path.exists():
        blob = json.loads(quotes_path.read_text())
        quotes = blob.get("quotes") or blob
    write_sentiment(DATA, quotes, TICKER_UA)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
