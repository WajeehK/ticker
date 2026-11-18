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

# Sharp, angular skull with a chiseled bevel. Same mark as icons/icon.svg.
SKULL_PATH = """
M256 68
L 322 80 L 376 122 L 414 184 L 426 250
L 416 304 L 436 352 L 422 408 L 372 454
L 308 478 L 256 484 L 204 478 L 140 454
L 90 408 L 76 352 L 96 304 L 86 250
L 98 184 L 136 122 L 190 80 Z
M 148 196 L 230 184 L 238 198 L 228 256 L 196 276 L 142 250 L 138 218 Z
M 364 196 L 282 184 L 274 198 L 284 256 L 316 276 L 370 250 L 374 218 Z
M 256 246 L 224 320 L 256 306 L 288 320 Z
M 166 346 L 346 346 L 356 362 L 342 420 L 298 440 L 256 446 L 214 440 L 170 420 L 156 362 Z
M 176 352 L 196 352 L 196 402 L 176 400 Z
M 204 352 L 224 352 L 224 410 L 204 408 Z
M 232 352 L 252 352 L 252 416 L 232 414 Z
M 260 352 L 280 352 L 280 416 L 260 414 Z
M 288 352 L 308 352 L 308 410 L 288 408 Z
M 316 352 L 336 352 L 336 402 L 316 400 Z
"""

BROW = """
    <path d="M140 172 L226 192 L236 206"/>
    <path d="M372 172 L286 192 L276 206"/>
    <path d="M142 252 L118 310 L132 348"/>
    <path d="M370 252 L394 310 L380 348"/>
"""

def svg_markup(size: int = 512, scale: float = 1.0) -> str:
    transform = ""
    if scale != 1.0:
        c = 256
        transform = f' transform="translate({c} {c}) scale({scale}) translate({-c} {-c})"'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">
  <rect width="512" height="512" fill="#000"/>
  <g{transform}>
    <path fill="#007204" fill-rule="evenodd" transform="translate(5 7)" d="{SKULL_PATH}"/>
    <path fill="#00C805" fill-rule="evenodd" d="{SKULL_PATH}"/>
    <g fill="none" stroke="#003901" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.65">
{BROW}
    </g>
  </g>
</svg>
"""


def favicon_svg() -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#000"/>
  <g transform="scale(0.0625)" fill-rule="evenodd">
    <path fill="#007204" transform="translate(5 7)" d="{SKULL_PATH}"/>
    <path fill="#00C805" d="{SKULL_PATH}"/>
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
