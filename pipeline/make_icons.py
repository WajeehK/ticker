#!/usr/bin/env python3
"""Generate PWA icons: a dark glass squircle with an upward tick/sparkline."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "icons"
ROOT.mkdir(parents=True, exist_ok=True)

BG = (10, 10, 10, 255)
INK = (236, 235, 230, 255)
UP = (52, 199, 123, 255)
UP2 = (125, 255, 180, 255)
GLASS = (255, 255, 255, 28)


def squircle_mask(size, r, pad=0):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((pad, pad, size - 1 - pad, size - 1 - pad), radius=r, fill=255)
    return m


def draw_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = int(size * 0.12) if maskable else 0
    r = int((size - 2 * pad) * 0.22)
    # background
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.rounded_rectangle((pad, pad, size - 1 - pad, size - 1 - pad), radius=r, fill=BG)
    # inner sheen
    sheen = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.rounded_rectangle(
        (pad + 1, pad + 1, size - 2 - pad, size - 2 - pad),
        radius=max(r - 2, 8),
        outline=(255, 255, 255, 48),
        width=max(1, size // 256),
    )
    # top highlight gradient-ish
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    inset = pad + size // 32
    hd.pieslice(
        (pad - size // 6, pad - size // 2, size - pad + size // 6, pad + size * 0.62),
        0, 360, fill=(255, 255, 255, 22),
    )
    mask = squircle_mask(size, r, pad)
    hl.putalpha(ImageChops_and(hl.getchannel("A"), mask))

    img = Image.alpha_composite(body, sheen)

    # sparkline path (a tick that rises)
    inner = size - 2 * pad
    # coordinates in 0-1 of inner box
    pts = [
        (0.18, 0.68),
        (0.32, 0.60),
        (0.44, 0.64),
        (0.56, 0.46),
        (0.70, 0.50),
        (0.84, 0.28),
    ]
    coords = [(pad + x * inner, pad + y * inner) for x, y in pts]
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    w = max(3, size // 22)
    # glow
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.line(coords, fill=(52, 199, 123, 140), width=w * 3, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(2, size // 40)))
    ld.line(coords, fill=UP, width=w, joint="curve")
    # end cap
    x, y = coords[-1]
    rad = w + 1
    ld.ellipse((x - rad, y - rad, x + rad, y + rad), fill=UP2)
    img = Image.alpha_composite(img, glow)
    img = Image.alpha_composite(img, layer)
    # apply squircle (already drawn as rounded rect on transparent)
    return img


def ImageChops_and(a, b):
    from PIL import ImageChops
    return ImageChops.multiply(a, b)


def main():
    for n in (192, 512):
        draw_icon(n, False).save(ROOT / f"icon-{n}.png", "PNG")
        draw_icon(n, True).save(ROOT / f"icon-maskable-{n}.png", "PNG")
    draw_icon(180, False).save(ROOT / "apple-touch-icon.png", "PNG")
    # 32 favicon
    draw_icon(32, False).save(ROOT / "favicon-32.png", "PNG")
    print("icons written to", ROOT)


if __name__ == "__main__":
    main()
