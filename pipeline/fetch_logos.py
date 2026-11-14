#!/usr/bin/env python3
"""Download asset logos into img/ for the static PWA. Never hotlinks.

Sources (see SOURCES.md):
  - Crypto: spothq/cryptocurrency-icons (CC0) colour SVGs, then CoinGecko
    market-image PNGs for Kraken USD pairs still missing.
  - Stocks/ETFs: Financial Modeling Prep image-stock/{SYMBOL}.png
  - Indices: typographic marks generated locally if no bitmap is found.

Writes img/manifest.json mapping ticker id -> {src, kind, chip}.
"""
from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageStat

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "img"
STOCKS = IMG / "stocks"
CRYPTO = IMG / "crypto"
CICONS = Path("/tmp/cicons/cryptocurrency-icons-master/svg/color")
UA = (
    "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; "
    "khurramwajeeh-d0ymqp@mail.grokbot.com)"
)
CTX = ssl.create_default_context()
FMP = "https://financialmodelingprep.com/image-stock/{sym}.png"

# Issuer fallbacks when a London ETF ticker 404s: try the US sister ticker
ETF_FALLBACK = {
    "VUSA.L": "VOO", "VUAG.L": "VOO", "VWRL.L": "VT", "VWRP.L": "VT",
    "VUKE.L": "EWU", "ISF.L": "ISF", "CSP1.L": "CSPX", "IUSA.L": "IVV",
    "SGLN.L": "IAU", "IGLT.L": "GOVT",
}


def get(url: str, tries: int = 2, timeout: int = 20) -> bytes | None:
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                if r.status != 200:
                    last = f"HTTP {r.status}"
                    time.sleep(1.2 * (i + 1))
                    continue
                data = r.read()
                if len(data) < 40:
                    last = "too small"
                    continue
                return data
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2.5 * (i + 1))
                continue
            return None
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.0 * (i + 1))
    return None


def needs_chip(path: Path) -> bool:
    """True when the mark would vanish on a dark background (dark ink, or a
    white box that must be preserved)."""
    try:
        if path.suffix.lower() == ".svg":
            return False  # colour coin icons already have a filled circle
        im = Image.open(path).convert("RGBA")
        px = list(im.getdata())
        vis = [p for p in px if p[3] > 24]
        if not vis:
            return True
        # average luminance of visible pixels
        lum = sum(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in vis) / len(vis)
        opa = len(vis) / max(1, len(px))
        # dark ink (Apple, Nike) or a mostly-opaque pale square (logo on white)
        return lum < 70 or (opa > 0.85 and lum > 200)
    except Exception:
        return True


