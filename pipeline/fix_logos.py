#!/usr/bin/env python3
"""Audit local logos: fix blank and light-on-white marks, prefer a square brand mark."""
from __future__ import annotations

import json
import ssl
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageOps, ImageFilter, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "img"
MANIFEST = IMG / "manifest.json"
UA = "TickerPWA/1.2 (https://wajeehk.github.io/ticker/)"
CTX = ssl.create_default_context()

# Known official / high-res square marks when the stored file is a white-on-transparent outline.
OVERRIDES = {
    "APP": [
        "https://logo.clearbit.com/applovin.com",
        "https://www.google.com/s2/favicons?domain=applovin.com&sz=256",
        "https://icons.duckduckgo.com/ip3/applovin.com.ico",
    ],
}


def _open_url(url: str, timeout: int = 12) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
        with urlopen(req, timeout=timeout, context=CTX) as r:
            if getattr(r, "status", 200) >= 400:
                return None
            return r.read()
    except Exception:
        return None


def _as_rgba(im: Image.Image) -> Image.Image:
    if im.mode != "RGBA":
        return im.convert("RGBA")
    return im


def analyze(path: Path) -> dict:
    im = _as_rgba(Image.open(path))
    w, h = im.size
    px = list(im.getdata())
    n = len(px)
    trans = sum(1 for r, g, b, a in px if a < 16)
    opaque = [(r, g, b, a) for r, g, b, a in px if a >= 16]
    if not opaque:
        return {"blank": True, "light": False, "wordmark": False, "opaque": 0, "size": (w, h)}
    light = sum(1 for r, g, b, a in opaque if r > 230 and g > 230 and b > 230)
    dark = sum(1 for r, g, b, a in opaque if (r + g + b) < 90)
    # bounding box of opaque pixels
    xs = [i % w for i, p in enumerate(px) if p[3] >= 16]
    ys = [i // w for i, p in enumerate(px) if p[3] >= 16]
    bw, bh = (max(xs) - min(xs) + 1), (max(ys) - min(ys) + 1)
    aspect = max(bw, 1) / max(bh, 1)
    coverage = len(opaque) / max(1, bw * bh)
    blank = len(opaque) < max(30, n * 0.01)
    light_only = (light / len(opaque) > 0.72) and (dark / len(opaque) < 0.08)
    wordmark = aspect > 2.15 and coverage < 0.45
    return {
        "blank": blank,
        "light": light_only,
        "wordmark": wordmark,
        "opaque": len(opaque),
        "light_n": light,
        "dark_n": dark,
        "aspect": round(aspect, 2),
        "coverage": round(coverage, 3),
        "size": (w, h),
    }


def composite_dark(im: Image.Image, bg=(17, 17, 17, 255)) -> Image.Image:
    im = _as_rgba(im)
    canvas = Image.new("RGBA", im.size, bg)
    return Image.alpha_composite(canvas, im)


def load_remote(url: str) -> Image.Image | None:
    raw = _open_url(url)
    if not raw:
        return None
    try:
        im = Image.open(BytesIO(raw))
        im = _as_rgba(im)
        if im.size[0] < 16 or im.size[1] < 16:
            return None
        # skip nearly empty
        opaque = sum(1 for r, g, b, a in im.getdata() if a >= 16)
        if opaque < 20:
            return None
        return im
    except Exception:
        return None


def squarify(im: Image.Image, size: int = 256) -> Image.Image:
    im = _as_rgba(im)
    # trim transparent/near-bg
    bg = Image.new("RGBA", im.size, (0, 0, 0, 0))
    diff = ImageChops.difference(im, bg)
    bbox = diff.getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    side = int(max(w, h) * 1.18)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def fix_light(path: Path) -> str:
    im = _as_rgba(Image.open(path))
    out = composite_dark(squarify(im, max(im.size[0], 128)))
    out.save(path, "PNG", optimize=True)
    return "dark-backed"


def save_override(path: Path, im: Image.Image, dark: bool) -> None:
    im = squarify(im, 256)
    if dark:
        im = composite_dark(im)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)


def main() -> None:
    man = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    report = {"fixed": [], "dark": [], "blank": [], "wordmark": [], "ok": 0, "overrides": []}
    # First, try explicit overrides
    for sid, urls in OVERRIDES.items():
        rec = man.get(sid) or {}
        src = rec.get("src") or f"img/stocks/{sid}.png"
        dest = ROOT / src
        got = None
        for u in urls:
            got = load_remote(u)
            if got:
                break
        if got:
            # If fetched mark is light-on-transparent, put it on dark
            tmp = dest.with_suffix(".tmp.png")
            got.save(tmp, "PNG")
            info = analyze(tmp)
            dark = info["light"] or info["blank"]
            save_override(dest, got, dark=dark)
            tmp.unlink(missing_ok=True)
            rec.update({"src": src, "chip": True, "dark": True if dark else rec.get("dark", False), "kind": rec.get("kind") or "stock", "source": "Brand mark refresh"})
            man[sid] = rec
            report["overrides"].append(sid)
            print("override", sid, "dark" if dark else "ok")

    for path in sorted(IMG.rglob("*.png")):
        rel = str(path.relative_to(ROOT))
        try:
            info = analyze(path)
        except Exception as e:
            report["blank"].append(rel + f" ({e})")
            continue
        # map manifest key
        key = None
        for k, v in man.items():
            if isinstance(v, dict) and v.get("src") == rel:
                key = k
                break
        if info["blank"]:
            report["blank"].append(rel)
            continue
        if info["light"]:
            fix_light(path)
            if key:
                man[key]["dark"] = True
                man[key]["chip"] = True
            report["fixed"].append(rel)
            report["dark"].append(rel)
            continue
        if info["wordmark"]:
            report["wordmark"].append(rel)
        report["ok"] += 1

    MANIFEST.write_text(json.dumps(man, indent=2, sort_keys=True), encoding="utf-8")
    print(
        f"logos: ok={report['ok']} light-fixed={len(report['fixed'])} blank={len(report['blank'])} "
        f"wordmark={len(report['wordmark'])} overrides={report['overrides']}",
        flush=True,
    )
    # write a short audit next to the script output
    (Path("/tmp/logo_audit.json")).write_text(json.dumps({
        "fixed": report["fixed"],
        "blank": report["blank"][:80],
        "wordmark": report["wordmark"][:80],
        "overrides": report["overrides"],
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
