#!/usr/bin/env python3
"""Generate Ticker PWA icons: a bold T monogram fused with a rising line, #00C805 on black."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "icons"
ROOT.mkdir(parents=True, exist_ok=True)

BG = (0, 0, 0, 255)
GREEN = (0, 200, 5, 255)

# Geometric T (filled) plus a rising ticker line. Thick enough to stay crisp at 48px
# (a 64-unit stroke on a 512 canvas is 6px at 48px).
def svg_markup(size: int = 512, scale: float = 1.0) -> str:
    transform = ""
    if scale != 1.0:
        c = 256
        transform = f' transform="translate({c} {c}) scale({scale}) translate({-c} {-c})"'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">
  <rect width="512" height="512" fill="#000"/>
  <g{transform} fill="#00C805" fill-rule="evenodd">
    <path d="M108 124h228v72H260v212h-72V196H108z"/>
    <path d="M86 412 L 230 292 L 424 146" fill="none" stroke="#00C805" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
"""


def favicon_svg() -> str:
    # Same mark, 32 viewBox, no bevel. Scale 512→32 = 0.0625.
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#000"/>
  <g transform="scale(0.0625)" fill="#00C805" fill-rule="evenodd">
    <path d="M108 124h228v72H260v212h-72V196H108z"/>
    <path d="M86 412 L 230 292 L 424 146" fill="none" stroke="#00C805" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
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
