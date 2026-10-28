"""Deterministic media for the generated corpus: raster images, EMF, WMF and SVG.

Everything here is built from code (no external tools, no fonts), so regenerating
the corpus produces byte-identical media. The metafile writers emit a deliberately
broad mix of record types so a renderer exercising them has something to chew on:

* EMF (MS-EMF): anisotropic mapping, pens/brushes (solid, null, hatched), fonts
  (EXTCREATEFONTINDIRECTW + EXTTEXTOUTW with DX arrays, rotated text), rectangles,
  round rects, ellipses, pie/chord/arc, POLYGON16/POLYLINE16/POLYBEZIER16,
  POLYPOLYGON16, paths (BEGINPATH..STROKEANDFILLPATH), GRADIENTFILL (rect and
  triangle), world transforms, SAVEDC/RESTOREDC, clipping and STRETCHDIBITS.
* WMF (MS-WMF) with a placeable (APM) header: window org/ext, pens, brushes,
  fonts, rectangles, round rects, ellipses, pie, polygons, polylines, TEXTOUT and
  EXTTEXTOUT.
"""

from __future__ import annotations

import io
import math
import struct
import zlib

from PIL import Image, ImageDraw

# Helvetica/Arial advance widths (1/1000 em) for ASCII 32..126. Liberation Sans and
# Arial share these metrics, so DX arrays built from them look right everywhere.
_ARIAL_WIDTHS = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]


def text_advances(text: str, em: float) -> list[int]:
    out = []
    for ch in text:
        o = ord(ch)
        w = _ARIAL_WIDTHS[o - 32] if 32 <= o <= 126 else 556
        out.append(int(round(w * em / 1000.0)))
    return out


