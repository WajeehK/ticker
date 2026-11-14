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


def chart(sym: str, range_: str, interval: str) -> dict | None:
    data = get_json(
        CHART.format(sym=urllib.parse.quote(sym, safe="")),
        {
            "range": range_,
            "interval": interval,
            "includePrePost": "false",
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
        if ohlc:
            o = (q.get("open") or [None] * len(ts))[i]
            h = (q.get("high") or [None] * len(ts))[i]
            l = (q.get("low") or [None] * len(ts))[i]
            if o is None or h is None or l is None:
                continue
            row.update({"o": float(o), "h": float(h), "l": float(l)})
        out.append(row)
    return out


def kind_of(meta: dict, symbol: str) -> str:
    if symbol.endswith("=X"):
        return "fx"
    it = (meta.get("instrumentType") or "").upper()
    if it == "ETF":
        return "etf"
    if it == "MUTUALFUND":
        return "fund"
    if it == "INDEX":
        return "index"
    return "equity"


def pack_quote(symbol: str, meta: dict, daily_closes: list) -> dict | None:
    price = meta.get("regularMarketPrice")
    if price is None:
        return None
    prev = meta.get("previousClose")
    if prev is None:
        prev = meta.get("chartPreviousClose")
    price = float(price)
    prev = float(prev) if prev is not None else None
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
    return {
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
    }


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    HIST.mkdir(parents=True, exist_ok=True)
    quotes: dict = {}
    errors: list[str] = []
    fx: dict = {}
    t0 = time.time()

    for i, sym in enumerate(UNIVERSE):
        try:
            daily = chart(sym, "5y", "1d")
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
            try:
                raw_i = chart(sym, "1d", "5m")
                if raw_i:
                    intra = bars(raw_i, ohlc=False)
                    # Prefer the 5m call's meta when it carries previousClose
                    m2 = raw_i.get("meta") or {}
                    q2 = pack_quote(sym, {**meta, **{k: v for k, v in m2.items() if v is not None}}, closes)
                    if q2:
                        q2["spark"] = q["spark"] if len(q["spark"]) >= len(spark_from([b["c"] for b in intra])) else spark_from([b["c"] for b in intra])
                        # Keep a short daily spark for multi-day context on the list
                        q2["spark"] = q["spark"]
                        q = q2
            except Exception as e:
                errors.append(f"{sym} intraday: {e}")

            quotes[sym] = q
            if q["kind"] == "fx":
                # Yahoo FX: GBPUSD=X price is USD per 1 GBP
                fx[sym.replace("=X", "")] = q["price"]

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
            hist_path = HIST / f"{sym}.json"
            payload = {
                "symbol": sym,
                "currency": q["currency"],
                "daily": daily_bars,
                "intraday": intra,
            }
            hist_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            print(f"  {sym:12} {q['currency']} {q['price']}", flush=True)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
