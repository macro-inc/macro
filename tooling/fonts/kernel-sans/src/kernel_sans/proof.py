"""Proof images: glyph sheets with metric lines, and shaped text samples."""

import freetype
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

from . import params as P

BG = (255, 255, 255)
INK = (10, 10, 14)
LINE = (120, 170, 255)
BOX = (255, 150, 150)
LABEL = (90, 90, 100)


def _label_font(size=13):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def glyph_sheet(font_path, names, out_png, title="", cell_h=230, cols=10):
    """Grid of glyphs with baseline, x-height, cap height, ascender and
    descender lines (blue) and the advance box (red)."""
    tt = TTFont(font_path)
    order = tt.getGlyphOrder()
    hmtx = tt["hmtx"].metrics
    names = [n for n in names if n in order]
    scale = cell_h / 1300  # px per unit; cell spans 1000 above to 300 below baseline
    face = freetype.Face(font_path)
    face.set_char_size(int(P.UPM * scale * 64), 0, 72, 72)
    widths = [hmtx[n][0] * scale for n in names]
    cell_w = max([cell_h * 0.62] + [w + 30 for w in widths])
    cols = max(1, min(cols, int(1900 // cell_w)))
    rows = (len(names) + cols - 1) // cols
    head = 34 if title else 6
    img = Image.new(
        "RGB", (int(cols * cell_w) + 10, head + rows * (cell_h + 22) + 6), BG
    )
    d = ImageDraw.Draw(img)
    lf = _label_font()
    if title:
        d.text((10, 8), title, fill=INK, font=_label_font(18))
    for i, name in enumerate(names):
        cx = 5 + (i % cols) * cell_w
        cy = head + (i // cols) * (cell_h + 22)
        base = cy + 1000 * scale
        adv = hmtx[name][0] * scale
        x0 = cx + (cell_w - adv) / 2
        for y in (0, P.XH, P.CAP, P.ASC, P.DESC):
            d.line(
                [(cx + 2, base - y * scale), (cx + cell_w - 2, base - y * scale)],
                fill=LINE,
                width=1,
            )
        d.line([(x0, cy + 4), (x0, cy + cell_h - 4)], fill=BOX)
        d.line([(x0 + adv, cy + 4), (x0 + adv, cy + cell_h - 4)], fill=BOX)
        gid = order.index(name)
        face.load_glyph(gid, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
        bm = face.glyph.bitmap
        if bm.width and bm.rows:
            gimg = Image.frombytes("L", (bm.width, bm.rows), bytes(bm.buffer))
            ox = round(x0 + face.glyph.bitmap_left)
            oy = round(base - face.glyph.bitmap_top)
            img.paste(Image.new("RGB", gimg.size, INK), (ox, oy), gimg)
        d.text(
            (cx + 6, cy + cell_h + 2), f"{name}  {hmtx[name][0]}", fill=LABEL, font=lf
        )
    img.save(out_png)
    return out_png


def text_proof(fonts, lines, out_png, size=56, features=None, width=1900):
    """fonts: list of (label, path). Each line is set in every font."""
    lf = _label_font(13)
    rows = []
    for line in lines:
        for label, path in fonts:
            rows.append((label, path, line))
    line_h = int(size * 1.35)
    img = Image.new("RGB", (width, 16 + len(rows) * line_h), BG)
    d = ImageDraw.Draw(img)
    y = 8
    for label, path, line in rows:
        f = ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM)
        d.text((10, y + 2), label, fill=LABEL, font=lf)
        d.text((110, y), line, fill=INK, font=f, features=features)
        y += line_h
    img.save(out_png)
    return out_png