def colorref(rgb: int) -> int:
    """0xRRGGBB -> COLORREF (0x00BBGGRR)."""
    r, g, b = (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF
    return r | (g << 8) | (b << 16)


# ---------------------------------------------------------------------------
# EMF
# ---------------------------------------------------------------------------

EMR = {
    "HEADER": 1, "POLYBEZIER": 2, "EOF": 14, "SETWINDOWEXTEX": 9, "SETWINDOWORGEX": 10,
    "SETVIEWPORTEXTEX": 11, "SETVIEWPORTORGEX": 12, "SETMAPMODE": 17, "SETBKMODE": 18,
    "SETPOLYFILLMODE": 19, "SETTEXTALIGN": 22, "SETTEXTCOLOR": 24, "SETBKCOLOR": 25,
    "MOVETOEX": 27, "INTERSECTCLIPRECT": 30, "SAVEDC": 33, "RESTOREDC": 34,
    "SETWORLDTRANSFORM": 35, "MODIFYWORLDTRANSFORM": 36, "SELECTOBJECT": 37,
    "CREATEPEN": 38, "CREATEBRUSHINDIRECT": 39, "DELETEOBJECT": 40, "ELLIPSE": 42,
    "RECTANGLE": 43, "ROUNDRECT": 44, "ARC": 45, "CHORD": 46, "PIE": 47, "LINETO": 54,
    "BEGINPATH": 59, "ENDPATH": 60, "CLOSEFIGURE": 61, "FILLPATH": 62,
    "STROKEANDFILLPATH": 63, "STROKEPATH": 64, "STRETCHDIBITS": 81,
    "EXTCREATEFONTINDIRECTW": 82, "EXTTEXTOUTW": 84, "POLYBEZIER16": 85,
    "POLYGON16": 86, "POLYLINE16": 87, "POLYBEZIERTO16": 88, "POLYLINETO16": 89,
    "POLYPOLYGON16": 91, "GRADIENTFILL": 118,
}

NULL_BRUSH = 0x80000005
NULL_PEN = 0x80000008
WHITE_BRUSH = 0x80000000
BLACK_PEN = 0x80000007

PS_SOLID, PS_DASH, PS_DOT, PS_DASHDOT = 0, 1, 2, 3
BS_SOLID, BS_NULL, BS_HATCHED = 0, 1, 2
HS_HORIZONTAL, HS_VERTICAL, HS_FDIAGONAL, HS_BDIAGONAL, HS_CROSS, HS_DIAGCROSS = range(6)
TA_LEFT, TA_RIGHT, TA_CENTER = 0, 2, 6
TA_TOP, TA_BOTTOM, TA_BASELINE = 0, 8, 24


class EmfWriter:
    """Tiny MS-EMF writer. Coordinates are logical units under MM_ANISOTROPIC."""

    def __init__(self, width_px: int, height_px: int, scale: int = 10):
        self.w, self.h, self.scale = width_px, height_px, scale
        self.records: list[bytes] = []
        self._handles: list[int] = []  # allocated handle indexes
        self._max_handle = 0
        self.set_map_mode(8)  # MM_ANISOTROPIC
        self._rec("SETWINDOWORGEX", struct.pack("<ii", 0, 0))
        self._rec("SETWINDOWEXTEX", struct.pack("<ii", width_px * scale, height_px * scale))
        self._rec("SETVIEWPORTORGEX", struct.pack("<ii", 0, 0))
        self._rec("SETVIEWPORTEXTEX", struct.pack("<ii", width_px, height_px))
        self._rec("SETBKMODE", struct.pack("<I", 1))  # TRANSPARENT

    # -- plumbing -----------------------------------------------------------
    def _rec(self, name: str, payload: bytes = b"") -> None:
        size = 8 + len(payload)
        assert size % 4 == 0, (name, size)
        self.records.append(struct.pack("<II", EMR[name], size) + payload)

    def _alloc(self) -> int:
        ih = 1
        while ih in self._handles:
            ih += 1
        self._handles.append(ih)
        self._max_handle = max(self._max_handle, ih)
        return ih

    @staticmethod
    def _bounds(points) -> bytes:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return struct.pack("<iiii", min(xs), min(ys), max(xs), max(ys))

    # -- state --------------------------------------------------------------
    def set_map_mode(self, mode: int) -> None:
        self._rec("SETMAPMODE", struct.pack("<I", mode))

    def pen(self, rgb: int, width: int = 0, style: int = PS_SOLID) -> int:
        ih = self._alloc()
        self._rec("CREATEPEN", struct.pack("<IIiiI", ih, style, width, 0, colorref(rgb)))
        return ih

    def brush(self, rgb: int, style: int = BS_SOLID, hatch: int = 0) -> int:
        ih = self._alloc()
        self._rec("CREATEBRUSHINDIRECT", struct.pack("<IIII", ih, style, colorref(rgb), hatch))
        return ih

    def font(self, height: int, face: str = "Arial", weight: int = 400, italic: bool = False,
             underline: bool = False, escapement: int = 0) -> int:
        ih = self._alloc()
        face_b = face.encode("utf-16-le")[:62]
        face_b = face_b + b"\x00" * (64 - len(face_b))
        logfont = struct.pack(
            "<iiiiiBBBBBBBB", -abs(height), 0, escapement, escapement, weight,
            1 if italic else 0, 1 if underline else 0, 0, 1, 0, 0, 4, 0,
        ) + face_b
        assert len(logfont) == 92
        self._rec("EXTCREATEFONTINDIRECTW", struct.pack("<I", ih) + logfont)
        return ih

    def select(self, ih: int) -> None:
        self._rec("SELECTOBJECT", struct.pack("<I", ih))

    def delete(self, ih: int) -> None:
        self._rec("DELETEOBJECT", struct.pack("<I", ih))
        self._handles.remove(ih)

    def text_color(self, rgb: int) -> None:
        self._rec("SETTEXTCOLOR", struct.pack("<I", colorref(rgb)))

    def text_align(self, mode: int) -> None:
        self._rec("SETTEXTALIGN", struct.pack("<I", mode))

    def poly_fill_mode(self, mode: int) -> None:
        self._rec("SETPOLYFILLMODE", struct.pack("<I", mode))

    def save_dc(self) -> None:
        self._rec("SAVEDC")

    def restore_dc(self) -> None:
        self._rec("RESTOREDC", struct.pack("<i", -1))

    def world_transform(self, m11, m12, m21, m22, dx, dy, mode: int | None = None) -> None:
        xf = struct.pack("<ffffff", m11, m12, m21, m22, dx, dy)
        if mode is None:
            self._rec("SETWORLDTRANSFORM", xf)
        else:
            self._rec("MODIFYWORLDTRANSFORM", xf + struct.pack("<I", mode))

    def clip_rect(self, l, t, r, b) -> None:
        self._rec("INTERSECTCLIPRECT", struct.pack("<iiii", l, t, r, b))

    # -- drawing ------------------------------------------------------------
    def rect(self, l, t, r, b) -> None:
        self._rec("RECTANGLE", struct.pack("<iiii", l, t, r, b))

    def round_rect(self, l, t, r, b, cw, ch) -> None:
        self._rec("ROUNDRECT", struct.pack("<iiiiii", l, t, r, b, cw, ch))

    def ellipse(self, l, t, r, b) -> None:
        self._rec("ELLIPSE", struct.pack("<iiii", l, t, r, b))

    def _arcish(self, name, l, t, r, b, x1, y1, x2, y2) -> None:
        self._rec(name, struct.pack("<iiiiiiii", l, t, r, b, x1, y1, x2, y2))

    def pie(self, *a) -> None:
        self._arcish("PIE", *a)

    def chord(self, *a) -> None:
        self._arcish("CHORD", *a)

    def arc(self, *a) -> None:
        self._arcish("ARC", *a)

    def move_to(self, x, y) -> None:
        self._rec("MOVETOEX", struct.pack("<ii", x, y))

    def line_to(self, x, y) -> None:
        self._rec("LINETO", struct.pack("<ii", x, y))

    def _poly16(self, name, points) -> None:
        pts = b"".join(struct.pack("<hh", x, y) for x, y in points)
        self._rec(name, self._bounds(points) + struct.pack("<I", len(points)) + pts)

    def polygon(self, points) -> None:
        self._poly16("POLYGON16", points)

    def polyline(self, points) -> None:
        self._poly16("POLYLINE16", points)

    def polybezier(self, points) -> None:
        assert (len(points) - 1) % 3 == 0
        self._poly16("POLYBEZIER16", points)

    def polybezier_to(self, points) -> None:
        self._poly16("POLYBEZIERTO16", points)

    def polyline_to(self, points) -> None:
        self._poly16("POLYLINETO16", points)

    def polypolygon(self, polys) -> None:
        allpts = [p for poly in polys for p in poly]
        payload = self._bounds(allpts) + struct.pack("<II", len(polys), len(allpts))
        payload += b"".join(struct.pack("<I", len(poly)) for poly in polys)
        payload += b"".join(struct.pack("<hh", x, y) for x, y in allpts)
        if len(payload) % 4:
            payload += b"\x00" * (4 - len(payload) % 4)
        self._rec("POLYPOLYGON16", payload)

    def begin_path(self) -> None:
        self._rec("BEGINPATH")

    def end_path(self) -> None:
        self._rec("ENDPATH")

    def close_figure(self) -> None:
        self._rec("CLOSEFIGURE")

    def stroke_and_fill_path(self) -> None:
        self._rec("STROKEANDFILLPATH", struct.pack("<iiii", 0, 0, -1, -1))

    def fill_path(self) -> None:
        self._rec("FILLPATH", struct.pack("<iiii", 0, 0, -1, -1))

    def text(self, x, y, s: str, em: int) -> None:
        """EXTTEXTOUTW with a DX array computed from Arial metrics."""
        n = len(s)
        string = s.encode("utf-16-le")
        if len(string) % 4:
            string += b"\x00" * (4 - len(string) % 4)
        off_string = 8 + 16 + 4 + 8 + 40
        off_dx = off_string + len(string)
        dx = b"".join(struct.pack("<i", a) for a in text_advances(s, em))
        scale = 100.0 * 25.4 / 96.0 / self.scale  # logical units -> 0.01 mm
        payload = struct.pack("<iiii", 0, 0, -1, -1)  # bounds: not computed
        payload += struct.pack("<Iff", 1, scale, scale)  # GM_COMPATIBLE
        payload += struct.pack("<iiIII", x, y, n, off_string, 0)  # ref, nChars, offString, options
        payload += struct.pack("<iiii", 0, 0, 0, 0)  # rectangle (unused)
        payload += struct.pack("<I", off_dx)
        payload += string + dx
        self._rec("EXTTEXTOUTW", payload)

    def gradient_rect(self, l, t, r, b, c1: int, c2: int, vertical: bool = False) -> None:
        def vert(x, y, rgb):
            return struct.pack("<iiHHHH", x, y, ((rgb >> 16) & 0xFF) << 8, ((rgb >> 8) & 0xFF) << 8, (rgb & 0xFF) << 8, 0)

        payload = struct.pack("<iiii", l, t, r, b) + struct.pack("<III", 2, 1, 1 if vertical else 0)
        # GradientRectangle (8 bytes) + VertexPadding (4 bytes per rectangle, MS-EMF 2.3.5.12).
        payload += vert(l, t, c1) + vert(r, b, c2) + struct.pack("<II", 0, 1) + b"\x00" * 4
        self._rec("GRADIENTFILL", payload)

    def gradient_triangle(self, p1, p2, p3) -> None:
        """p = (x, y, rgb)"""
        pts = [p1, p2, p3]
        payload = self._bounds([(p[0], p[1]) for p in pts]) + struct.pack("<III", 3, 1, 2)
        for x, y, rgb in pts:
            payload += struct.pack("<iiHHHH", x, y, ((rgb >> 16) & 0xFF) << 8, ((rgb >> 8) & 0xFF) << 8, (rgb & 0xFF) << 8, 0)
        payload += struct.pack("<III", 0, 1, 2)
        self._rec("GRADIENTFILL", payload)

    def stretch_dib(self, l, t, w, h, pixels: list[list[int]]) -> None:
        """Draw a 24-bit bottom-up DIB built from rows of 0xRRGGBB values."""
        ph, pw = len(pixels), len(pixels[0])
        row_bytes = (pw * 3 + 3) & ~3
        bits = b""
        for row in reversed(pixels):  # bottom-up
            line = b"".join(bytes(((c & 0xFF), (c >> 8) & 0xFF, (c >> 16) & 0xFF)) for c in row)
            bits += line + b"\x00" * (row_bytes - len(line))
        bmi = struct.pack("<IiiHHIIiiII", 40, pw, ph, 1, 24, 0, len(bits), 3780, 3780, 0, 0)
        off_bmi = 80
        off_bits = off_bmi + len(bmi)
        payload = struct.pack("<iiii", l, t, l + w, t + h)
        payload += struct.pack("<iiiiii", l, t, 0, 0, pw, ph)
        payload += struct.pack("<IIII", off_bmi, len(bmi), off_bits, len(bits))
        payload += struct.pack("<IIii", 0, 0x00CC0020, w, h)
        payload += bmi + bits
        self._rec("STRETCHDIBITS", payload)

    # -- output -------------------------------------------------------------
    def to_bytes(self) -> bytes:
        eof = struct.pack("<IIIII", EMR["EOF"], 20, 0, 16, 20)
        body = b"".join(self.records) + eof
        n_records = len(self.records) + 2
        total = 108 + len(body)
        frame_r = int(round(self.w * 2540 / 96.0))
        frame_b = int(round(self.h * 2540 / 96.0))
        header = struct.pack("<II", EMR["HEADER"], 108)
        header += struct.pack("<iiii", 0, 0, self.w - 1, self.h - 1)
        header += struct.pack("<iiii", 0, 0, frame_r, frame_b)
        header += struct.pack("<IIIIHH", 0x464D4520, 0x00010000, total, n_records, self._max_handle + 1, 0)
        header += struct.pack("<III", 0, 0, 0)  # description, palette
        header += struct.pack("<iiii", 1920, 1080, 508, 286)  # device px, device mm
        header += struct.pack("<III", 0, 0, 0)  # pixel format, OpenGL
        header += struct.pack("<ii", 508000, 286000)  # micrometers
        assert len(header) == 108
        return header + body


def emf_bar_chart() -> bytes:
    """An 'Excel chart pasted as picture' look-alike: title, gridlines, bars, line, legend."""
    W, H, S = 480, 300, 10
    e = EmfWriter(W, H, S)
    border = e.pen(0x808080, 10)
    white = e.brush(0xFFFFFF)
    e.select(border)
    e.select(white)
    e.rect(0, 0, W * S - 1, H * S - 1)
    # title
    title = e.font(150, "Arial", 700)
    e.select(title)
    e.text_color(0x1F1F1F)
    e.text_align(TA_CENTER | TA_TOP)
    e.text(W * S // 2, 120, "Revenue by Quarter ($M)", 150)
    # plot area
    x0, y0, x1, y1 = 600, 500, 4500, 2500
    grid = e.pen(0xD9D9D9, 0, PS_DASH)
    e.select(grid)
    small = e.font(100, "Arial")
    e.select(small)
    e.text_align(TA_RIGHT | TA_BASELINE)
    e.text_color(0x595959)
    for i in range(5):
        y = y1 - (y1 - y0) * i // 4
        e.move_to(x0, y)
        e.line_to(x1, y)
        e.text(x0 - 60, y + 35, str(i * 50), 100)
    axis = e.pen(0x404040, 15)
    e.select(axis)
    e.polyline([(x0, y0), (x0, y1), (x1, y1)])
    series = [(120, 140, 155, 171), (80, 95, 90, 120)]
    colors = [0x4472C4, 0xED7D31]
    group_w = (x1 - x0) // 4
    e.text_align(TA_CENTER | TA_TOP)
    for q in range(4):
        gx = x0 + q * group_w
        for s_i, vals in enumerate(series):
            b = e.brush(colors[s_i])
            e.select(b)
            e.select(NULL_PEN)
            bx = gx + 150 + s_i * 330
            top = y1 - int((y1 - y0) * vals[q] / 200.0)
            e.rect(bx, top, bx + 300, y1)
            e.select(white)
            e.delete(b)
        e.text(gx + group_w // 2, y1 + 60, f"Q{q + 1}", 100)
    # margin line with markers
    line = e.pen(0x70AD47, 25)
    e.select(line)
    pts = [(x0 + q * group_w + group_w // 2, y0 + 300 + (q % 2) * 250 - q * 80) for q in range(4)]
    e.polyline(pts)
    mk = e.brush(0x70AD47)
    e.select(mk)
    for x, y in pts:
        e.ellipse(x - 50, y - 50, x + 50, y + 50)
    # legend
    e.text_align(TA_LEFT | TA_BASELINE)
    lx = 1000
    for name, col in (("FY2023", colors[0]), ("FY2024", colors[1]), ("Margin", 0x70AD47)):
        b = e.brush(col)
        e.select(b)
        e.select(NULL_PEN)
        e.rect(lx, 2780, lx + 120, 2900)
        e.text(lx + 170, 2890, name, 100)
        e.select(white)
        e.delete(b)
        lx += 1100
    return e.to_bytes()


def emf_shapes() -> bytes:
    """Broad record coverage: gradients, beziers, paths, transforms, hatch, DIB, text."""
    W, H, S = 480, 360, 10
    e = EmfWriter(W, H, S)
    e.gradient_rect(0, 0, W * S, H * S, 0xF2F7FF, 0xC9DAF8, vertical=True)
    black = e.pen(0x000000, 20)
    e.select(black)
    # polygon star with WINDING vs ALTERNATE fill modes
    star = []
    for k in range(5):
        a = -math.pi / 2 + k * 4 * math.pi / 5
        star.append((int(700 + 450 * math.cos(a)), int(700 + 450 * math.sin(a))))
    red = e.brush(0xE15759)
    e.select(red)
    e.poly_fill_mode(1)  # ALTERNATE: hollow centre
    e.polygon(star)
    star2 = [(x + 1100, y) for x, y in star]
    e.poly_fill_mode(2)  # WINDING: filled centre
    e.polygon(star2)
    # pie, chord, arc
    green = e.brush(0x59A14F)
    e.select(green)
    e.pie(2400, 250, 3300, 1150, 3300, 700, 2850, 250)
    orange = e.brush(0xF28E2B)
    e.select(orange)
    e.chord(3450, 250, 4350, 1150, 4350, 900, 3450, 900)
    thick = e.pen(0x4E79A7, 60)
    e.select(thick)
    e.arc(3450, 300, 4350, 1200, 3450, 450, 4350, 450)
    # hatched round rect
    hatch = e.brush(0x76B7B2, BS_HATCHED, HS_DIAGCROSS)
    e.select(black)
    e.select(hatch)
    e.round_rect(200, 1400, 1300, 2200, 300, 300)
    # bezier ribbon
    blue = e.pen(0x4E79A7, 40)
    e.select(blue)
    e.polybezier([(1500, 2100), (1800, 1300), (2300, 2600), (2700, 1500), (2900, 1200), (3200, 1900), (3400, 1500)])
    # path: closed shape mixing lines and beziers, stroked and filled
    purple = e.brush(0xB07AA1)
    e.select(purple)
    e.select(black)
    e.begin_path()
    e.move_to(3600, 1400)
    e.polyline_to([(4500, 1400), (4500, 1900)])
    e.polybezier_to([(4300, 2300), (3800, 2300), (3600, 1900)])
    e.close_figure()
    e.end_path()
    e.stroke_and_fill_path()
    # polypolygon (square with square hole under ALTERNATE)
    e.poly_fill_mode(1)
    yellow = e.brush(0xEDC948)
    e.select(yellow)
    e.polypolygon([
        [(200, 2400), (1200, 2400), (1200, 3400), (200, 3400)],
        [(450, 2650), (950, 2650), (950, 3150), (450, 3150)],
    ])
    # rotated rectangle + rotated text via world transform
    e.save_dc()
    ang = math.radians(-20)
    e.world_transform(math.cos(ang), math.sin(ang), -math.sin(ang), math.cos(ang), 2000, 2900)
    teal = e.brush(0x17BECF)
    e.select(teal)
    e.rect(-500, -250, 500, 250)
    f = e.font(160, "Arial", 700)
    e.select(f)
    e.text_color(0xFFFFFF)
    e.text_align(TA_CENTER | TA_BASELINE)
    e.text(0, 60, "Rotated", 160)
    e.restore_dc()
    # gradient triangle
    e.gradient_triangle((2900, 3400, 0xFF0000), (3500, 2500, 0x00FF00), (4100, 3400, 0x0000FF))
    # clipped DIB checkerboard
    e.save_dc()
    e.clip_rect(4150, 2450, 4700, 3300)
    pix = [[(0x222222 if (x + y) % 2 else 0xFFD700) for x in range(8)] for y in range(8)]
    e.stretch_dib(4150, 2450, 800, 800, pix)
    e.restore_dc()
    # escapement text (45 degrees)
    f45 = e.font(140, "Arial", 400, italic=True, escapement=450)
    e.select(f45)
    e.text_color(0x7F0000)
    e.text_align(TA_LEFT | TA_BASELINE)
    e.text(1500, 1300, "EMF 45 deg", 140)
    return e.to_bytes()


def emf_table(rows: list[list[str]], col_widths: list[int], title: str = "") -> bytes:
    """Spreadsheet-like table preview, as Excel produces for embedded OLE objects."""
    S = 10
    row_h = 24
    W = sum(col_widths) + 2
    H = row_h * len(rows) + (30 if title else 0) + 2
    e = EmfWriter(W, H, S)
    e.select(e.brush(0xFFFFFF))
    e.select(NULL_PEN)
    e.rect(0, 0, W * S, H * S)
    top = 0
    if title:
        f = e.font(150, "Arial", 700)
        e.select(f)
        e.text_align(TA_LEFT | TA_BASELINE)
        e.text_color(0x000000)
        e.text(40, 210, title, 150)
        top = 300
    header_fill = e.brush(0x1F4E79)
    grid = e.pen(0xBFBFBF, 0)
    reg = e.font(110, "Arial")
    bold = e.font(110, "Arial", 700)
    y = top
    for r_i, row in enumerate(rows):
        if r_i == 0:
            e.select(header_fill)
            e.select(NULL_PEN)
            e.rect(0, y, sum(col_widths) * S, y + row_h * S)
        x = 0
        for c_i, cell in enumerate(row):
            w = col_widths[c_i] * S
            e.select(bold if (r_i == 0 or r_i == len(rows) - 1) else reg)
            e.text_color(0xFFFFFF if r_i == 0 else (0xC00000 if cell.startswith("(") else 0x000000))
            if c_i == 0:
                e.text_align(TA_LEFT | TA_BASELINE)
                e.text(x + 60, y + 170, cell, 110)
            else:
                e.text_align(TA_RIGHT | TA_BASELINE)
                e.text(x + w - 60, y + 170, cell, 110)
            x += w
        y += row_h * S
        e.select(grid)
        e.move_to(0, y)
        e.line_to(sum(col_widths) * S, y)
    # double rule under total
    rule = e.pen(0x000000, 10)
    e.select(rule)
    e.move_to(col_widths[0] * S, y - 30)
    e.line_to(sum(col_widths) * S, y - 30)
    return e.to_bytes()


# ---------------------------------------------------------------------------
# WMF
# ---------------------------------------------------------------------------

class WmfWriter:
    """Tiny MS-WMF writer with a placeable header. Units: logical (inch = `inch`)."""

    def __init__(self, width: int, height: int, inch: int = 1440):
        self.w, self.h, self.inch = width, height, inch
        self.records: list[bytes] = []
        self._objects: list[int] = []
        self._max_objects = 0
        self._rec(0x020B, 0, 0)  # SETWINDOWORG (y, x)
        self._rec(0x020C, height, width)  # SETWINDOWEXT (y, x)
        self._rec(0x0102, 1)  # SETBKMODE TRANSPARENT

    def _rec(self, func: int, *params: int, raw: bytes = b"") -> None:
        body = b"".join(struct.pack("<h", p) if p < 0x8000 else struct.pack("<H", p) for p in params) + raw
        assert len(body) % 2 == 0
        size_words = 3 + len(body) // 2
        self.records.append(struct.pack("<IH", size_words, func) + body)

    def _alloc(self) -> int:
        idx = 0
        while idx in self._objects:
            idx += 1
        self._objects.append(idx)
        self._max_objects = max(self._max_objects, len(self._objects))
        return idx

    def pen(self, rgb: int, width: int = 1, style: int = 0) -> int:
        idx = self._alloc()
        self._rec(0x02FA, raw=struct.pack("<HhhI", style, width, 0, colorref(rgb)))
        return idx

    def brush(self, rgb: int, style: int = 0, hatch: int = 0) -> int:
        idx = self._alloc()
        self._rec(0x02FC, raw=struct.pack("<HIH", style, colorref(rgb), hatch))
        return idx

    def font(self, height: int, face: str = "Arial", weight: int = 400, italic: bool = False, escapement: int = 0) -> int:
        idx = self._alloc()
        face_b = face.encode("latin-1")[:31]
        face_b = face_b + b"\x00" * (32 - len(face_b))
        raw = struct.pack("<hhhhhBBBBBBBB", -abs(height), 0, escapement, escapement, weight,
                          1 if italic else 0, 0, 0, 0, 0, 0, 4, 0) + face_b
        self._rec(0x02FB, raw=raw)
        return idx

    def select(self, idx: int) -> None:
        self._rec(0x012D, idx)

    def delete(self, idx: int) -> None:
        self._rec(0x01F0, idx)
        self._objects.remove(idx)

    def text_color(self, rgb: int) -> None:
        self._rec(0x0209, raw=struct.pack("<I", colorref(rgb)))

    def text_align(self, mode: int) -> None:
        self._rec(0x012E, mode)

    def rect(self, l, t, r, b) -> None:
        self._rec(0x041B, b, r, t, l)

    def round_rect(self, l, t, r, b, w, h) -> None:
        self._rec(0x061C, h, w, b, r, t, l)

    def ellipse(self, l, t, r, b) -> None:
        self._rec(0x0418, b, r, t, l)

    def pie(self, l, t, r, b, x1, y1, x2, y2) -> None:
        self._rec(0x081A, y2, x2, y1, x1, b, r, t, l)

    def polygon(self, pts) -> None:
        self._rec(0x0324, len(pts), raw=b"".join(struct.pack("<hh", x, y) for x, y in pts))

    def polyline(self, pts) -> None:
        self._rec(0x0325, len(pts), raw=b"".join(struct.pack("<hh", x, y) for x, y in pts))

    def move_to(self, x, y) -> None:
        self._rec(0x0214, y, x)

    def line_to(self, x, y) -> None:
        self._rec(0x0213, y, x)

    def text_out(self, x, y, s: str) -> None:
        b = s.encode("latin-1")
        if len(b) % 2:
            b += b"\x00"
        self._rec(0x0521, len(s.encode("latin-1")), raw=b + struct.pack("<hh", y, x))

    def ext_text_out(self, x, y, s: str, em: int) -> None:
        b = s.encode("latin-1")
        n = len(b)
        if n % 2:
            b += b"\x00"
        dx = b"".join(struct.pack("<h", a) for a in text_advances(s, em))
        self._rec(0x0A32, y, x, n, 0, raw=b + dx)

    def to_bytes(self) -> bytes:
        eof = struct.pack("<IH", 3, 0)
        body = b"".join(self.records) + eof
        max_rec = max(struct.unpack("<I", r[:4])[0] for r in self.records + [eof])
        total_words = (18 + len(body)) // 2
        header = struct.pack("<HHHIHIH", 1, 9, 0x0300, total_words, self._max_objects, max_rec, 0)
        assert len(header) == 18
        words = struct.pack("<IHhhhhH", 0x9AC6CDD7, 0, 0, 0, self.w, self.h, self.inch) + struct.pack("<I", 0)
        checksum = 0
        for i in range(0, 20, 2):
            checksum ^= struct.unpack("<H", words[i:i + 2])[0]
        placeable = words + struct.pack("<H", checksum)
        assert len(placeable) == 22
        return placeable + header + body


def wmf_pie_chart() -> bytes:
    """Clip-art era WMF: pie chart with legend, title and a few primitives."""
    W, H = 4800, 3000  # 1440 per inch -> 3.33 x 2.08 in
    m = WmfWriter(W, H)
    frame = m.pen(0x404040, 15)
    bg = m.brush(0xFFF8E7)
    m.select(frame)
    m.select(bg)
    m.round_rect(20, 20, W - 20, H - 20, 300, 300)
    title = m.font(220, "Arial", 700)
    m.select(title)
    m.text_color(0x1F3864)
    m.text_align(TA_LEFT | TA_TOP)
    m.text_out(200, 120, "Budget Mix FY2009")
    # pie slices (angles chosen by radial points, counter-clockwise from start to end)
    cx, cy, r = 1500, 1750, 1000
    slices = [(0.42, 0x4F81BD, "Payroll 42%"), (0.23, 0xC0504D, "Benefits 23%"),
              (0.20, 0x9BBB59, "Operations 20%"), (0.15, 0x8064A2, "Capital 15%")]
    angle = 0.0
    m.select(m.pen(0xFFFFFF, 20))
    for frac, col, _ in slices:
        a1 = angle
        a2 = angle + frac * 2 * math.pi
        b = m.brush(col)
        m.select(b)
        x1, y1 = int(cx + r * math.cos(a1)), int(cy - r * math.sin(a1))
        x2, y2 = int(cx + r * math.cos(a2)), int(cy - r * math.sin(a2))
        m.pie(cx - r, cy - r, cx + r, cy + r, x1, y1, x2, y2)
        m.delete(b)
        angle = a2
    legend = m.font(150, "Arial")
    m.select(legend)
    m.text_color(0x000000)
    y = 1000
    for _, col, label in slices:
        b = m.brush(col)
        m.select(b)
        m.rect(2900, y, 3080, y + 180)
        m.delete(b)
        m.ext_text_out(3160, y - 10, label, 150)
        y += 330
    # star polygon + zigzag polyline
    star = []
    for k in range(10):
        a = -math.pi / 2 + k * math.pi / 5
        rr = 260 if k % 2 == 0 else 110
        star.append((int(4300 + rr * math.cos(a)), int(500 + rr * math.sin(a))))
    m.select(m.brush(0xFFC000))
    m.polygon(star)
    m.select(m.pen(0xC00000, 30))
    m.polyline([(2900, 2650), (3150, 2450), (3400, 2650), (3650, 2450), (3900, 2650), (4150, 2450)])
    m.select(m.brush(0x00B0F0))
    m.ellipse(4300, 2350, 4600, 2750)
    m.move_to(2900, 2800)
    m.line_to(4600, 2800)
    return m.to_bytes()


# ---------------------------------------------------------------------------
# SVG (+ PNG fallback)
# ---------------------------------------------------------------------------

SVG_DRAWING = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1F77B4"/>
      <stop offset="1" stop-color="#2CA02C"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#FFE08A"/>
    </radialGradient>
  </defs>
  <rect x="4" y="4" width="312" height="232" rx="24" fill="url(#bg)" stroke="#0B3D63" stroke-width="4"/>
  <circle cx="90" cy="110" r="56" fill="url(#sun)" opacity="0.95"/>
  <path d="M170 186 L210 56 L250 186 Z" fill="#FF7F0E" stroke="#3A1F00" stroke-width="4" stroke-linejoin="round"/>
  <path d="M20 214 C 80 150, 160 250, 300 196" fill="none" stroke="#D62728" stroke-width="7" stroke-linecap="round"/>
  <g transform="translate(270 60) rotate(30)">
    <rect x="-22" y="-22" width="44" height="44" fill="#9467BD" fill-opacity="0.8"/>
  </g>
  <text x="160" y="36" font-family="Arial, Liberation Sans, sans-serif" font-size="22" font-weight="bold" text-anchor="middle" fill="#FFFFFF">SVG vector</text>
</svg>
"""


def svg_drawing() -> bytes:
    return SVG_DRAWING.encode("utf-8")


def svg_png_fallback() -> bytes:
    """Approximation of SVG_DRAWING. A magenta corner tag marks it as the fallback."""
    s = 2
    W, H = 320 * s, 240 * s
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    grad = Image.new("RGBA", (W, H))
    gp = grad.load()
    for y in range(H):
        for x in range(W):
            t = (x / W + y / H) / 2
            gp[x, y] = (int(0x1F + (0x2C - 0x1F) * t), int(0x77 + (0xA0 - 0x77) * t), int(0xB4 + (0x2C - 0xB4) * t), 255)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([4 * s, 4 * s, 316 * s, 236 * s], radius=24 * s, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4 * s, 4 * s, 316 * s, 236 * s], radius=24 * s, outline=(0x0B, 0x3D, 0x63, 255), width=4 * s)
    d.ellipse([34 * s, 54 * s, 146 * s, 166 * s], fill=(0xFF, 0xF0, 0xC0, 240))
    d.polygon([(170 * s, 186 * s), (210 * s, 56 * s), (250 * s, 186 * s)], fill=(0xFF, 0x7F, 0x0E, 255), outline=(0x3A, 0x1F, 0, 255))
    pts = []
    for i in range(41):
        t = i / 40
        x = (1 - t) ** 3 * 20 + 3 * (1 - t) ** 2 * t * 80 + 3 * (1 - t) * t ** 2 * 160 + t ** 3 * 300
        y = (1 - t) ** 3 * 214 + 3 * (1 - t) ** 2 * t * 150 + 3 * (1 - t) * t ** 2 * 250 + t ** 3 * 196
        pts.append((x * s, y * s))
    d.line(pts, fill=(0xD6, 0x27, 0x28, 255), width=7 * s, joint="curve")
    d.polygon([(0, 0), (40 * s, 0), (0, 40 * s)], fill=(0xFF, 0x00, 0xFF, 255))  # fallback marker
    return _png(img.resize((320, 240), Image.LANCZOS))


# ---------------------------------------------------------------------------
# Raster images
# ---------------------------------------------------------------------------

def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False, compress_level=9)
    return buf.getvalue()


def testcard(w: int = 320, h: int = 240) -> Image.Image:
    """Quadrant test card: TL red, TR green, BL blue, BR yellow, grid, centre target."""
    img = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(img)
    cols = [(0xE1, 0x57, 0x59), (0x59, 0xA1, 0x4F), (0x4E, 0x79, 0xA7), (0xED, 0xC9, 0x48)]
    d.rectangle([0, 0, w // 2 - 1, h // 2 - 1], fill=cols[0])
    d.rectangle([w // 2, 0, w - 1, h // 2 - 1], fill=cols[1])
    d.rectangle([0, h // 2, w // 2 - 1, h - 1], fill=cols[2])
    d.rectangle([w // 2, h // 2, w - 1, h - 1], fill=cols[3])
    for i in range(1, 10):
        d.line([(w * i // 10, 0), (w * i // 10, h)], fill=(255, 255, 255), width=1)
        d.line([(0, h * i // 10), (w, h * i // 10)], fill=(255, 255, 255), width=1)
    r = min(w, h) // 5
    d.ellipse([w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r], fill=(255, 255, 255), outline=(0, 0, 0), width=3)
    d.ellipse([w // 2 - r // 3, h // 2 - r // 3, w // 2 + r // 3, h // 2 + r // 3], fill=(0, 0, 0))
    d.line([(0, 0), (w - 1, h - 1)], fill=(0, 0, 0), width=2)
    d.rectangle([0, 0, w - 1, h - 1], outline=(0, 0, 0), width=3)
    # an "F" glyph-like mark so flips/rotations are unambiguous
    d.rectangle([12, 12, 22, 62], fill=(0, 0, 0))
    d.rectangle([12, 12, 50, 22], fill=(0, 0, 0))
    d.rectangle([12, 32, 40, 42], fill=(0, 0, 0))
    return img


def png_testcard() -> bytes:
    return _png(testcard())


def png_alpha() -> bytes:
    w, h = 320, 240
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([20, 20, 180, 180], fill=(0xE1, 0x57, 0x59, 255))
    d.rectangle([120, 60, 300, 200], fill=(0x4E, 0x79, 0xA7, 128))
    for x in range(w):
        d.line([(x, 210), (x, 239)], fill=(0x22, 0x22, 0x22, int(255 * x / (w - 1))))
    d.polygon([(250, 10), (310, 50), (250, 90)], fill=(0x59, 0xA1, 0x4F, 200))
    return _png(img)


def jpeg_photo() -> bytes:
    w, h = 320, 240
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            sky = (int(110 + 100 * y / h), int(160 + 60 * y / h), 235)
            px[x, y] = sky
    d = ImageDraw.Draw(img)
    d.ellipse([220, 30, 280, 90], fill=(255, 220, 120))
    d.polygon([(0, 200), (80, 110), (150, 180), (230, 90), (320, 190), (320, 240), (0, 240)], fill=(70, 110, 70))
    d.polygon([(0, 240), (0, 215), (120, 200), (320, 225), (320, 240)], fill=(50, 80, 50))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85, optimize=False, progressive=False, subsampling=2)
    return buf.getvalue()


def gif_palette() -> bytes:
    w, h = 200, 150
    img = Image.new("P", (w, h), 0)
    pal = [255, 255, 255, 0xE1, 0x57, 0x59, 0x4E, 0x79, 0xA7, 0x59, 0xA1, 0x4F, 0, 0, 0] + [0] * (256 * 3 - 15)
    img.putpalette(pal)
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, 90, 90], fill=1)
    d.ellipse([60, 40, 160, 140], fill=2)
    d.polygon([(120, 10), (190, 10), (155, 70)], fill=3)
    d.rectangle([0, 0, w - 1, h - 1], outline=4)
    buf = io.BytesIO()
    img.save(buf, format="GIF", transparency=0)
    return buf.getvalue()


def bmp_testcard() -> bytes:
    buf = io.BytesIO()
    testcard(160, 120).save(buf, format="BMP")
    return buf.getvalue()


def tiff_testcard() -> bytes:
    buf = io.BytesIO()
    testcard(160, 120).save(buf, format="TIFF", compression="tiff_lzw")
    return buf.getvalue()


def png_logo() -> bytes:
    """Fictional 'Northwind Analytics' logo mark with transparency."""
    s = 4
    W = 128 * s
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4 * s, 4 * s, 124 * s, 124 * s], fill=(0x1F, 0x4E, 0x79, 255))
    for i, hgt in enumerate((40, 64, 88)):
        x = (34 + i * 22) * s
        d.rectangle([x, (100 - hgt) * s, x + 14 * s, 100 * s], fill=(255, 255, 255, 255))
    d.line([(30 * s, 84 * s), (60 * s, 60 * s), (80 * s, 66 * s), (102 * s, 34 * s)], fill=(0xF4, 0xB1, 0x83, 255), width=6 * s)
    return _png(img.resize((128, 128), Image.LANCZOS))


def png_pattern_tile() -> bytes:
    """Small seamless tile for picture-tile fills and tiled backgrounds."""
    w = 48
    img = Image.new("RGB", (w, w), (0xF4, 0xF1, 0xEA))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 23, 23], fill=(0xD9, 0xE6, 0xF2))
    d.rectangle([24, 24, 47, 47], fill=(0xD9, 0xE6, 0xF2))
    d.ellipse([16, 16, 32, 32], fill=(0xC0, 0x50, 0x4D))
    d.line([(0, 47), (47, 0)], fill=(0x7F, 0x7F, 0x7F), width=1)
    return _png(img)


def crc_check() -> int:
    """Used by the generator to detect accidental nondeterminism in media."""
    blobs = [emf_bar_chart(), emf_shapes(), wmf_pie_chart(), svg_png_fallback(), png_testcard()]
    return zlib.crc32(b"".join(blobs))
