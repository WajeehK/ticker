#!/usr/bin/env python3
"""Original circular asset marks for commodities, indices and FX pairs.

Drawn as local SVGs (full-bleed 256×256, clipped to a circle in the app).
No third-party trademarks are copied. See SOURCES.md.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "img"
COM = IMG / "commodities"
IDX = IMG / "indices"
FXD = IMG / "fx"

SRC = "Original circular mark drawn for Ticker (this repo)"


def svg(body: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">\n'
        f"{body}\n</svg>\n"
    ).encode("utf-8")


def wrap(inner: str, defs: str = "") -> str:
    return f"""  <defs>
    <clipPath id="c"><rect width="256" height="256"/></clipPath>
    {defs}
  </defs>
  <g clip-path="url(#c)">
{inner}
  </g>"""


# --- Commodities -----------------------------------------------------------

GOLD = wrap(
    """    <rect width="256" height="256" fill="#8A5A00"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,138)">
      <path d="M-78 22 L-62 -28 L62 -28 L78 22 Z" fill="#C9972A"/>
      <path d="M-62 -28 L-48 -52 L48 -52 L62 -28 Z" fill="#E8C35A"/>
      <path d="M48 -52 L62 -28 L78 22 L62 22 L48 -52 Z" fill="#A67512"/>
      <path d="M-78 22 L-62 -28 L-48 -52 L-62 22 Z" fill="#F3D98A" opacity=".85"/>
      <path d="M-52 6 L-40 -22 L40 -22 L52 6 Z" fill="#F6E3A1"/>
      <path d="M-40 -22 L-30 -38 L30 -38 L40 -22 Z" fill="#FFF0BE"/>
      <path d="M30 -38 L40 -22 L52 6 L40 6 Z" fill="#C9972A"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="35%" r="70%"><stop offset="0%" stop-color="#C9891A"/><stop offset="100%" stop-color="#6B4500"/></radialGradient>',
)

SILVER = wrap(
    """    <rect width="256" height="256" fill="#6D7680"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,138)">
      <path d="M-78 22 L-62 -28 L62 -28 L78 22 Z" fill="#9AA3AD"/>
      <path d="M-62 -28 L-48 -52 L48 -52 L62 -28 Z" fill="#D5DBE1"/>
      <path d="M48 -52 L62 -28 L78 22 L62 22 L48 -52 Z" fill="#7B848E"/>
      <path d="M-78 22 L-62 -28 L-48 -52 L-62 22 Z" fill="#F2F5F7" opacity=".9"/>
      <path d="M-52 6 L-40 -22 L40 -22 L52 6 Z" fill="#E8EDF1"/>
      <path d="M-40 -22 L-30 -38 L30 -38 L40 -22 Z" fill="#FFFFFF"/>
      <path d="M30 -38 L40 -22 L52 6 L40 6 Z" fill="#9AA3AD"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="35%" r="70%"><stop offset="0%" stop-color="#A8B0B8"/><stop offset="100%" stop-color="#4E575F"/></radialGradient>',
)

WTI = wrap(
    """    <rect width="256" height="256" fill="#1A140E"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,148)">
      <path d="M0 -100 C-18 -78 -22 -60 0 -42 C22 -60 18 -78 0 -100Z" fill="#F5C542"/>
      <path d="M0 -90 C-8 -78 -10 -68 0 -58 C8 -68 6 -78 0 -90Z" fill="#FFF0B0" opacity=".8"/>
      <rect x="-50" y="-48" width="100" height="104" fill="url(#bar)"/>
      <ellipse cx="0" cy="-48" rx="50" ry="18" fill="url(#lid)"/>
      <ellipse cx="0" cy="56" rx="50" ry="18" fill="#16120E"/>
      <rect x="-50" y="38" width="100" height="18" fill="#16120E"/>
      <rect x="-54" y="-22" width="108" height="11" rx="2" fill="#C9972A"/>
      <rect x="-54" y="12" width="108" height="11" rx="2" fill="#C9972A"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#3A2E20"/><stop offset="100%" stop-color="#120E0A"/></radialGradient>'
    '<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#1A1612"/><stop offset="28%" stop-color="#6A5A44"/><stop offset="100%" stop-color="#2A241C"/></linearGradient>'
    '<radialGradient id="lid" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#7A6A54"/><stop offset="100%" stop-color="#2A241C"/></radialGradient>',
)

