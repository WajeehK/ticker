#!/usr/bin/env python3
"""Fetch live-ish stock/ETF quotes and history from Yahoo Finance (server-side).

Yahoo does not send CORS headers, so the static PWA cannot call it from the
browser. This script writes data/quotes.json and data/hist/{SYMBOL}.json for
GitHub Pages. Prices are typically delayed up to 15 minutes. Never invents
numbers: a symbol that fails is omitted or marked ok=false.
"""
from __future__ import annotations

import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HIST = DATA / "hist"
UA = (
    "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; "
    "khurramwajeeh-d0ymqp@mail.grokbot.com)"
)
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
CTX = ssl.create_default_context()

# Curated US + UK universe. Yahoo symbols (.L = London, dashes not dots for
# share classes: BRK-B, BT-A.L). FX used to roll a mixed portfolio into USD.
UNIVERSE = [
    # US mega / tech
    "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "AVGO",
    "ORCL", "AMD", "NFLX", "INTC", "QCOM", "AMAT", "ADBE", "CRM", "CSCO",
    "IBM", "INTU", "TXN", "MU", "NOW", "SHOP", "UBER", "SNOW", "PLTR",
    "COIN", "XYZ", "PYPL", "SPOT", "ABNB", "ARM", "SMCI", "MSTR", "HOOD",
    "APP", "PANW", "CRWD", "DDOG", "NET", "AVGO",
    # Rare earths (user-held)
    "USAR", "MP",
    # US other + ADRs
    "BRK-B", "JPM", "V", "MA", "UNH", "XOM", "JNJ", "WMT", "PG", "HD",
    "KO", "PEP", "COST", "DIS", "BAC", "GS", "MS", "AXP", "WFC", "C",
    "GE", "CAT", "BA", "NKE", "MCD", "SBUX", "T", "VZ", "PFE", "MRK",
    "ABBV", "LLY", "MRNA", "CVX", "COP", "TSM", "ASML", "NVO", "SAP",
    "TM", "SONY", "BABA", "NIO", "RIVN", "SOFI",
    # US ETFs
    "SPY", "QQQ", "VOO", "VTI", "IWM", "DIA", "IVV", "VEA", "VWO", "EFA",
    "EEM", "GLD", "SLV", "IAU", "TLT", "IEF", "HYG", "LQD", "XLK", "XLF",
    "XLE", "XLV", "XLY", "XLI", "SMH", "SOXX", "ARKK", "BOTZ", "VNQ",
    "BND", "AGG", "SCHD", "VIG", "SPYD",
    # UK / LSE ETFs + blue chips
    "VUSA.L", "VUAG.L", "VWRL.L", "VWRP.L", "VUKE.L", "ISF.L", "CSP1.L",
    "IUSA.L", "SGLN.L", "IGLT.L", "HSBA.L", "AZN.L", "SHEL.L", "ULVR.L",
    "BP.L", "GSK.L", "DGE.L", "RIO.L", "BATS.L", "LLOY.L", "BARC.L",
    "NWG.L", "STAN.L", "NG.L", "RR.L", "REL.L", "LSEG.L", "AAL.L",
    "GLEN.L", "VOD.L", "BT-A.L", "TSCO.L", "OCDO.L", "AUTO.L", "SMT.L",
    "III.L", "PRU.L", "AV.L", "IMB.L", "AHT.L", "EXPN.L", "INF.L",
    "SGE.L", "SSE.L", "CNA.L", "IAG.L", "FLTR.L", "CPG.L", "ABF.L",
    "BNZL.L", "IHG.L", "RKT.L", "NXT.L", "SN.L", "ANTO.L", "FRES.L",
    "WPP.L", "PSON.L", "LAND.L", "SGRO.L", "CRDA.L", "DCC.L", "MNDI.L",
    "SVT.L", "UU.L", "KGF.L", "MKS.L", "SBRY.L", "JD.L", "ENT.L",
    "CCH.L", "BDEV.L", "BTRW.L", "PSN.L", "TW.L", "SMIN.L", "WEIR.L",
    "BA.L", "SPX.L", "RTO.L", "HLMA.L", "HIK.L", "PSH.L",
    # FX
    "GBPUSD=X", "EURUSD=X",
    # Indices
    "^GSPC", "^IXIC", "^DJI", "^FTSE",
    # Vol and yields (sentiment / crash-risk gauges; shown as points or %)
    "^VIX", "^VIX3M", "^TNX", "^IRX",
    # Commodities (Yahoo futures, shown in USD with units)
    "GC=F", "SI=F", "CL=F", "BZ=F", "NG=F", "HG=F", "PL=F", "PA=F",
]

