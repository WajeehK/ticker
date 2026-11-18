#!/usr/bin/env python3
"""Stocks and ETFs up 10% or more over the last ~3 months, from saved daily history."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HIST = DATA / "hist"
# ~63 trading days ≈ 3 calendar months
WINDOW = 63
MIN_RET = 10.0


def _close(bar) -> float | None:
    if not isinstance(bar, dict):
        return None
    v = bar.get("c")
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def compute(data_dir: Path | None = None, quotes: dict | None = None) -> dict:
    data_dir = data_dir or DATA
    hist = data_dir / "hist"
    quotes = quotes or {}
    qpath = data_dir / "quotes.json"
    if not quotes and qpath.exists():
        try:
            quotes = (json.loads(qpath.read_text(encoding="utf-8")).get("quotes") or {})
        except Exception:
            quotes = {}
    items = []
    scanned = 0
    for path in sorted(hist.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        daily = payload.get("daily") or []
        if len(daily) < 20:
            continue
        sid = payload.get("symbol") or path.stem
        q = quotes.get(sid) or {}
        kind = q.get("kind") or "equity"
        if kind not in ("equity", "etf"):
            continue
        if str(sid).startswith("^") or str(sid).endswith("=F") or str(sid).endswith("=X"):
            continue
        closes = [(int(b["t"]), _close(b)) for b in daily if isinstance(b, dict) and b.get("t") is not None]
        closes = [(t, c) for t, c in closes if c]
        if len(closes) < 20:
            continue
        scanned += 1
        last_t, last = closes[-1]
        # prefer the bar closest to 63 trading sessions back, else ~91 calendar days
        target_i = max(0, len(closes) - 1 - WINDOW)
        start_t, start = closes[target_i]
        if not start:
            continue
        ret = (last - start) / start * 100.0
        if ret < MIN_RET:
            continue
        spark = [round(c, 4) for _, c in closes[target_i:]]
        if len(spark) > 42:
            step = max(1, len(spark) // 36)
            spark = spark[::step][:36]
        items.append({
            "id": sid,
            "name": q.get("name") or q.get("shortName") or sid,
            "kind": kind,
            "start": round(start, 6),
            "last": round(last, 6),
            "ret": round(ret, 2),
            "startT": start_t,
            "lastT": last_t,
            "spark": spark,
        })
    items.sort(key=lambda r: r["ret"], reverse=True)
    out = {
        "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "windowTradingDays": WINDOW,
        "minReturn": MIN_RET,
        "scanned": scanned,
        "count": len(items),
        "items": items,
        "note": (
            "Percentage change over about three months of daily closes from Yahoo Finance. "
            "Not a prediction and not financial advice."
        ),
    }
    path = data_dir / "movers_3m.json"
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(items)} 3-month +10% names (scanned {scanned}) to {path}", flush=True)
    return out


if __name__ == "__main__":
    compute()
