#!/usr/bin/env python3
"""Replace undersized or ultra-wide stock/ETF bitmaps with larger square marks."""
from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "img"
STOCKS = IMG / "stocks"
UA = (
    "TickerPWA/1.0 (https://wajeehk.github.io/ticker/; "
    "khurramwajeeh-d0ymqp@mail.grokbot.com)"
)
CTX = ssl.create_default_context()

ETF_FALLBACK = {
    "VUSA.L": "VOO", "VUAG.L": "VOO", "VWRL.L": "VT", "VWRP.L": "VT",
    "VUKE.L": "EWU", "ISF.L": "ISF", "CSP1.L": "CSPX", "IUSA.L": "IVV",
    "SGLN.L": "IAU", "IGLT.L": "GOVT",
}
LSE_FALLBACK = {
    "BATS.L": "BTI", "AZN.L": "AZN", "VOD.L": "VOD", "GSK.L": "GSK",
    "ULVR.L": "UL", "SHEL.L": "SHEL", "BP.L": "BP", "HSBA.L": "HSBC",
    "LLOY.L": "LYG", "BARC.L": "BCS", "DGE.L": "DEO", "RIO.L": "RIO",
    "BA.L": "BAESY", "REL.L": "RELX", "PRU.L": "PUK", "LSEG.L": "LNSTY",
    "TSCO.L": "TSCDY", "IHG.L": "IHG", "RR.L": "RYCEY", "NG.L": "NGG",
    "IMB.L": "IMBBY", "AHT.L": "ASHTY", "EXPN.L": "EXPGY", "SSE.L": "SSEZY",
    "CNA.L": "CPYYY", "OCDO.L": "OCDDY", "III.L": "TGANF",
}


def get(url: str, tries: int = 2, timeout: int = 15) -> bytes | None:
    for i in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                if r.status != 200:
                    time.sleep(0.8 * (i + 1))
                    continue
                data = r.read()
                if len(data) < 80:
                    return None
                if data[:15].lstrip().lower().startswith((b"<!doctype", b"<html")):
                    return None
                return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (i + 1))
                continue
            return None
        except Exception:
            time.sleep(0.5)
    return None


def score(im: Image.Image) -> tuple:
    w, h = im.size
    mn, mx = min(w, h), max(w, h)
    aspect = mx / max(1, mn)
    return (mn, -aspect, w * h)  # higher min side, squarer, more pixels is better


def try_open(data: bytes) -> Image.Image | None:
    from io import BytesIO
    try:
        im = Image.open(BytesIO(data))
        im.load()
        if min(im.size) < 16:
            return None
        return im
    except Exception:
        return None


def candidates(sym: str) -> list[str]:
    out = []
    for s in [sym, ETF_FALLBACK.get(sym), LSE_FALLBACK.get(sym), sym[:-2] if sym.endswith(".L") else None]:
        if s and s not in out:
            out.append(s)
    urls = []
    for s in out:
        urls.append(f"https://companiesmarketcap.com/img/company-logos/256/{s}.png")
        urls.append(f"https://financialmodelingprep.com/image-stock/{s}.png")
    return urls


def needs_upgrade(path: Path) -> bool:
    if not path.exists():
        return True
    try:
        im = Image.open(path)
        w, h = im.size
        if min(w, h) < 128:
            return True
        if max(w, h) / max(1, min(w, h)) > 1.8:
            return True
        return False
    except Exception:
        return True


def fit_square(im: Image.Image, size: int = 256) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    # if very wide wordmark, pad to a square canvas so it sits neatly on a chip
    side = max(w, h, size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    # scale so the mark uses ~78% of the square
    scale = (side * 0.78) / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((side - nw) // 2, (side - nh) // 2), resized)
    if side != size:
        canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    return canvas


def main() -> int:
    quotes = json.loads((ROOT / "data" / "quotes.json").read_text())
    qs = quotes.get("quotes") or quotes
    manifest = json.loads((IMG / "manifest.json").read_text())
    STOCKS.mkdir(parents=True, exist_ok=True)
    improved = skipped = failed = 0
    for sid, q in qs.items():
        kind = q.get("kind")
        if kind in ("crypto", "commodity", "fx", "index"):
            continue
        rec = manifest.get(sid)
        path = ROOT / rec["src"] if rec and rec.get("src") else STOCKS / (re.sub(r"[^A-Za-z0-9.\-]", "_", sid) + ".png")
        cur = None
        if path.exists():
            try:
                cur = Image.open(path)
                cur.load()
            except Exception:
                cur = None
        if cur is not None and not needs_upgrade(path):
            skipped += 1
            continue
        best_data = None
        best_im = None
        best_url = None
        for url in candidates(sid):
            data = get(url)
            if not data:
                continue
            im = try_open(data)
            if im is None:
                continue
            if best_im is None or score(im) > score(best_im):
                best_data, best_im, best_url = data, im, url
            # good enough
            if min(im.size) >= 200 and (max(im.size) / min(im.size) <= 1.4):
                break
            time.sleep(0.05)
        if best_im is None:
            # last resort: pad/upscale current if we have one
            if cur is not None:
                out = fit_square(cur, 256)
                dest = STOCKS / (re.sub(r"[^A-Za-z0-9.\-]", "_", sid) + ".png")
                out.save(dest, "PNG")
                manifest[sid] = {
                    "src": f"img/stocks/{dest.name}",
                    "kind": "etf" if kind == "etf" else "stock",
                    "chip": True,
                    "source": (rec or {}).get("source") or "Padded/upscaled existing mark",
                }
                improved += 1
                print(f"  pad {sid} {cur.size} -> 256")
            else:
                failed += 1
                print(f"  MISS {sid}")
            continue
        # only replace if the candidate is actually better
        if cur is not None and score(best_im) <= score(cur) and min(cur.size) >= 64:
            # still pad wide marks
            if max(cur.size) / max(1, min(cur.size)) > 1.8:
                out = fit_square(best_im if min(best_im.size) >= min(cur.size) else cur, 256)
            else:
                skipped += 1
                continue
        else:
            out = fit_square(best_im, 256) if max(best_im.size) / max(1, min(best_im.size)) > 1.4 or min(best_im.size) < 256 else best_im.convert("RGBA")
            if out.size != (256, 256) and min(out.size) >= 128:
                # leave already-square 256+ as-is but cap huge ones
                if max(out.size) > 512:
                    out = out.resize((256, 256), Image.Resampling.LANCZOS)
            elif out.size != (256, 256):
                out = fit_square(out, 256)
        dest = STOCKS / (re.sub(r"[^A-Za-z0-9.\-]", "_", sid) + ".png")
        out.save(dest, "PNG")
        manifest[sid] = {
            "src": f"img/stocks/{dest.name}",
            "kind": "etf" if kind == "etf" else "stock",
            "chip": True,
            "source": f"Downloaded {best_url} (stored locally, not hotlinked)",
        }
        improved += 1
        print(f"  OK {sid:12} {best_im.size} <- {best_url}")
        time.sleep(0.08)
    (IMG / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"upgrade done improved={improved} skipped={skipped} failed={failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