BRENT = wrap(
    """    <rect width="256" height="256" fill="#0E1A24"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,150)">
      <rect x="-46" y="-58" width="92" height="100" rx="8" fill="#163044"/>
      <rect x="-46" y="-58" width="92" height="100" rx="8" fill="url(#bar)"/>
      <ellipse cx="0" cy="-58" rx="46" ry="16" fill="#1C3A52"/>
      <ellipse cx="0" cy="-58" rx="46" ry="16" fill="url(#lid)"/>
      <ellipse cx="0" cy="42" rx="46" ry="16" fill="#0A1822"/>
      <rect x="-46" y="26" width="92" height="16" fill="#0A1822"/>
      <path d="M0 -88 C-18 -70 -22 -50 0 -28 C22 -50 18 -70 0 -88Z" fill="#2EC4B6"/>
      <path d="M0 -78 C-8 -68 -10 -56 0 -44 C6 -56 8 -68 0 -78Z" fill="#B8FFF6" opacity=".7"/>
      <rect x="-50" y="-18" width="100" height="14" rx="2" fill="#2EC4B6" opacity=".85"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="30%" r="75%"><stop offset="0%" stop-color="#1C3A52"/><stop offset="100%" stop-color="#0A1520"/></radialGradient>'
    '<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0A1822"/><stop offset="35%" stop-color="#2A5570"/><stop offset="100%" stop-color="#163044"/></linearGradient>'
    '<radialGradient id="lid" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#4A7A96"/><stop offset="100%" stop-color="#163044"/></radialGradient>',
)

GAS = wrap(
    """    <rect width="256" height="256" fill="#14233A"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,150)">
      <path d="M0 -96 C-8 -70 -40 -48 -40 -10 C-40 28 -22 52 0 52 C22 52 40 28 40 -10 C40 -48 8 -70 0 -96Z" fill="#FF8A00"/>
      <path d="M0 -96 C-8 -70 -40 -48 -40 -10 C-40 28 -22 52 0 52 C22 52 40 28 40 -10 C40 -48 8 -70 0 -96Z" fill="url(#fl)"/>
      <path d="M0 -70 C-4 -54 -22 -40 -22 -12 C-22 16 -10 32 0 32 C10 32 22 16 22 -12 C22 -40 4 -54 0 -70Z" fill="url(#in)"/>
      <path d="M0 -48 C-2 -38 -10 -30 -10 -14 C-10 2 -4 12 0 12 C4 12 10 2 10 -14 C10 -30 2 -38 0 -48Z" fill="#FFF4C2"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#1E3A5F"/><stop offset="100%" stop-color="#0B1726"/></radialGradient>'
    '<radialGradient id="fl" cx="50%" cy="80%" r="70%"><stop offset="0%" stop-color="#FFB000"/><stop offset="55%" stop-color="#FF6A00"/><stop offset="100%" stop-color="#C02400"/></radialGradient>'
    '<radialGradient id="in" cx="50%" cy="80%" r="70%"><stop offset="0%" stop-color="#FFE27A"/><stop offset="100%" stop-color="#FF8A00"/></radialGradient>',
)

