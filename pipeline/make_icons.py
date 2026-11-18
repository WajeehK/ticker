#!/usr/bin/env python3
"""Generate Ticker PWA icons: a bold original green skull on pure black."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / "icons"
ROOT.mkdir(parents=True, exist_ok=True)

BG = (0, 0, 0, 255)
GREEN = (0, 200, 5, 255)

# Same mark as icons/favicon.svg, 512 viewBox, maskable-safe (80% zone).
SKULL_PATH = """
M256 112
C 334 112 394 168 404 246
C 410 284 398 318 376 344
C 378 348 384 358 388 368
C 400 396 392 424 364 442
C 338 460 300 470 256 470
C 212 470 174 460 148 442
C 120 424 112 396 124 368
C 128 358 134 348 136 344
C 114 318 102 284 108 246
C 118 168 178 112 256 112
Z
M 192 224
C 168 224 150 244 150 270
C 150 294 168 314 196 308
C 218 304 234 288 234 270
C 234 246 214 224 192 224
Z
M 320 224
C 298 224 278 246 278 270
C 278 288 294 304 316 308
C 344 314 362 294 362 270
C 362 244 344 224 320 224
Z
M 256 302
C 240 302 228 314 226 328
C 224 338 232 346 242 344
L 256 338
L 270 344
C 280 346 288 338 286 328
C 284 314 272 302 256 302
Z
M 178 366
C 178 352 190 344 206 344
L 306 344
C 322 344 334 352 334 366
C 334 396 304 422 256 422
C 208 422 178 396 178 366
Z
M 202 360 L 202 398 L 220 398 L 220 360 Z
M 232 360 L 232 404 L 250 404 L 250 360 Z
M 262 360 L 262 404 L 280 404 L 280 360 Z
M 292 360 L 292 398 L 310 398 L 310 360 Z
"""


def svg_markup(size: int = 512, scale: float = 1.0) -> str:
    transform = ""
    if scale != 1.0:
        c = 256
        transform = f' transform="translate({c} {c}) scale({scale}) translate({-c} {-c})"'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">
  <rect width="512" height="512" fill="#000"/>
  <path fill="#00C805" fill-rule="evenodd"{transform} d="{SKULL_PATH}"/>
</svg>
"""


def favicon_svg() -> str:
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#000"/>
  <g transform="scale(0.0625)" fill="#00C805" fill-rule="evenodd">
    <path d="M256 112 C 334 112 394 168 404 246 C 410 284 398 318 376 344 C 378 348 384 358 388 368 C 400 396 392 424 364 442 C 338 460 300 470 256 470 C 212 470 174 460 148 442 C 120 424 112 396 124 368 C 128 358 134 348 136 344 C 114 318 102 284 108 246 C 118 168 178 112 256 112 Z M 192 224 C 168 224 150 244 150 270 C 150 294 168 314 196 308 C 218 304 234 288 234 270 C 234 246 214 224 192 224 Z M 320 224 C 298 224 278 246 278 270 C 278 288 294 304 316 308 C 344 314 362 294 362 270 C 362 244 344 224 320 224 Z M 256 302 C 240 302 228 314 226 328 C 224 338 232 346 242 344 L 256 338 L 270 344 C 280 346 288 338 286 328 C 284 314 272 302 256 302 Z M 178 366 C 178 352 190 344 206 344 L 306 344 C 322 344 334 352 334 366 C 334 396 304 422 256 422 C 208 422 178 396 178 366 Z M 202 360 L 202 398 L 220 398 L 220 360 Z M 232 360 L 232 404 L 250 404 L 250 360 Z M 262 360 L 262 404 L 280 404 L 280 360 Z M 292 360 L 292 398 L 310 398 L 310 360 Z"/>
  </g>
</svg>
"""


def render_svg(svg: str, px: int) -> Image.Image:
    """Rasterise via Chrome headless, then Lanczos to the target size."""
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if not chrome:
        raise RuntimeError("google-chrome is required to rasterise the icon")
    with tempfile.TemporaryDirectory() as td:
        tdir = Path(td)
        (tdir / "mark.svg").write_text(svg, encoding="utf-8")
        (tdir / "icon.html").write_text(
            f"""<!doctype html><html><head><style>
html,body{{margin:0;padding:0;background:#000;width:1024px;height:1024px;overflow:hidden}}
img{{width:1024px;height:1024px;display:block}}
</style></head><body><img src="mark.svg" alt=""></body></html>""",
            encoding="utf-8",
        )
        out = tdir / "shot.png"
        cmd = [
            chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=1", "--window-size=1024,1024",
            "--default-background-color=000000",
            f"--screenshot={out}", f"file://{tdir / 'icon.html'}",
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        im = Image.open(out).convert("RGBA")
        # flatten onto pure black in case of any alpha fringe
        canvas = Image.new("RGBA", im.size, BG)
        canvas = Image.alpha_composite(canvas, im)
        if canvas.size != (px, px):
            canvas = canvas.resize((px, px), Image.Resampling.LANCZOS)
        # crush near-black and near-green so edges stay crisp
        pix = canvas.load()
        for y in range(px):
            for x in range(px):
                r, g, b, a = pix[x, y]
                if r < 12 and g < 12 and b < 12:
                    pix[x, y] = BG
                elif abs(r - GREEN[0]) < 18 and abs(g - GREEN[1]) < 18 and abs(b - GREEN[2]) < 18:
                    pix[x, y] = GREEN
        return canvas.convert("RGBA")


def write_png(img: Image.Image, name: str) -> None:
    path = ROOT / name
    img.save(path, "PNG", optimize=True)
    print("wrote", path, img.size)


def main() -> None:
    any_master = render_svg(svg_markup(512, 1.0), 1024)
    mask_master = render_svg(svg_markup(512, 0.90), 1024)
    write_png(any_master.resize((192, 192), Image.Resampling.LANCZOS), "icon-192.png")
    write_png(any_master.resize((512, 512), Image.Resampling.LANCZOS), "icon-512.png")
    write_png(mask_master.resize((192, 192), Image.Resampling.LANCZOS), "icon-maskable-192.png")
    write_png(mask_master.resize((512, 512), Image.Resampling.LANCZOS), "icon-maskable-512.png")
    write_png(any_master.resize((180, 180), Image.Resampling.LANCZOS), "apple-touch-icon.png")
    write_png(any_master.resize((32, 32), Image.Resampling.LANCZOS), "favicon-32.png")
    (ROOT / "favicon.svg").write_text(favicon_svg(), encoding="utf-8")
    (ROOT / "icon.svg").write_text(svg_markup(512, 1.0), encoding="utf-8")
    print("wrote", ROOT / "favicon.svg")
    print("wrote", ROOT / "icon.svg")


if __name__ == "__main__":
    main()