def write(path: Path, data: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    # sanity: images must open, svgs must look like svg
    if path.suffix.lower() == ".svg":
        t = data[:200].lstrip().lower()
        return t.startswith(b"<svg") or t.startswith(b"<?xml") or t.startswith(b"\xef\xbb\xbf")
    try:
        im = Image.open(path)
        im.load()
        return im.size[0] >= 16 and im.size[1] >= 16
    except Exception:
        path.unlink(missing_ok=True)
        return False


def load_symbols() -> list[str]:
    quotes = ROOT / "data" / "quotes.json"
    syms = []
    if quotes.exists():
        d = json.loads(quotes.read_text())
        for s, q in (d.get("quotes") or {}).items():
            if q.get("kind") != "fx":
                syms.append(s)
    return syms


def load_kraken_codes() -> list[str]:
    p = Path("/tmp/kraken-usd-codes.json")
    if p.exists():
        return json.loads(p.read_text())
    data = get("https://api.kraken.com/0/public/AssetPairs")
    if not data:
        return ["BTC", "ETH", "SOL"]
    d = json.loads(data)
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
        codes.add(c)
    return sorted(codes)


def copy_crypto_icons(codes: list[str], manifest: dict) -> None:
    CRYPTO.mkdir(parents=True, exist_ok=True)
    aliases = {"BTC": "btc", "XBT": "btc"}
    for code in codes:
        stem = aliases.get(code, code.lower())
        src = CICONS / f"{stem}.svg"
        if not src.exists():
            continue
        dest = CRYPTO / f"{stem}.svg"
        dest.write_bytes(src.read_bytes())
        manifest[code + "-USD"] = {
            "src": f"img/crypto/{stem}.svg",
            "kind": "crypto",
            "chip": False,
            "source": "spothq/cryptocurrency-icons (CC0)",
        }
        print(f"  crypto {code} <- icons/{stem}.svg")


def fetch_coingecko(codes: list[str], manifest: dict) -> None:
    missing = [c for c in codes if (c + "-USD") not in manifest]
    if not missing:
        return
    want = {c.lower(): c for c in missing}
    images: dict[str, str] = {}
    for page in range(1, 6):  # top 1250
        url = (
            "https://api.coingecko.com/api/v3/coins/markets"
            f"?vs_currency=usd&per_page=250&page={page}&sparkline=false"
        )
        raw = get(url, tries=2, timeout=30)
        if not raw:
            print(f"  CoinGecko page {page} failed, stopping")
            break
        try:
            rows = json.loads(raw)
        except Exception:
            break
        if not rows:
            break
        for row in rows:
            sym = (row.get("symbol") or "").upper()
            if sym in {c.upper() for c in missing} and sym not in images:
                img = (row.get("image") or "").replace("/thumb/", "/small/").replace("/large/", "/small/")
                if img:
                    images[sym] = img
        time.sleep(0.8)
        if len(images) >= len(missing):
            break
    print(f"  CoinGecko matched {len(images)} of {len(missing)} missing")
    for sym, url in images.items():
        raw = get(url, tries=2)
        if not raw:
            continue
        # prefer png
        dest = CRYPTO / (sym.lower() + ".png")
        if write(dest, raw):
            manifest[sym + "-USD"] = {
                "src": f"img/crypto/{dest.name}",
                "kind": "crypto",
                "chip": needs_chip(dest),
                "source": "CoinGecko coin image (downloaded, not hotlinked)",
            }
            print(f"  crypto {sym} <- coingecko")
        time.sleep(0.12)


def fetch_stocks(symbols: list[str], manifest: dict) -> None:
    STOCKS.mkdir(parents=True, exist_ok=True)
    for sym in symbols:
        # try native symbol, then fallbacks
        candidates = [sym]
        if sym.endswith(".L"):
            candidates.append(sym)  # FMP accepted VUSA.L earlier
            if sym in ETF_FALLBACK:
                candidates.append(ETF_FALLBACK[sym])
            candidates.append(sym[:-2])  # VUSA
        if sym.startswith("^"):
            candidates += [sym[1:], "SPY" if "GSPC" in sym else ""]
            candidates = [c for c in candidates if c]
        ok = False
        used = None
        for cand in candidates:
            url = FMP.format(sym=cand)
            raw = get(url, tries=2)
            if not raw:
                continue
            # reject obvious HTML error pages
            if raw[:15].lstrip().lower().startswith((b"<!doctype", b"<html")):
                continue
            dest = STOCKS / (re.sub(r"[^A-Za-z0-9.\-]", "_", sym) + ".png")
            if write(dest, raw):
                manifest[sym] = {
                    "src": f"img/stocks/{dest.name}",
                    "kind": "index" if sym.startswith("^") else "stock",
                    "chip": True,  # always sit on a light chip
                    "dark": needs_chip(dest),
                    "source": f"Financial Modeling Prep image-stock/{cand}.png",
                }
                ok = True
                used = cand
                break
            time.sleep(0.05)
        print(f"  stock {sym:12} {'OK '+used if ok else 'MISS'}")
        time.sleep(0.12)


def make_index_mark(sym: str, label: str, bg: tuple, fg=(255, 255, 255)) -> Path:
    """Simple typographic tile used only when no official bitmap was found."""
    dest = STOCKS / (re.sub(r"[^A-Za-z0-9.\-]", "_", sym) + ".png")
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 256
    im = Image.new("RGBA", (size, size), bg + (255,))
    d = ImageDraw.Draw(im)
    # try a bold font
    font = None
    for path, sz in [
        ("/usr/share/fonts/truetype/sand-box/google/Geist/Geist-VariableFont_wght.ttf", 72 if len(label) > 3 else 92),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 80),
    ]:
        if Path(path).exists():
            try:
                font = ImageFont.truetype(path, sz)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()
    x0, y0, x1, y1 = d.textbbox((0, 0), label, font=font)
    d.text(((size - (x1 - x0)) / 2, (size - (y1 - y0)) / 2 - 8), label, fill=fg + (255,), font=font)
    im.save(dest, "PNG")
    return dest


def ensure_indices(manifest: dict) -> None:
    tiles = {
        "^GSPC": ("S&P", (14, 14, 16)),
        "^IXIC": ("NDX", (0, 82, 156)),
        "^DJI": ("DJI", (16, 16, 16)),
        "^FTSE": ("UKX", (0, 51, 160)),
    }
    for sym, (label, bg) in tiles.items():
        dest = make_index_mark(sym, label, bg)
        manifest[sym] = {
            "src": f"img/stocks/{dest.name}",
            "kind": "index",
            "chip": True,
            "source": "Generated typographic mark (no official bitmap found)",
        }
        print(f"  index {sym} typographic mark")


def main() -> int:
    IMG.mkdir(parents=True, exist_ok=True)
    manifest: dict = {}
    codes = load_kraken_codes()
    print(f"Crypto: {len(codes)} Kraken USD pairs")
    if CICONS.exists():
        copy_crypto_icons(codes, manifest)
    else:
        print("  cryptocurrency-icons not extracted; skipping SVG copy")
    fetch_coingecko(codes, manifest)
    symbols = load_symbols()
    print(f"Stocks/ETFs/indices: {len(symbols)}")
    fetch_stocks(symbols, manifest)
    try:
        from make_asset_marks import apply as apply_marks
        apply_marks(manifest)
    except Exception as e:
        print("asset marks skipped:", e)
        ensure_indices(manifest)
    (IMG / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    crypto_n = sum(1 for v in manifest.values() if v.get("kind") == "crypto")
    stock_n = sum(1 for v in manifest.values() if v.get("kind") in ("stock", "index"))
    print(f"Wrote {len(manifest)} logos ({crypto_n} crypto, {stock_n} stock/index)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
