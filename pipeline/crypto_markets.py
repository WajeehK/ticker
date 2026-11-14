#!/usr/bin/env python3
"""Fetch top crypto markets, trending and recently-added lists from CoinGecko.

Writes data/crypto_markets.json for the PWA (no runtime hotlink required).
Also downloads any missing / undersized coin logos into img/crypto/.
"""
from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
IMG = ROOT / "img"
CRYPTO = IMG / "crypto"
UA = (
    "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; "
    "khurramwajeeh-d0ymqp@mail.grokbot.com)"
)
CTX = ssl.create_default_context()
CG = "https://api.coingecko.com/api/v3"


def get(url: str, tries: int = 3, timeout: int = 30) -> bytes | None:
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,image/*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                if r.status != 200:
                    last = f"HTTP {r.status}"
                    time.sleep(1.5 * (i + 1))
                    continue
                data = r.read()
                if len(data) < 20:
                    last = "too small"
                    continue
                return data
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(4 * (i + 1))
                continue
            return None
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.2 * (i + 1))
    print("  fetch fail", url[:80], last)
    return None


def get_json(url: str):
    raw = get(url)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def kraken_codes() -> set[str]:
    p = Path("/tmp/kraken-usd-codes.json")
    if p.exists():
        return {c.upper() for c in json.loads(p.read_text())}
    raw = get("https://api.kraken.com/0/public/AssetPairs")
    if not raw:
        return {"BTC", "ETH", "SOL"}
    d = json.loads(raw)
    codes = set()
    for v in (d.get("result") or {}).values():
        ws = v.get("wsname") or ""
        if not ws.endswith("/USD"):
            continue
        if v.get("status") and v.get("status") != "online":
            continue
        c = ws.split("/")[0]
        if c == "XBT":
            c = "BTC"
        codes.add(c.upper())
    Path("/tmp/kraken-usd-codes.json").write_text(json.dumps(sorted(codes)))
    return codes


def large_url(url: str) -> str:
    if not url:
        return url
    return url.replace("/thumb/", "/large/").replace("/small/", "/large/")


def ticker_of(sym: str) -> str:
    s = (sym or "").upper()
    if s == "XBT":
        s = "BTC"
    return s + "-USD"


def pack_coin(row: dict, kraken: set[str]) -> dict | None:
    sym = (row.get("symbol") or "").upper()
    if not sym:
        return None
    if sym == "XBT":
        sym = "BTC"
    price = row.get("current_price")
    spark = ((row.get("sparkline_in_7d") or {}).get("price")) or []
    spark = [round(float(x), 8) for x in spark if x is not None][-48:]
    chg = row.get("price_change_percentage_24h")
    if chg is None:
        chg = (row.get("price_change_percentage_24h_in_currency"))
    return {
        "cgId": row.get("id"),
        "symbol": sym,
        "ticker": ticker_of(sym),
        "name": row.get("name") or sym,
        "price": price,
        "changePct": chg,
        "marketCap": row.get("market_cap"),
        "volume": row.get("total_volume"),
        "rank": row.get("market_cap_rank"),
        "spark": spark,
        "image": large_url(row.get("image") or ""),
        "kraken": sym in kraken,
        "ath": row.get("ath"),
        "atl": row.get("atl"),
    }


def ensure_logo(coin: dict, manifest: dict) -> None:
    ticker = coin["ticker"]
    rec = manifest.get(ticker)
    path = ROOT / rec["src"] if rec and rec.get("src") else None
    need = True
    if path and path.exists():
        if path.suffix.lower() == ".svg":
            coin["logo"] = rec["src"]
            need = False
        else:
            try:
                im = Image.open(path)
                if min(im.size) >= 128:
                    coin["logo"] = rec["src"]
                    need = False
            except Exception:
                need = True
    if not need:
        return
    url = coin.get("image")
    if not url:
        if rec:
            coin["logo"] = rec["src"]
        return
    raw = get(url, tries=2, timeout=20)
    if not raw or raw[:15].lstrip().lower().startswith((b"<!doctype", b"<html")):
        if rec:
            coin["logo"] = rec["src"]
        return
    CRYPTO.mkdir(parents=True, exist_ok=True)
    dest = CRYPTO / (coin["symbol"].lower() + ".png")
    dest.write_bytes(raw)
    try:
        im = Image.open(dest)
        im.load()
        if min(im.size) < 16:
            dest.unlink(missing_ok=True)
            if rec:
                coin["logo"] = rec["src"]
            return
    except Exception:
        dest.unlink(missing_ok=True)
        if rec:
            coin["logo"] = rec["src"]
        return
    src = f"img/crypto/{dest.name}"
    manifest[ticker] = {
        "src": src,
        "kind": "crypto",
        "chip": False,
        "source": "CoinGecko coin image, large (downloaded, not hotlinked)",
    }
    coin["logo"] = src
    print(f"  logo {ticker} <- coingecko large {im.size}")


def write_markets(data: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    # drop ephemeral image urls from committed json (logos are local)
    def clean(c):
        d = {k: v for k, v in c.items() if k != "image"}
        return d
    out = {
        "asOf": int(time.time()),
        "source": "CoinGecko /coins/markets, /search/trending (downloaded at build time)",
        "vs": "usd",
        "coins": [clean(c) for c in data.get("coins") or []],
        "trending": [clean(c) for c in data.get("trending") or []],
        "newListings": [clean(c) for c in data.get("newListings") or []],
    }
    (DATA / "crypto_markets.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote data/crypto_markets.json ({len(out['coins'])} coins, {len(out['trending'])} trending, {len(out['newListings'])} new)")


def fetch(manifest: dict | None = None) -> dict:
    if manifest is None:
        man_path = IMG / "manifest.json"
        manifest = json.loads(man_path.read_text()) if man_path.exists() else {}
    kraken = kraken_codes()
    print(f"Kraken USD pairs: {len(kraken)}")
    markets = get_json(
        CG + "/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1"
        "&sparkline=true&price_change_percentage=24h"
    )
    coins = []
    if isinstance(markets, list):
        for row in markets:
            c = pack_coin(row, kraken)
            if c:
                coins.append(c)
    print(f"Top markets: {len(coins)}")

    trending = []
    tr = get_json(CG + "/search/trending")
    if isinstance(tr, dict):
        for item in (tr.get("coins") or []):
            it = item.get("item") or {}
            # trending payload is thinner; enrich from markets if present
            sym = (it.get("symbol") or "").upper()
            hit = next((c for c in coins if c["symbol"] == sym or c.get("cgId") == it.get("id")), None)
            if hit:
                trending.append(dict(hit))
                continue
            data = it.get("data") or {}
            chg = data.get("price_change_percentage_24h")
            if isinstance(chg, dict):
                chg = chg.get("usd")
            price = data.get("price")
            if isinstance(price, str):
                try:
                    price = float(re.sub(r"[^0-9.eE-]", "", price) or "nan")
                except Exception:
                    price = None
            trending.append({
                "cgId": it.get("id"),
                "symbol": sym,
                "ticker": ticker_of(sym),
                "name": it.get("name") or sym,
                "price": price,
                "changePct": chg,
                "marketCap": (data.get("market_cap") if isinstance(data.get("market_cap"), (int, float)) else None),
                "volume": None,
                "rank": it.get("market_cap_rank"),
                "spark": [],
                "image": large_url(it.get("large") or it.get("small") or it.get("thumb") or ""),
                "kraken": sym in kraken,
            })
    print(f"Trending: {len(trending)}")

    new_list = []
    recent = get_json(
        CG + "/coins/markets?vs_currency=usd&category=recently-added&order=market_cap_desc"
        "&per_page=20&page=1&sparkline=true&price_change_percentage=24h"
    )
    if isinstance(recent, list):
        for row in recent:
            c = pack_coin(row, kraken)
            if c:
                new_list.append(c)
    print(f"Recently added: {len(new_list)}")

    # logos for everything we will show
    seen = set()
    for c in coins + trending + new_list:
        if c["ticker"] in seen:
            continue
        seen.add(c["ticker"])
        ensure_logo(c, manifest)
        time.sleep(0.08)

    man_path = IMG / "manifest.json"
    man_path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    payload = {"coins": coins, "trending": trending, "newListings": new_list}
    write_markets(payload)
    return payload


def main() -> int:
    fetch()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