COPPER = wrap(
    """    <rect width="256" height="256" fill="#6A3110"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,132)" fill="none" stroke-linecap="round">
      <path d="M-64 -8 C-64 -40 64 -40 64 -8 C64 16 -64 16 -64 -8 C-64 -40 64 -40 64 -8" stroke="#8C4A22" stroke-width="22"/>
      <path d="M-64 10 C-64 -22 64 -22 64 10 C64 34 -64 34 -64 10 C-64 -22 64 -22 64 10" stroke="#B35C28" stroke-width="22"/>
      <path d="M-64 28 C-64 -4 64 -4 64 28 C64 52 -64 52 -64 28 C-64 -4 64 -4 64 28" stroke="#D4783C" stroke-width="22"/>
      <path d="M-64 46 C-64 14 64 14 64 46" stroke="#E8A868" stroke-width="22"/>
      <path d="M-64 -8 C-64 -40 64 -40 64 -8 C64 16 -64 16 -64 -8 C-64 -40 64 -40 64 -8" stroke="#F0B078" stroke-width="8"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="35%" r="70%"><stop offset="0%" stop-color="#C46A2E"/><stop offset="100%" stop-color="#5A280E"/></radialGradient>',
)

PLATINUM = wrap(
    """    <rect width="256" height="256" fill="#3E4650"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,140)">
      <path d="M-72 28 L-56 -36 L56 -36 L72 28 Z" fill="#9AA4B0"/>
      <path d="M-56 -36 L-40 -64 L40 -64 L56 -36 Z" fill="#E6EBF0"/>
      <path d="M40 -64 L56 -36 L72 28 L56 28 Z" fill="#6E7884"/>
      <path d="M-72 28 L-56 -36 L-40 -64 L-56 28 Z" fill="#FFFFFF" opacity=".95"/>
      <path d="M-28 -8 L-18 -28 L18 -28 L28 -8 Z" fill="#F7FAFC"/>
      <path d="M-18 -28 L-10 -42 L10 -42 L18 -28 Z" fill="#FFFFFF"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="32%" r="70%"><stop offset="0%" stop-color="#8A949E"/><stop offset="100%" stop-color="#2C343C"/></radialGradient>',
)

PALLADIUM = wrap(
    """    <rect width="256" height="256" fill="#4A4038"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <g transform="translate(128,140)">
      <path d="M-72 28 L-56 -36 L56 -36 L72 28 Z" fill="#B8A898"/>
      <path d="M-56 -36 L-40 -64 L40 -64 L56 -36 Z" fill="#EDE4D8"/>
      <path d="M40 -64 L56 -36 L72 28 L56 28 Z" fill="#8A7A6A"/>
      <path d="M-72 28 L-56 -36 L-40 -64 L-56 28 Z" fill="#FFF8F0" opacity=".95"/>
      <path d="M-28 -8 L-18 -28 L18 -28 L28 -8 Z" fill="#F6EEE4"/>
      <path d="M-18 -28 L-10 -42 L10 -42 L18 -28 Z" fill="#FFFBF6"/>
    </g>""",
    defs='<radialGradient id="bg" cx="50%" cy="32%" r="70%"><stop offset="0%" stop-color="#A09080"/><stop offset="100%" stop-color="#3A322C"/></radialGradient>',
)

COMMODITIES = {
    "GC=F": ("gold.svg", GOLD, "Gold"),
    "SI=F": ("silver.svg", SILVER, "Silver"),
    "CL=F": ("wti.svg", WTI, "Crude oil (WTI)"),
    "BZ=F": ("brent.svg", BRENT, "Brent crude"),
    "NG=F": ("gas.svg", GAS, "Natural gas"),
    "HG=F": ("copper.svg", COPPER, "Copper"),
    "PL=F": ("platinum.svg", PLATINUM, "Platinum"),
    "PA=F": ("palladium.svg", PALLADIUM, "Palladium"),
}


# --- Flags (building blocks) ----------------------------------------------

def us_flag(ox=0, oy=0, w=256, h=256) -> str:
    stripe_h = h / 13
    parts = [f'<g transform="translate({ox},{oy})">']
    for i in range(13):
        color = "#B22234" if i % 2 == 0 else "#FFFFFF"
        parts.append(f'<rect y="{i*stripe_h:.3f}" width="{w}" height="{stripe_h+0.4:.3f}" fill="{color}"/>')
    cw, ch = w * 0.40, stripe_h * 7
    parts.append(f'<rect width="{cw}" height="{ch}" fill="#3C3B6E"/>')
    # 9×11 staggered star grid, simplified as small diamonds (read clearly at 28–40px)
    rows, cols_even, cols_odd = 9, 6, 5
    for r in range(rows):
        cols = cols_even if r % 2 == 0 else cols_odd
        for c in range(cols):
            x = cw * ((c + 1) / (cols + 1) if r % 2 else (c + 0.5) / cols)
            y = ch * (r + 0.5) / rows
            parts.append(f'<path d="M{x:.1f} {y-3.2:.1f} L{x+1.8:.1f} {y-0.6:.1f} L{x+3.4:.1f} {y-0.6:.1f} L{x+2.0:.1f} {y+0.8:.1f} L{x+2.6:.1f} {y+3.2:.1f} L{x:.1f} {y+1.6:.1f} L{x-2.6:.1f} {y+3.2:.1f} L{x-2.0:.1f} {y+0.8:.1f} L{x-3.4:.1f} {y-0.6:.1f} L{x-1.8:.1f} {y-0.6:.1f} Z" fill="#FFFFFF"/>')
    parts.append("</g>")
    return "\n".join(parts)


