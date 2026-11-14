#!/usr/bin/env python3
"""Full-bleed Ticker PWA icons. Maskable glyphs stay inside the 80% safe zone;
the background fills every pixel so Android cannot add a white frame."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / "icons"
ROOT.mkdir(parents=True, exist_ok=True)

BG = (0, 0, 0, 255)
GREEN = (0, 200, 5, 255)
GREEN_SOFT = (0, 200, 5, 70)


def _stroke(size: int) -> Image.Image:
    """Bold up-right chart / feather mark, centred in the maskable safe zone."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Safe zone: 20% inset. Mark uses ~18–82% so it stays inside a circular crop.
    w = max(int(size * 0.13), 8)
    p = [
        (0.20 * size, 0.70 * size),
        (0.38 * size, 0.50 * size),
        (0.52 * size, 0.60 * size),
        (0.80 * size, 0.24 * size),
    ]
    d.line(p, fill=GREEN, width=w, joint="curve")
    # rounded caps
    r = w / 2
    for x, y in (p[0], p[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=GREEN)
    # arrow head at the peak
    hx, hy = p[-1]
    ah = size * 0.16
    d.polygon(
        [
            (hx + ah * 0.15, hy - ah * 0.05),
            (hx - ah * 0.55, hy + ah * 0.18),
            (hx - ah * 0.08, hy + ah * 0.62),
        ],
        fill=GREEN,
    )
    return img


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    # Tight green glow, clipped to the canvas — not a halo outside the mark.
    mark = _stroke(size)
    glow = mark.filter(ImageFilter.GaussianBlur(radius=max(2, size // 28)))
    # tint glow down so it doesn't wash the edges
    faded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    faded.paste(GREEN_SOFT, (0, 0), glow)
    canvas = Image.alpha_composite(canvas, faded)
    canvas = Image.alpha_composite(canvas, mark)
    # maskable and any share the same full-bleed bitmap; the OS applies the mask.
    return canvas.convert("RGBA")


def write_png(img: Image.Image, name: str):
    path = ROOT / name
    img.save(path, "PNG", optimize=True)
    print("wrote", path, img.size)


def favicon_svg() -> str:
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#000"/>
  <path d="M5.5 23.5 L12 16 L16.5 19.2 L26.5 7.2" fill="none" stroke="#00C805" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M26.5 7.2 L20.8 9.4 L25.4 14.4 Z" fill="#00C805"/>
</svg>
"""


def main():
    any192 = draw_icon(192, False)
    any512 = draw_icon(512, False)
    mask192 = draw_icon(192, True)
    mask512 = draw_icon(512, True)
    write_png(any192, "icon-192.png")
    write_png(any512, "icon-512.png")
    write_png(mask192, "icon-maskable-192.png")
    write_png(mask512, "icon-maskable-512.png")
    # apple-touch: 180, full-bleed (iOS rounds the corners)
    write_png(draw_icon(180, False), "apple-touch-icon.png")
    write_png(draw_icon(32, False).resize((32, 32), Image.Resampling.LANCZOS), "favicon-32.png")
    (ROOT / "favicon.svg").write_text(favicon_svg(), encoding="utf-8")
    print("wrote", ROOT / "favicon.svg")


if __name__ == "__main__":
    main()
