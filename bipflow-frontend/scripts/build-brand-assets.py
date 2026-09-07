#!/usr/bin/env python3
"""Derive every BipFlow web/PWA/social asset from one official source PNG.

Source of truth: bipflow-frontend/src/assets/brand-source.png
  (the official 1254x1254 RGBA logo -- transparent background, pink "b"
  symbol, dark cart). Geometry is never redrawn: only scaled and padded.

Outputs -> bipflow-frontend/public/brand/  (+ public/favicon.ico)

Run from anywhere:  python bipflow-frontend/scripts/build-brand-assets.py
Idempotent. Requires Pillow.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FRONTEND = Path(__file__).resolve().parent.parent
SOURCE = FRONTEND / "src" / "assets" / "brand-source.png"
BRAND_DIR = FRONTEND / "public" / "brand"
FAVICON_ICO = FRONTEND / "public" / "favicon.ico"

WHITE = (255, 255, 255, 255)
INK = (15, 19, 26, 255)          # matches the dark cart, for the wordmark
BRAND_PINK = (251, 1, 144, 255)  # #FB0190 -- sampled from the symbol body; theme-color

WORDMARK = "Bip Flow"


def load_source() -> Image.Image:
    if not SOURCE.exists():
        sys.exit(
            f"ERROR: {SOURCE.relative_to(FRONTEND)} not found.\n"
            "Save the official 1254x1254 logo PNG there first, then re-run."
        )
    img = Image.open(SOURCE).convert("RGBA")
    w, h = img.size
    if min(w, h) < 512:
        sys.exit(f"ERROR: source is {w}x{h}; need at least 512px on the short side.")
    if abs(w - h) / max(w, h) > 0.02:
        print(f"WARN: source {w}x{h} is not square; padding to a square canvas.")
        side = max(w, h)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.paste(img, ((side - w) // 2, (side - h) // 2), img)
        img = square
    return img


def trim(img: Image.Image, pad_ratio: float = 0.0) -> Image.Image:
    """Crop fully-transparent margins, then optionally re-pad by a ratio of the
    trimmed size so the mark keeps a little breathing room."""
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    core = img.crop(bbox)
    if pad_ratio <= 0:
        return core
    cw, ch = core.size
    pad = int(round(max(cw, ch) * pad_ratio))
    side = max(cw, ch) + 2 * pad
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(core, ((side - cw) // 2, (side - ch) // 2), core)
    return canvas


def fit(mark: Image.Image, box: int, scale: float) -> Image.Image:
    """Scale `mark` so its long edge is `scale*box`, centered on a `box` canvas."""
    mw, mh = mark.size
    target = int(round(box * scale))
    ratio = target / max(mw, mh)
    resized = mark.resize((max(1, round(mw * ratio)), max(1, round(mh * ratio))), Image.LANCZOS)
    canvas = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    rw, rh = resized.size
    canvas.paste(resized, ((box - rw) // 2, (box - rh) // 2), resized)
    return canvas


def on_bg(rgba: Image.Image, bg: tuple[int, int, int, int]) -> Image.Image:
    base = Image.new("RGBA", rgba.size, bg)
    base.alpha_composite(rgba)
    return base.convert("RGB")


_FONT_CANDIDATES = (
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/calibrib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
)


def load_font(size: int):
    for path in _FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    try:
        # Pillow >= 10.1 scales the built-in font; keeps the wordmark legible
        # on machines with none of the fonts above (CI, minimal Linux).
        return ImageFont.load_default(size=size)
    except TypeError:
        sys.exit(
            "ERROR: no bundled TrueType font found and this Pillow cannot size "
            "the default font. Install DejaVu/Liberation or upgrade Pillow."
        )


def save_png(img: Image.Image, name: str) -> None:
    out = BRAND_DIR / name
    img.save(out, "PNG", optimize=True)
    kb = out.stat().st_size / 1024
    print(f"  {name:32s} {img.size[0]}x{img.size[1]:<5} {kb:6.1f} KB")


def build_og(mark_trim: Image.Image) -> None:
    """1200x630 (~1.91:1) share card: symbol + wordmark, centered, on white,
    generous margins, no heavy effects."""
    W, H = 1200, 630
    card = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(card)

    mark_h = 344
    mw, mh = mark_trim.size
    mark = mark_trim.resize((round(mw * mark_h / mh), mark_h), Image.LANCZOS)

    word_font = load_font(82)
    tagline_font = load_font(33)
    tagline = "Gestão multiloja e vitrine digital"

    def measure(text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int, int]:
        box = draw.textbbox((0, 0), text, font=font)
        return box[2] - box[0], box[3] - box[1], box[1]  # w, h, top-inset

    ww, wh, wtop = measure(WORDMARK, word_font)
    tgw, tgh, tgtop = measure(tagline, tagline_font)

    gap_mark_word = 22
    gap_word_tag = 16
    block_h = mark_h + gap_mark_word + wh + gap_word_tag + tgh
    top = (H - block_h) // 2 - 8  # nudge up: text-heavy blocks read better high

    card.paste(mark, ((W - mark.size[0]) // 2, top), mark)
    y = top + mark_h + gap_mark_word
    draw.text(((W - ww) / 2, y - wtop), WORDMARK, font=word_font, fill=INK)
    y += wh + gap_word_tag
    draw.text(((W - tgw) / 2, y - tgtop), tagline, font=tagline_font, fill=(96, 104, 116))

    out = BRAND_DIR / "bipflow-og.png"
    card.save(out, "PNG", optimize=True)
    kb = out.stat().st_size / 1024
    print(f"  {'bipflow-og.png':32s} {W}x{H:<5} {kb:6.1f} KB")
    if kb > 5 * 1024:
        sys.exit("ERROR: og image exceeds 5 MB")

    # thumbnail sanity render (LinkedIn shrinks it a lot) -- QA only, kept out
    # of public/ so it never ships or gets committed.
    qa = FRONTEND / "scripts" / ".qa"
    qa.mkdir(exist_ok=True)
    card.resize((320, 168), Image.LANCZOS).save(qa / "bipflow-og.thumb.png", "PNG")
    print(f"  (qa) scripts/.qa/bipflow-og.thumb.png  320x168")


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    src = load_source()
    mark = trim(src)  # tight bounding box of the symbol

    print(f"source: {SOURCE.relative_to(FRONTEND)}  {src.size[0]}x{src.size[1]}")
    print(f"trimmed mark: {mark.size[0]}x{mark.size[1]}")
    print("writing public/brand/ ...")

    # Full logo (transparent) -- 1024 canvas, mark at 92%
    save_png(fit(mark, 1024, 0.92), "bipflow-logo.png")

    # Favicons -- symbol only, small margin, transparent
    for size in (16, 32):
        save_png(fit(mark, size, 0.90), f"favicon-{size}x{size}.png")

    # PWA icons -- transparent "any", plus a maskable with safe-area padding
    save_png(fit(mark, 192, 0.86), "icon-192x192.png")
    save_png(fit(mark, 512, 0.86), "icon-512x512.png")
    save_png(on_bg(fit(mark, 512, 0.62), WHITE).convert("RGBA"), "icon-512x512-maskable.png")

    # Apple touch icon -- Apple ignores transparency, so composite on white
    save_png(on_bg(fit(mark, 180, 0.80), WHITE).convert("RGBA"), "apple-touch-icon.png")

    # favicon.ico -- multi-resolution, symbol on white for legacy tabs
    ico_src = on_bg(fit(mark, 256, 0.88), WHITE)
    ico_src.save(FAVICON_ICO, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {'../favicon.ico':32s} 16/32/48    {FAVICON_ICO.stat().st_size/1024:6.1f} KB")

    build_og(trim(src))
    print("done.")


if __name__ == "__main__":
    main()