def union_jack(ox=0, oy=0, w=256, h=256) -> str:
    # Geometric Union Jack, full-bleed, then clipped by parent.
    return f'''<g transform="translate({ox},{oy})">
      <rect width="{w}" height="{h}" fill="#012169"/>
      <g transform="translate({w/2},{h/2}) scale({w/256},{h/256})">
        <path d="M-128 -128 L128 128" stroke="#FFF" stroke-width="40"/>
        <path d="M128 -128 L-128 128" stroke="#FFF" stroke-width="40"/>
        <path d="M-128 -128 L128 128" stroke="#C8102E" stroke-width="16"/>
        <path d="M128 -128 L-128 128" stroke="#C8102E" stroke-width="16"/>
        <!-- St George's cross -->
        <rect x="-128" y="-24" width="256" height="48" fill="#FFF"/>
        <rect x="-24" y="-128" width="48" height="256" fill="#FFF"/>
        <rect x="-128" y="-14" width="256" height="28" fill="#C8102E"/>
        <rect x="-14" y="-128" width="28" height="256" fill="#C8102E"/>
      </g>
    </g>'''


def eu_flag(ox=0, oy=0, w=256, h=256) -> str:
    stars = []
    import math
    cx, cy, r = w / 2, h / 2, min(w, h) * 0.32
    for i in range(12):
        ang = math.radians(-90 + i * 30)
        x, y = cx + r * math.cos(ang), cy + r * math.sin(ang)
        stars.append(f'<path transform="translate({x:.1f},{y:.1f})" d="M0 -7 L1.6 -2.2 L7 -2.2 L2.6 1 L4.2 6.2 L0 3 L-4.2 6.2 L-2.6 1 L-7 -2.2 L-1.6 -2.2 Z" fill="#FFCC00"/>')
    return f'<g transform="translate({ox},{oy})"><rect width="{w}" height="{h}" fill="#003399"/>{"".join(stars)}</g>'


# S&P 500: navy field, gold rising bars, ring of stars — an index mark, not letters.
SP500 = wrap(
    f"""    <rect width="256" height="256" fill="#0A1630"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <!-- star ring -->
    <g fill="#F5D76E">
      <g transform="translate(128,128)">
        <g transform="rotate(0) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
        <g transform="rotate(45) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
        <g transform="rotate(90) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
        <g transform="rotate(135) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
        <g transform="rotate(180) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
        <g transform="rotate(225) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
        <g transform="rotate(270) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
        <g transform="rotate(315) translate(0,-96)"><path d="M0 -6 L1.8 -1.8 L6.5 -1.8 L2.6 1 L4 5.6 L0 2.8 L-4 5.6 L-2.6 1 L-6.5 -1.8 L-1.8 -1.8 Z"/></g>
      </g>
    </g>
    <!-- rising bars -->
    <rect x="70" y="132" width="28" height="52" rx="4" fill="#F5D76E"/>
    <rect x="114" y="108" width="28" height="76" rx="4" fill="#FFE9A0"/>
    <rect x="158" y="80" width="28" height="104" rx="4" fill="#FFF6D0"/>
""",
    defs='<radialGradient id="bg" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#163060"/><stop offset="100%" stop-color="#071020"/></radialGradient>',
)