# De-dupe while keeping order
SEEN = set()
UNIVERSE = [s for s in UNIVERSE if not (s in SEEN or SEEN.add(s))]


def get_json(url: str, params: dict, tries: int = 2) -> dict | None:
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if params else url
    last_err = None
    for attempt in range(tries):
        req = urllib.request.Request(
            full,
            headers={"User-Agent": UA, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
                if r.status != 200:
                    last_err = f"HTTP {r.status}"
                    time.sleep(1.5 * (attempt + 1))
                    continue
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2.5 * (attempt + 1))
                continue
            return None  # 404 / 401 — do not retry as a "step"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(1.2 * (attempt + 1))
    if last_err:
        raise RuntimeError(last_err)
    return None


def chart(sym: str, range_: str, interval: str, prepost: bool = False) -> dict | None:
    data = get_json(
        CHART.format(sym=urllib.parse.quote(sym, safe="")),
        {
            "range": range_,
            "interval": interval,
            "includePrePost": "true" if prepost else "false",
            "events": "div,split",
        },
    )
    if not data:
        return None
    err = (data.get("chart") or {}).get("error")
    if err:
        raise RuntimeError(err.get("description") or str(err))
    res = (data.get("chart") or {}).get("result") or []
    return res[0] if res else None


def spark_from(closes: list, n: int = 30) -> list[float]:
    vals = [float(c) for c in closes if c is not None]
    if len(vals) > n:
        vals = vals[-n:]
    return [round(v, 6) for v in vals]


def bars(result: dict, ohlc: bool) -> list[dict]:
    ts = result.get("timestamp") or []
    q = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    out = []
    for i, t in enumerate(ts):
        c = (q.get("close") or [None] * len(ts))[i]
        if c is None or t is None:
            continue
        row = {"t": int(t), "c": float(c)}
        vol = (q.get("volume") or [None] * len(ts))[i]
        if vol is not None:
            try:
                row["v"] = float(vol)
            except (TypeError, ValueError):
                pass
        if ohlc:
            o = (q.get("open") or [None] * len(ts))[i]
            h = (q.get("high") or [None] * len(ts))[i]
            l = (q.get("low") or [None] * len(ts))[i]
            if o is None or h is None or l is None:
                continue
            row.update({"o": float(o), "h": float(h), "l": float(l)})
        out.append(row)
    return out


COMMODITY_META = {
    "GC=F": {"name": "Gold", "short": "Gold", "unit": "USD/oz"},
    "SI=F": {"name": "Silver", "short": "Silver", "unit": "USD/oz"},
    "CL=F": {"name": "Crude oil (WTI)", "short": "WTI", "unit": "USD/bbl"},
    "BZ=F": {"name": "Brent crude", "short": "Brent", "unit": "USD/bbl"},
    "NG=F": {"name": "Natural gas", "short": "Nat gas", "unit": "USD/MMBtu"},
    "HG=F": {"name": "Copper", "short": "Copper", "unit": "USD/lb"},
    "PL=F": {"name": "Platinum", "short": "Platinum", "unit": "USD/oz"},
    "PA=F": {"name": "Palladium", "short": "Palladium", "unit": "USD/oz"},
}


def kind_of(meta: dict, symbol: str) -> str:
    if symbol.endswith("=X"):
        return "fx"
    if symbol.endswith("=F") or symbol in COMMODITY_META:
        return "commodity"
    it = (meta.get("instrumentType") or "").upper()
    if it in ("FUTURE", "FUTURES"):
        return "commodity"
    if it == "ETF":
        return "etf"
    if it == "MUTUALFUND":
        return "fund"
    if it == "INDEX":
        return "index"
    return "equity"



def dividends_from(result: dict, scale: float = 1.0) -> list[dict]:
    ev = ((result.get("events") or {}).get("dividends") or {})
    out = []
    for item in ev.values() if isinstance(ev, dict) else ev:
        try:
            amt = float(item.get("amount"))
            dt = int(item.get("date") or item.get("t") or 0)
        except (TypeError, ValueError):
            continue
        if dt and amt:
            out.append({"t": dt, "amount": amt * scale})
    out.sort(key=lambda x: x["t"])
    return out[-12:]



def period_windows(meta: dict) -> dict:
    """Unix start/end for pre, regular and post, when Yahoo provides them."""
    out = {}
    ctp = meta.get("currentTradingPeriod") or {}
    for name in ("pre", "regular", "post"):
        rec = ctp.get(name) or {}
        start, end = rec.get("start"), rec.get("end")
        if start and end:
            out[name] = [int(start), int(end)]
    return out


def last_extended(intra: list, meta: dict) -> tuple | None:
    """Newest pre/post print after the official regular close.

    Yahoo chart meta often leaves postMarketPrice empty even when
    includePrePost bars continue through 8pm ET. Trading 212 and similar
    brokers show that extended-hours last, not only regularMarketPrice.
    """
    reg_t = meta.get("regularMarketTime")
    if not intra or not reg_t:
        return None
    later = [b for b in intra if b.get("t") and b["t"] > int(reg_t) and b.get("c") is not None]
    if not later:
        return None
    b = later[-1]
    t = int(b["t"])
    windows = period_windows(meta)
    session = "post"
    pre = windows.get("pre")
    if pre and pre[0] <= t < pre[1]:
        session = "pre"
    return float(b["c"]), t, session


def pack_quote(symbol: str, meta: dict, daily_closes: list) -> dict | None:
    price = meta.get("regularMarketPrice")
    if price is None:
        return None
    prev = meta.get("previousClose")
    if prev is None:
        prev = meta.get("chartPreviousClose")
    price = float(price)
    prev = float(prev) if prev is not None else None
    closes_f = [float(c) for c in daily_closes if c is not None]
    if prev is None and len(closes_f) >= 2:
        prev = closes_f[-2]
    chg = (price - prev) if prev not in (None, 0) else None
    pct = (chg / prev * 100) if chg is not None and prev else None
    name = meta.get("longName") or meta.get("shortName") or symbol
    short = meta.get("shortName") or name
    currency = meta.get("currency") or "USD"
    # London stocks are often quoted in pence (GBp / GBX). Store pounds.
    scale = 0.01 if currency in ("GBp", "GBX") else 1.0
    if scale != 1.0:
        currency = "GBP"
        price *= scale
        if prev is not None:
            prev *= scale
        if chg is not None:
            chg *= scale
        def _s(v):
            return None if v is None else float(v) * scale
        day_high, day_low = _s(meta.get("regularMarketDayHigh")), _s(meta.get("regularMarketDayLow"))
        high52, low52 = _s(meta.get("fiftyTwoWeekHigh")), _s(meta.get("fiftyTwoWeekLow"))
        spark = [round(v * scale, 6) for v in spark_from(daily_closes)]
    else:
        day_high = meta.get("regularMarketDayHigh")
        day_low = meta.get("regularMarketDayLow")
        high52 = meta.get("fiftyTwoWeekHigh")
        low52 = meta.get("fiftyTwoWeekLow")
        spark = spark_from(daily_closes)
    rec = {
        "symbol": symbol,
        "name": name,
        "shortName": short,
        "kind": kind_of(meta, symbol),
        "exchange": meta.get("exchangeName") or meta.get("fullExchangeName") or "",
        "currency": currency,
        "price": price,
        "prev": prev,
        "change": chg,
        "changePct": pct,
        "dayHigh": day_high,
        "dayLow": day_low,
        "high52": high52,
        "low52": low52,
        "asOf": meta.get("regularMarketTime"),
        "spark": spark,
        "ok": True,
        "unit": "pence" if scale != 1.0 else None,
        "volume": meta.get("regularMarketVolume"),
        "marketCap": meta.get("marketCap"),
    }
    cm = COMMODITY_META.get(symbol)
    if cm:
        rec["kind"] = "commodity"
        rec["name"] = cm["name"]
        rec["shortName"] = cm["short"]
        rec["unit"] = cm["unit"]
        rec["currency"] = "USD"
    if symbol in ("^TNX", "^IRX"):
        rec["kind"] = "yield"
        rec["unit"] = "%"
        rec["currency"] = "USD"
        rec["name"] = "10-year Treasury yield" if symbol == "^TNX" else "13-week Treasury bill yield"
        rec["shortName"] = "10Y yield" if symbol == "^TNX" else "3M yield"
    if symbol == "^VIX":
        rec["kind"] = "index"
        rec["name"] = "Cboe Volatility Index"
        rec["shortName"] = "VIX"
    if symbol == "^VIX3M":
        rec["kind"] = "index"
        rec["name"] = "Cboe 3-Month Volatility Index"
        rec["shortName"] = "VIX3M"
    def _dma(n):
        if len(closes_f) < n:
            return None
        return round(sum(closes_f[-n:]) / n * (scale if scale != 1.0 else 1.0), 4)
    rec["sma50"] = _dma(50)
    rec["sma200"] = _dma(200)
    return rec


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    HIST.mkdir(parents=True, exist_ok=True)
    quotes: dict = {}
    errors: list[str] = []
    fx: dict = {}
    t0 = time.time()

    universe = list(UNIVERSE)
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from ipos import calendar_tickers
        extra = calendar_tickers()
        seen = set(universe)
        added_syms = []
        for s in extra:
            if s and s not in seen:
                seen.add(s)
                universe.append(s)
                added_syms.append(s)
        if added_syms:
            print(
                f"IPO tickers added to universe: {len(added_syms)} "
                f"({', '.join(added_syms[:16])}{'…' if len(added_syms) > 16 else ''})",
                flush=True,
            )
    except Exception as e:
        print(f"IPO calendar (pre-universe) skipped: {e}", flush=True)

    core = set(universe)
    try:
        from instruments import liquid_ids, write_instruments
        try:
            write_instruments(DATA)
        except Exception as e:
            print("instruments refresh skipped:", e, flush=True)
        extra = [s for s in liquid_ids(DATA) if s and s not in core]
        universe.extend(extra)
        print(f"Liquid instrument extras added: {len(extra)}", flush=True)
    except Exception as e:
        print(f"instruments universe skipped: {e}", flush=True)

    for i, sym in enumerate(universe):
        lite = sym not in core
        try:
            daily = chart(sym, "1y" if lite else "5y", "1d")
            if not daily:
                errors.append(f"{sym}: no daily data")
                time.sleep(0.15)
                continue
            meta = daily.get("meta") or {}
            daily_bars = bars(daily, ohlc=True)
            closes = [b["c"] for b in daily_bars]
            q = pack_quote(sym, meta, closes)
            if not q:
                errors.append(f"{sym}: no market price")
                time.sleep(0.15)
                continue

            intra = []
            periods = period_windows(meta)
            try:
                if lite:
                    raise RuntimeError("skip-intraday")
                raw_i = chart(sym, "1d", "5m", prepost=True)
                if raw_i:
                    intra = bars(raw_i, ohlc=False)
                    m2 = raw_i.get("meta") or {}
                    merged = {**meta, **{k: v for k, v in m2.items() if v is not None}}
                    q2 = pack_quote(sym, merged, closes)
                    if q2:
                        q2["spark"] = q["spark"]
                        q = q2
                    periods = period_windows(merged) or periods
                    ext = last_extended(intra, merged)
                    if ext:
                        ext_px, ext_t, sess = ext
                        scale = 0.01 if q.get("unit") == "pence" else 1.0
                        ext_px *= scale
                        regular_close = q["price"]
                        regular_time = q.get("asOf")
                        q["regularClose"] = regular_close
                        q["regularTime"] = regular_time
                        q["regularChange"] = q.get("change")
                        q["regularChangePct"] = q.get("changePct")
                        q["price"] = ext_px
                        q["asOf"] = ext_t
                        q["session"] = sess
                        # Change vs the official regular close (the after-hours move),
                        # which is what brokers show once the extended session is the last print.
                        if regular_close not in (None, 0):
                            q["change"] = ext_px - regular_close
                            q["changePct"] = q["change"] / regular_close * 100
                    else:
                        q["session"] = "regular"
            except Exception as e:
                if str(e) != "skip-intraday":
                    errors.append(f"{sym} intraday: {e}")
                q.setdefault("session", "regular")
            if "session" not in q:
                q["session"] = "regular"

            quotes[sym] = q
            if q["kind"] == "fx":
                # Yahoo FX: GBPUSD=X price is USD per 1 GBP
                fx[sym.replace("=X", "")] = q["price"]

            scale = 0.01 if q.get("unit") == "pence" else 1.0
            divs = dividends_from(daily, scale)
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
            hist_path = HIST / f"{sym}.json"
            payload = {
                "symbol": sym,
                "currency": q["currency"],
                "daily": daily_bars,
                "intraday": intra,
                "dividends": divs,
                "periods": periods,
                "session": q.get("session"),
            }
            hist_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            print(f"  {sym:12} {q['currency']} {q['price']}  {q.get('session') or ''}", flush=True)
        except Exception as e:
            errors.append(f"{sym}: {e}")
            print(f"  {sym:12} FAIL {e}", flush=True)
        time.sleep(0.18)

    if not quotes:
        print("ERROR: no quotes fetched; leaving existing files untouched", file=sys.stderr)
        for e in errors:
            print(" ", e, file=sys.stderr)
        return 1

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Finance",
        "delay": (
            "Stock and ETF quotes are delayed up to 15 minutes by the exchange. "
            "This file is refreshed about every 15 minutes (GitHub Actions can run late)."
        ),
        "fx": fx,
        "quotes": quotes,
        "errors": errors,
    }
    (DATA / "quotes.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {len(quotes)} quotes, {len(errors)} errors, in {time.time()-t0:.1f}s",
        flush=True,
    )
    if errors:
        print("Errors:", *errors, sep="\n  ", flush=True)
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from market_extras import write_market
        write_market(DATA, quotes, UA)
        try:
            from fetch_news_text import prefetch_news_text
            prefetch_news_text(DATA)
        except Exception as e:
            errors.append(f"news_text: {e}")
            print("news_text skipped:", e, flush=True)
        try:
            from crypto_markets import fetch as fetch_crypto_markets
            fetch_crypto_markets()
        except Exception as e:
            print("crypto markets skipped:", e)
        try:
            from market_sentiment import write_sentiment
            write_sentiment(DATA, quotes, UA)
        except Exception as e:
            print("market sentiment skipped:", e)
        try:
            from ipos import write_ipos
            added = write_ipos(DATA, quotes, UA)
            if added:
                quotes.update(added)
                out["quotes"] = quotes
                (DATA / "quotes.json").write_text(
                    json.dumps(out, separators=(",", ":")), encoding="utf-8"
                )
                print(f"Merged {len(added)} IPO quotes into data/quotes.json", flush=True)
        except Exception as e:
            print("IPOs skipped:", e)
            errors.append(f"ipos: {e}")
    except Exception as e:
        print(f"market extras failed: {e}", flush=True)
        errors.append(f"market extras: {e}")
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from analysis import write_analysis
        write_analysis(DATA, quotes, UA)
    except Exception as e:
        print(f"analysis failed: {e}", flush=True)
        errors.append(f"analysis: {e}")
    try:
        from movers_3m import compute as compute_movers
        compute_movers(DATA, quotes)
    except Exception as e:
        print(f"3m movers failed: {e}", flush=True)
        errors.append(f"movers_3m: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