# Nasdaq: teal field, original double-arch gateway (not the wordmark).
NASDAQ = wrap(
    """    <rect width="256" height="256" fill="#003A5D"/>
    <rect width="256" height="256" fill="url(#bg)"/>
    <path d="M48 176 C48 96 88 52 128 52 C168 52 208 96 208 176" fill="none" stroke="#7FE3FF" stroke-width="18" stroke-linecap="round"/>
    <path d="M76 176 C76 114 100 80 128 80 C156 80 180 114 180 176" fill="none" stroke="#E6FBFF" stroke-width="14" stroke-linecap="round"/>
    <circle cx="128" cy="176" r="8" fill="#7FE3FF"/>
""",
    defs='<radialGradient id="bg" cx="50%" cy="35%" r="70%"><stop offset="0%" stop-color="#02608F"/><stop offset="100%" stop-color="#00283F"/></radialGradient>',
)

# Dow: dark field, US-stripe base, gold pyramid — industrial / average mark.
DOW = wrap(
    """    <rect width="256" height="256" fill="#101418"/>
    <rect y="150" width="256" height="16" fill="#B22234"/>
    <rect y="166" width="256" height="16" fill="#FFFFFF"/>
    <rect y="182" width="256" height="16" fill="#B22234"/>
    <rect y="198" width="256" height="16" fill="#FFFFFF"/>
    <rect y="214" width="256" height="16" fill="#B22234"/>
    <rect y="230" width="256" height="26" fill="#FFFFFF"/>
    <rect width="256" height="150" fill="url(#bg)"/>
    <path d="M128 46 L198 150 H58 Z" fill="#F5D76E"/>
    <path d="M128 46 L198 150 H128 Z" fill="#C9A227"/>
    <path d="M128 70 L172 138 H84 Z" fill="#101418"/>
""",
    defs='<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1C2834"/><stop offset="100%" stop-color="#101418"/></linearGradient>',
)

FTSE = wrap(
    union_jack(0, 0, 256, 256)
)

INDICES = {
    "^GSPC": ("sp500.svg", SP500, "S&P 500"),
    "^IXIC": ("nasdaq.svg", NASDAQ, "NASDAQ Composite"),
    "^DJI": ("dow.svg", DOW, "Dow Jones Industrial Average"),
    "^FTSE": ("ftse.svg", FTSE, "FTSE 100"),
}


def fx_split(left: str, right: str) -> str:
    return wrap(
        f"""    {left}
    {right}
    <rect x="126" y="0" width="4" height="256" fill="rgba(255,255,255,.85)"/>
"""
    )


GBPUSD = fx_split(union_jack(0, 0, 128, 256), us_flag(128, 0, 128, 256))
EURUSD = fx_split(eu_flag(0, 0, 128, 256), us_flag(128, 0, 128, 256))

FX = {
    "GBPUSD=X": ("gbpusd.svg", GBPUSD, "GBP/USD"),
    "EURUSD=X": ("eurusd.svg", EURUSD, "EUR/USD"),
}


def rec(src: str, kind: str) -> dict:
    return {"src": src, "kind": kind, "chip": False, "source": SRC}


def apply(manifest: dict) -> dict:
    COM.mkdir(parents=True, exist_ok=True)
    IDX.mkdir(parents=True, exist_ok=True)
    FXD.mkdir(parents=True, exist_ok=True)
    for sid, (name, body, _label) in COMMODITIES.items():
        (COM / name).write_bytes(svg(body))
        manifest[sid] = rec(f"img/commodities/{name}", "commodity")
        print(f"  commodity {sid} -> {name}")
    for sid, (name, body, _label) in INDICES.items():
        (IDX / name).write_bytes(svg(body))
        manifest[sid] = rec(f"img/indices/{name}", "index")
        print(f"  index {sid} -> {name}")
    for sid, (name, body, _label) in FX.items():
        (FXD / name).write_bytes(svg(body))
        manifest[sid] = rec(f"img/fx/{name}", "fx")
        print(f"  fx {sid} -> {name}")
    return manifest


def main() -> int:
    man_path = IMG / "manifest.json"
    manifest = json.loads(man_path.read_text()) if man_path.exists() else {}
    apply(manifest)
    man_path.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"Wrote {man_path} ({len(manifest)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
