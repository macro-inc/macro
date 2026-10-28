#!/usr/bin/env python3
"""Regenerate the synthetic feature-coverage decks in tests/corpus/generated/.

Usage:
    python3 crates/pptx_engine/scripts/generate_corpus.py [--only NAME ...] [--list]
        [--no-libreoffice] [--xsd-dir DIR] [--no-manifest] [--out DIR]

Every deck is small and focused on one area (text, bullets, shapes, fills, lines,
effects, pictures, tables, charts, groups, slide features, ...). Decks are built
with python-pptx; anything python-pptx cannot express is injected as raw
DrawingML/PresentationML in schema order (see corpus_xml.py).

Output is deterministic: fixed core-property timestamps, a rewritten app.xml,
fixed zip entry timestamps, deterministic embedded workbooks and media generated
from code (corpus_media.py). Byte-identical output assumes the same python-pptx,
XlsxWriter, Pillow and zlib versions.

The `lo-roundtrip-*` decks are produced by LibreOffice (pptx -> odp -> pptx) from
other generated decks to provide LibreOffice-written PPTX XML. They need `soffice`
(LibreOffice Impress); with --no-libreoffice they are left untouched.

--xsd-dir points at the ECMA-376 Part 4 *transitional* XML schemas (the
OfficeOpenXML-XMLSchema-Transitional folder); when given, every slide, layout,
master, theme and chart part is validated and errors fail the run.

Unless --no-manifest is given, tests/corpus/manifest.json is refreshed afterwards
(see update_manifest.py).
"""

from __future__ import annotations

import argparse
import datetime
import io
import math
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

import pptx  # noqa: E402
import xlsxwriter  # noqa: E402
from lxml import etree  # noqa: E402
from pptx import Presentation  # noqa: E402
from pptx.chart.data import BubbleChartData, CategoryChartData, XyChartData  # noqa: E402
from pptx.dml.color import RGBColor  # noqa: E402
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION, XL_MARKER_STYLE  # noqa: E402
from pptx.opc.constants import RELATIONSHIP_TYPE as RT  # noqa: E402
from pptx.opc.package import Part  # noqa: E402
from pptx.opc.packuri import PackURI  # noqa: E402
from pptx.oxml.ns import qn  # noqa: E402
from pptx.parts.embeddedpackage import EmbeddedXlsxPart  # noqa: E402
from pptx.parts.image import ImagePart  # noqa: E402
from pptx.util import Inches, Pt  # noqa: E402

import corpus_media as media  # noqa: E402
from corpus_xml import (  # noqa: E402
    BU_NONE, NOFILL, blipfill, body, br, bullet_auto, bullet_char, clr, cxn, effect_lst, esc, fld,
    glow, grad, grp, guid, inch, inner_shdw, ln, normalize_package, outer_shdw, p, parse, patt, pic, prst_geom,
    r, reflection, soft_edge, solid, sp, style_ref, xfrm,
)

CORPUS_DIR = SCRIPT_DIR.parent / "tests" / "corpus"
GEN_DIR = CORPUS_DIR / "generated"
GENERATOR_APP = f"pptx_engine corpus generator (python-pptx {pptx.__version__})"

# -- deterministic embedded workbooks (charts, OLE) ---------------------------
_orig_wb_init = xlsxwriter.Workbook.__init__


def _wb_init(self, *args, **kwargs):  # pragma: no cover - trivial
    _orig_wb_init(self, *args, **kwargs)
    self.set_properties({"created": datetime.datetime(2024, 1, 1, 0, 0, 0)})


xlsxwriter.Workbook.__init__ = _wb_init

W43, H43 = 9144000, 6858000
W169 = 12192000
A4_PORTRAIT = (7560000, 10692000)

CT = {
    "png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp",
    "tiff": "image/tiff", "emf": "image/x-emf", "wmf": "image/x-wmf", "svg": "image/svg+xml",
}

ACCENTS = ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"]
SAMPLE = "Revenue grew 12% year over year while operating costs stayed flat."
LONG_TEXT = (
    "Operating income increased to $42.7 million, driven by higher subscription revenue and "
    "disciplined spending. Net cash provided by operating activities was $51.3 million, and the "
    "company ended the quarter with $310.2 million in cash and short-term investments."
)


# =============================================================================
# Deck / slide wrappers
# =============================================================================

class Deck:
    def __init__(self, name: str, title: str, description: str, features=(), size: tuple | None = None):
        self.name, self.title, self.description = name, title, description
        self.features = list(features)
        self.prs = Presentation()
        self._media: dict[bytes, ImagePart] = {}
        if size is not None:
            rescale_template(self.prs, *size)

    @property
    def width(self) -> int:
        return self.prs.slide_width

    @property
    def height(self) -> int:
        return self.prs.slide_height

    def layout(self, name: str):
        for lay in self.prs.slide_layouts:
            if lay.name == name:
                return lay
        raise KeyError(name)

    def slide(self, layout: str = "Title Only", title: str | None = None, title_size: float = 28) -> "Slide":
        s = self.prs.slides.add_slide(self.layout(layout))
        w = Slide(self, s)
        if title is not None and s.shapes.title is not None:
            w.set_title(title, title_size)
        return w

    def media_part(self, blob: bytes, ext: str) -> ImagePart:
        key = ext.encode() + b":" + blob
        part = self._media.get(key)
        if part is None:
            partname = self.prs.part.package.next_image_partname(ext)
            part = ImagePart(partname, CT[ext], self.prs.part.package, blob)
            self._media[key] = part
        return part

    def theme_part(self):
        return self.prs.slide_master.part.part_related_by(RT.THEME)

    def save(self, out_dir: Path) -> Path:
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{self.name}.pptx"
        fix_chart_axis_ids(self.prs)
        self.prs.save(str(path))
        w, h = self.width, self.height
        fmt = {(W43, H43): "On-screen Show (4:3)", (W169, H43): "Widescreen"}.get((w, h), "Custom")
        normalize_package(path, self.title, self.description, ", ".join(self.features), GENERATOR_APP, fmt)
        return path


class Slide:
    def __init__(self, deck: Deck, slide):
        self.deck, self.s = deck, slide
        self._next = 0

    def nid(self) -> int:
        cur = self.s.shapes._next_shape_id
        self._next = max(self._next, cur)
        v = self._next
        self._next += 1
        return v

    def add(self, xml: str):
        el = parse(xml)
        self.s.shapes._spTree.insert_element_before(el, "p:extLst")
        return el

    def set_title(self, text: str, size: float | None = 28) -> None:
        t = self.s.shapes.title
        t.text_frame.text = text
        if size:
            for run in t.text_frame.paragraphs[0].runs:
                run.font.size = Pt(size)

    def image(self, blob: bytes, ext: str) -> str:
        return self.s.part.relate_to(self.deck.media_part(blob, ext), RT.IMAGE)

    def link(self, url: str) -> str:
        return self.s.part.relate_to(url, RT.HYPERLINK, is_external=True)

    def slide_link(self, other: "Slide") -> str:
        return self.s.part.relate_to(other.s.part, RT.SLIDE)

    # -- convenience builders ----------------------------------------------
    def shape(self, x, y, w, h, geom="rect", text: str | None = None, **kw):
        """Inch-based wrapper around corpus_xml.sp()."""
        sid = self.nid()
        return self.add(sp(sid, kw.pop("name", f"{geom} {sid}"), inch(x), inch(y), inch(w), inch(h),
                           geom=geom, text=text, **kw))

    def textbox(self, x, y, w, h, *paras, line=None, fill=None, rot=None, flip_h=False, flip_v=False,
                name=None, geom="rect", effects=None, **bkw):
        bkw.setdefault("wrap", "square")
        sid = self.nid()
        return self.add(sp(sid, name or f"TextBox {sid}", inch(x), inch(y), inch(w), inch(h), geom=geom,
                           fill=fill, line=line, rot=rot, flip_h=flip_h, flip_v=flip_v, effects=effects,
                           txbox=True, text=body(*paras, **bkw)))

    def label(self, x, y, w, h, text, sz=10, algn="ctr", color="404040", b=None, anchor="t", font=None):
        return self.textbox(x, y, w, h, p(r(text, sz=sz, b=b, fill=color, latin=font), algn=algn),
                            anchor=anchor, ins=(0.02, 0.02, 0.02, 0.02))

    def note(self, text: str) -> None:
        self.s.notes_slide.notes_text_frame.text = text

    def background(self, inner: str) -> None:
        csld = self.s._element.find(qn("p:cSld"))
        old = csld.find(qn("p:bg"))
        if old is not None:
            csld.remove(old)
        csld.insert(0, parse(f"<p:bg>{inner}</p:bg>"))

    def footers(self, footer: str, date: str = "January 1, 2024") -> None:
        num = self.deck.prs.slides.index(self.s) + 1
        items = [
            ("dt", "half", 10, "Date Placeholder", r(date)),  # fixed date text: live fields would break baselines
            ("ftr", "quarter", 11, "Footer Placeholder", r(footer)),
            ("sldNum", "quarter", 12, "Slide Number Placeholder", fld("slidenum", str(num), f"{self.deck.name}-sn")),
        ]
        for typ, sz_, idx, name, inner in items:
            sid = self.nid()
            self.add(sp(sid, f"{name} {sid}", 0, 0, 0, 0, geom=None, no_xfrm=True,
                        ph=f'<p:ph type="{typ}" sz="{sz_}" idx="{idx}"/>', text=body(p(inner), tag="p:txBody")))


def fix_chart_axis_ids(prs) -> None:
    """Make python-pptx chart XML schema-valid.

    Its templates use negative axis ids (the schema says unsignedInt; PowerPoint writes positive ids).
    """
    for part in prs.part.package.iter_parts():
        if str(part.partname).startswith("/ppt/charts/chart") and hasattr(part, "_element"):
            for el in part._element.iter(qn("c:axId"), qn("c:crossAx")):
                v = int(el.get("val"))
                if v < 0:
                    el.set("val", str(v + 2 ** 32))
            # python-pptx's radar template emits c:smooth, which CT_RadarSer does not allow.
            for el in part._element.findall(".//c:radarChart/c:ser/c:smooth", {"c": "http://schemas.openxmlformats.org/drawingml/2006/chart"}):
                el.getparent().remove(el)


def rescale_template(prs, cx: int, cy: int) -> None:
    """Change the slide size and scale master/layout geometry like PowerPoint does."""
    sx, sy = cx / prs.slide_width, cy / prs.slide_height
    parts = [prs.slide_master] + list(prs.slide_layouts)
    for obj in parts:
        for el in obj._element.iter(qn("a:off"), qn("a:chOff")):
            el.set("x", str(int(round(int(el.get("x")) * sx))))
            el.set("y", str(int(round(int(el.get("y")) * sy))))
        for el in obj._element.iter(qn("a:ext"), qn("a:chExt")):
            if el.get("cx") is not None:
                el.set("cx", str(int(round(int(el.get("cx")) * sx))))
                el.set("cy", str(int(round(int(el.get("cy")) * sy))))
    prs.slide_width, prs.slide_height = cx, cy
    sz = prs.part._element.find(qn("p:sldSz"))
    if "type" in sz.attrib:
        del sz.attrib["type"]


def grid_cells(cols, rows, x0, y0, w, h, gx=0.15, gy=0.15):
    cw = (w - gx * (cols - 1)) / cols
    ch = (h - gy * (rows - 1)) / rows
    for rr in range(rows):
        for cc in range(cols):
            yield x0 + cc * (cw + gx), y0 + rr * (ch + gy), cw, ch


def tag_ln(tag: str, *a, **kw) -> str:
    x = ln(*a, **kw)
    return x.replace("<a:ln", f"<a:{tag}", 1)[: -len("</a:ln>")] + f"</a:{tag}>"


DARK = "262626"
OUTLINE = ln(1, "404040")


# =============================================================================
# Text decks
# =============================================================================

def deck_text_fonts() -> Deck:
    d = Deck("text-fonts-sizes", "Text: typefaces, sizes, bold/italic/underline/strike",
             "Latin typefaces (Calibri, Cambria, Arial, Times New Roman, Courier New, theme +mj-lt/+mn-lt) "
             "in four styles, point sizes 8-60, all underline styles and strike types.",
             ["text", "fonts", "font-sizes", "underline-styles", "strike", "theme-fonts"])
    s = d.slide(title="Typefaces: regular, bold, italic, bold italic")
    paras = []
    for face in ["Calibri", "Cambria", "Arial", "Times New Roman", "Courier New", "+mj-lt", "+mn-lt"]:
        paras.append(p(
            r(f"{face}:  ", sz=11, b=True, fill="7F7F7F", latin="Arial"),
            r("Quick fox 0123 ", sz=18, latin=face), r("Bold ", sz=18, b=True, latin=face),
            r("Italic ", sz=18, i=True, latin=face), r("Bold Italic", sz=18, b=True, i=True, latin=face),
            spc_aft=("pts", 8)))
    s.textbox(0.4, 1.5, 9.2, 5.6, *paras)
    for label_, sizes in (("Sizes 8-24 pt", [8, 9, 10, 11, 12, 14, 16, 18, 20, 24]),
                          ("Sizes 28-44 pt", [28, 32, 36, 40, 44]), ("Sizes 48-60 pt", [48, 54, 60])):
        s = d.slide(title=label_)
        paras = [p(r(f"{z} pt  ", sz=z, fill="C00000"), r("Agxy Budget 2024", sz=z)) for z in sizes]
        s.textbox(0.4, 1.4, 9.2, 5.9, *paras, line=ln(0.75, "BFBFBF", dash="dash"))
    s = d.slide(title="Underline and strike styles")
    unders = ["sng", "dbl", "heavy", "dotted", "dottedHeavy", "dash", "dashHeavy", "dashLong", "dashLongHeavy",
              "dotDash", "dotDashHeavy", "dotDotDash", "dotDotDashHeavy", "wavy", "wavyHeavy", "wavyDbl", "words"]
    left = [p(r(f"u={u}: ", sz=11, fill="7F7F7F"), r("Underlined text", sz=16, u=u), spc_aft=("pts", 3))
            for u in unders[:9]]
    right = [p(r(f"u={u}: ", sz=11, fill="7F7F7F"), r("Underlined text", sz=16, u=u), spc_aft=("pts", 3))
             for u in unders[9:]]
    right += [p(r("strike=sngStrike: ", sz=11, fill="7F7F7F"), r("Struck text", sz=16, strike="sngStrike")),
              p(r("strike=dblStrike: ", sz=11, fill="7F7F7F"), r("Struck text", sz=16, strike="dblStrike")),
              p(r("u=sng + uFill red: ", sz=11, fill="7F7F7F"),
                r("Colored underline", sz=16, u="sng", u_ln=tag_ln("uLn", 1.5, "FF0000"), u_fill="FF0000"))]
    s.textbox(0.3, 1.4, 4.6, 5.9, *left)
    s.textbox(5.0, 1.4, 4.8, 5.9, *right)
    return d


def deck_text_runs() -> Deck:
    d = Deck("text-run-formatting", "Text: colors, highlight, spacing, baseline, caps, mixed runs",
             "Run-level formatting: srgb/scheme/preset/system/HSL colors with lumMod/lumOff/tint/shade/alpha, "
             "highlight, character spacing, super/subscript, all/small caps, mixed runs, line breaks, text "
             "gradient fill, outline, shadow and glow.",
             ["text", "color-transforms", "highlight", "char-spacing", "baseline", "caps", "text-effects"])
    s = d.slide(title="Text colors and color transforms")
    rows = [
        ("srgbClr C00000", dict(fill="C00000")),
        ("schemeClr accent1", dict(fill=solid("scheme:accent1"))),
        ("accent1 lumMod 75%", dict(fill=solid("scheme:accent1", "lumMod=75000"))),
        ("accent2 lumMod 60% lumOff 40%", dict(fill=solid("scheme:accent2", "lumMod=60000", "lumOff=40000"))),
        ("accent6 tint 50%", dict(fill=solid("scheme:accent6", "tint=50000"))),
        ("accent6 shade 50%", dict(fill=solid("scheme:accent6", "shade=50000"))),
        ("tx2 (dk2 via clrMap)", dict(fill=solid("scheme:tx2"))),
        ("prstClr darkOrange", dict(fill=solid("prst:darkOrange"))),
        ("sysClr windowText", dict(fill=solid("sys:windowText/000000"))),
        ("hslClr 200,80,40", dict(fill=solid("hsl:200,80,40"))),
        ("srgb 0070C0 alpha 40%", dict(fill=solid("0070C0", "alpha=40000"))),
        ("accent4 satMod 200% hueOff", dict(fill=solid("scheme:accent4", "satMod=200000", "hueOff=1200000"))),
    ]
    s.shape(3.7, 1.45, 4.2, 5.7, fill=patt("wdUpDiag", "BFBFBF", "FFFFFF"), name="Stripe backdrop (shows alpha)")
    s.textbox(0.4, 1.4, 9.2, 5.8, *[p(r(f"{lbl}", sz=12, fill="595959"), r("\tSample text Ag", sz=22, b=True, **kw),
                                      tabs=[(3.5, "l")]) for lbl, kw in rows])
    s = d.slide(title="Highlight, spacing, baseline, caps")
    paras = [
        p(r("Highlight: ", sz=16), r("yellow highlight", sz=16, highlight="FFFF00"), r(" and ", sz=16),
          r("cyan highlight", sz=16, highlight="00FFFF")),
        p(r("spc -2pt: ", sz=12, fill="7F7F7F"), r("Condensed spacing", sz=20, spc=-2)),
        p(r("spc 0: ", sz=12, fill="7F7F7F"), r("Normal spacing", sz=20)),
        p(r("spc +5pt: ", sz=12, fill="7F7F7F"), r("Expanded spacing", sz=20, spc=5)),
        p(r("spc +10pt: ", sz=12, fill="7F7F7F"), r("WIDE", sz=20, spc=10)),
        p(r("Superscript: E = mc", sz=22), r("2", sz=22, baseline=30), r("   x", sz=22), r("i", sz=22, baseline=-25),
          r("2", sz=22, baseline=30), r("   H", sz=22), r("2", sz=22, baseline=-25), r("O", sz=22),
          r("   Revenue", sz=22), r("(1)", sz=22, baseline=30)),
        p(r("cap=all: ", sz=12, fill="7F7F7F"), r("All capitals from lower case", sz=20, cap="all")),
        p(r("cap=small: ", sz=12, fill="7F7F7F"), r("Small Capitals From Mixed Case", sz=20, cap="small")),
        p(r("kern 12pt: ", sz=12, fill="7F7F7F"), r("AVATAR Wave To", sz=24, kern=12), r("   kern 0: ", sz=12, fill="7F7F7F"),
          r("AVATAR Wave To", sz=24, kern=0)),
    ]
    s.textbox(0.4, 1.4, 9.2, 5.8, *paras, spc_col=None)
    s = d.slide(title="Mixed runs, line breaks, wrapping")
    s.textbox(0.4, 1.4, 9.2, 1.4, p(
        r("Mixed ", sz=12), r("sizes ", sz=28, b=True, fill="C00000"), r("fonts ", sz=20, latin="Times New Roman", i=True),
        r("and ", sz=14, latin="Courier New"), r("colors ", sz=24, fill=solid("scheme:accent1")),
        r("share one baseline", sz=16, u="sng")), line=ln(0.75, "BFBFBF"))
    s.textbox(0.4, 3.0, 4.4, 2.2, p(r("Line one", sz=18), br(sz=18), r("Line two after a:br", sz=18), br(sz=18),
                                    br(sz=18), r("Line four after two breaks", sz=18)),
              p(end='<a:endParaRPr lang="en-US" sz="4000" dirty="0"/>'),
              p(r("After a 40pt empty paragraph", sz=12)), line=ln(0.75, "BFBFBF"))
    s.textbox(5.1, 3.0, 4.5, 4.0, p(r(LONG_TEXT, sz=16)), p(r("Unbreakable: " + "x" * 60, sz=14)),
              line=ln(0.75, "BFBFBF"))
    s = d.slide(title="Text fill, outline, shadow and glow")
    paras = [
        p(r("Gradient-filled text", sz=40, b=True, fill=grad([(0, "C00000"), (50, "FFC000"), (100, "0070C0")], ang=0))),
        p(r("Outlined text, no fill", sz=40, b=True, fill=NOFILL, line=ln(1.25, "1F3864"))),
        p(r("Filled + outline", sz=40, b=True, fill="FFC000", line=ln(1.5, "7F3F00"))),
        p(r("Text with shadow", sz=40, b=True, fill="2F5597", effects=effect_lst(outer_shdw(3, 3, 45, "000000", 50)))),
        p(r("Text with glow", sz=40, b=True, fill="1F3864", effects=effect_lst(glow(6, "FFC000", 75)))),
        p(r("Pattern-filled text", sz=40, b=True, fill=patt("wdUpDiag", "C00000", "FFC000"))),
    ]
    s.textbox(0.4, 1.4, 9.2, 5.9, *paras, fill=solid("F2F2F2"))
    return d


def deck_text_paragraphs() -> Deck:
    d = Deck("text-paragraphs", "Text: alignment, anchoring, insets, spacing, indents, tabs",
             "Paragraph alignment l/ctr/r/just/dist/justLow, vertical anchors with anchorCtr, insets, line "
             "spacing (80/100/150/200%, exact points), space before/after, hanging indents, tab stops "
             "(left/center/right/decimal) and long-text wrapping.",
             ["text", "alignment", "vertical-anchor", "insets", "line-spacing", "indents", "tabs"])
    s = d.slide(title="Horizontal alignment")
    for (x, y, w, h), al in zip(grid_cells(3, 2, 0.4, 1.5, 9.2, 5.7), ["l", "ctr", "r", "just", "dist", "justLow"]):
        s.textbox(x, y, w, h, p(r(f"algn={al}", sz=12, b=True, fill="C00000"), algn="ctr"),
                  p(r(SAMPLE + " Margins were steady across all regions.", sz=14), algn=al),
                  line=ln(0.75, "7F7F7F"))
    s = d.slide(title="Vertical anchor and insets")
    for (x, y, w, h), (anchor, ctr) in zip(grid_cells(4, 1, 0.4, 1.5, 9.2, 2.6),
                                           [("t", False), ("ctr", False), ("b", False), ("t", True)]):
        s.textbox(x, y, w, h, p(r(f"anchor={anchor}" + (" anchorCtr" if ctr else ""), sz=14), algn="l"),
                  anchor=anchor, anchor_ctr=ctr, line=ln(0.75, "7F7F7F"), fill=solid("F2F2F2"))
    for (x, y, w, h), ins in zip(grid_cells(3, 1, 0.4, 4.4, 9.2, 2.8),
                                 [(0, 0, 0, 0), (0.1, 0.05, 0.1, 0.05), (0.6, 0.5, 0.2, 0.1)]):
        s.textbox(x, y, w, h, p(r(f"insets l,t,r,b = {ins} in. ", sz=12, b=True), r(SAMPLE, sz=12)),
                  ins=ins, line=ln(0.75, "C00000"), fill=solid("FFF2CC"))
    s = d.slide(title="Line spacing and paragraph spacing")
    specs = [("spcPct 80%", ("pct", 80)), ("spcPct 100%", ("pct", 100)), ("spcPct 150%", ("pct", 150)),
             ("spcPct 200%", ("pct", 200)), ("spcPts 12", ("pts", 12)), ("spcPts 30", ("pts", 30))]
    for (x, y, w, h), (lbl, sp_) in zip(grid_cells(3, 2, 0.4, 1.5, 9.2, 4.3), specs):
        s.textbox(x, y, w, h, p(r(lbl, sz=11, b=True, fill="C00000")),
                  p(r("Three lines of text show the line pitch clearly here.", sz=14), ln_spc=sp_),
                  line=ln(0.75, "7F7F7F"))
    s.textbox(0.4, 6.0, 9.2, 1.3,
              p(r("spcBef 0 / spcAft 12pt", sz=12), spc_aft=("pts", 12)),
              p(r("spcBef 18pt / spcAft 0", sz=12), spc_bef=("pts", 18)),
              p(r("spcBef 50% of line (spcPct)", sz=12), spc_bef=("pct", 50)), line=ln(0.75, "7F7F7F"))
    s = d.slide(title="Indents, hanging indents and tab stops")
    s.textbox(0.4, 1.4, 4.5, 3.0,
              p(r("marL 0, indent 0: " + SAMPLE, sz=12)),
              p(r("First-line indent 0.5in: " + SAMPLE, sz=12), indent=0.5),
              p(r("Hanging: marL 0.6in indent -0.6in: " + SAMPLE, sz=12), mar_l=0.6, indent=-0.6),
              p(r("marL 1.2in: " + SAMPLE, sz=12), mar_l=1.2), line=ln(0.75, "7F7F7F"))
    tabs = [(2.6, "l"), (4.4, "ctr"), (6.2, "r"), (7.8, "dec")]
    rows = [("Item", "Left", "Center", "Right", "Decimal"), ("Revenue", "North", "1,204", "12.5", "1,234.56"),
            ("Costs", "South", "98", "(3.75)", "(56.7)"), ("Margin", "West", "15,000", "0.5", "12.345")]
    paras = [p(*[r(("\t" if i else "") + c, sz=14, b=(ri == 0)) for i, c in enumerate(row)], tabs=tabs)
             for ri, row in enumerate(rows)]
    paras.append(p(r("defTabSz 0.25in:\ta\tb\tc\td", sz=14), def_tab_sz=0.25))
    s.textbox(0.4, 4.6, 9.2, 2.6, *paras, line=ln(0.75, "7F7F7F"))
    s.textbox(5.1, 1.4, 4.5, 3.0, p(r("RTL paragraph (rtl=1, algn=r): ", sz=12), r("עברית ותוכן", sz=16, cs="Arial"),
                                    rtl=True, algn="r"),
              p(r("Right-aligned LTR paragraph", sz=12), algn="r"), line=ln(0.75, "7F7F7F"))
    return d


def deck_text_bullets() -> Deck:
    d = Deck("text-bullets-numbering", "Text: bullets and automatic numbering",
             "buChar with Arial/Wingdings/Symbol fonts, bullet color and size (pct/pts), buNone, picture "
             "bullet, buAutoNum schemes with startAt, and 5-level lists from the master body style and from a "
             "custom list style.", ["text", "bullets", "autonumber", "picture-bullet", "list-levels"])
    s = d.slide(title="Bullet characters, fonts, colors and sizes")
    specs = [
        ("• Arial", bullet_char("•", "Arial")),
        ("– en dash", bullet_char("–", "Arial")),
        ("Wingdings §", bullet_char("§", "Wingdings", charset=2, pitch=2)),
        ("Wingdings Ø", bullet_char("Ø", "Wingdings", charset=2, pitch=2)),
        ("Wingdings ü (check)", bullet_char("ü", "Wingdings", charset=2, pitch=2)),
        ("Symbol ·", bullet_char("·", "Symbol", charset=2, pitch=18)),
        ("buClr accent2", bullet_char("■", "Arial", color="scheme:accent2")),
        ("buSzPct 50%", bullet_char("●", "Arial", size_pct=50)),
        ("buSzPct 150% red", bullet_char("●", "Arial", color="C00000", size_pct=150)),
        ("buSzPts 24", bullet_char("◆", "Arial", size_pts=24)),
        ("buNone (marL kept)", BU_NONE),
    ]
    paras = [p(r(f"{lbl}: {SAMPLE}", sz=14), mar_l=0.35, indent=-0.3, bullet=bu, spc_aft=("pts", 3)) for lbl, bu in specs]
    rid = s.image(media.png_logo(), "png")
    paras.append(p(r("Picture bullet (buBlip)", sz=14), mar_l=0.35, indent=-0.3,
                   bullet=f'<a:buSzPct val="120000"/><a:buBlip><a:blip r:embed="{rid}"/></a:buBlip>'))
    s.textbox(0.4, 1.4, 9.2, 5.9, *paras)
    s = d.slide(title="Automatic numbering schemes")
    schemes = [("arabicPeriod", None), ("arabicParenR", None), ("arabicParenBoth", None), ("romanUcPeriod", None),
               ("romanLcPeriod", None), ("alphaLcParenR", None), ("alphaUcPeriod", None), ("arabicPeriod", 5)]
    for (x, y, w, h), (sch, start) in zip(grid_cells(4, 2, 0.4, 1.5, 9.2, 5.6), schemes):
        lbl = sch + (f" startAt={start}" if start else "")
        paras = [p(r(lbl, sz=11, b=True, fill="C00000"))]
        paras += [p(r(t, sz=14), mar_l=0.4, indent=-0.4, bullet=bullet_auto(sch, start)) for t in ("Revenue", "Costs", "Profit")]
        s.textbox(x, y, w, h, *paras, line=ln(0.75, "BFBFBF"))
    s = d.slide("Title and Content", "Five levels inherited from the master")
    tf = s.s.placeholders[1].text_frame
    tf.text = "Level 1 (master lvl1pPr)"
    for lvl in range(1, 5):
        para = tf.add_paragraph()
        para.text = f"Level {lvl + 1} (master lvl{lvl + 1}pPr)"
        para.level = lvl
    para = tf.add_paragraph()
    para.text = "Back to level 1"
    s = d.slide(title="Five levels with a custom list style and numbering")
    lst = ("<a:lstStyle>" + "".join(
        f'<a:lvl{i + 1}pPr marL="{inch(0.35 + 0.45 * i)}" indent="{inch(-0.3)}">{bu}<a:defRPr sz="{2000 - 200 * i}"/></a:lvl{i + 1}pPr>'
        for i, bu in enumerate([bullet_auto("arabicPeriod", color="C00000"), bullet_char("–", "Arial"),
                                bullet_auto("alphaLcParenR"), bullet_char("»", "Arial", color="scheme:accent1"),
                                bullet_auto("romanLcPeriod")])) + "</a:lstStyle>")
    paras = []
    for lvl, t in [(0, "First item"), (1, "Detail a"), (1, "Detail b"), (2, "Sub-detail"), (2, "Sub-detail"),
                   (3, "Deep point"), (4, "Deepest"), (4, "Deepest"), (0, "Second item (numbering continues)"),
                   (1, "Detail restarts")]:
        paras.append(p(r(t, sz=None), lvl=lvl if lvl else None))
    s.textbox(0.4, 1.4, 9.2, 5.9, *paras, lst_style=lst)
    return d


def deck_text_autofit() -> Deck:
    d = Deck("text-autofit-vertical-columns", "Text: autofit, overflow, wrap none, vertical text, columns, rotation",
             "normAutofit with fontScale/lnSpcReduction, spAutoFit, noAutofit overflow, vertOverflow clip/ellipsis, "
             "wrap=none, vert/vert270/eaVert/wordArtVert/mongolianVert/wordArtVertRtl, numCol columns, rotated "
             "and flipped text boxes and bodyPr rot.",
             ["text", "autofit", "overflow", "wrap-none", "vertical-text", "text-columns", "rotation", "flip"])
    s = d.slide(title="Autofit and overflow")
    long_paras = [p(r(LONG_TEXT, sz=18))]
    s.textbox(0.4, 1.5, 2.9, 2.6, *long_paras, autofit=("norm", 62.5, 20), line=ln(1, "C00000"))
    s.label(0.4, 4.15, 2.9, 0.3, "normAutofit fontScale 62.5% lnSpcReduction 20%", sz=9)
    s.textbox(3.55, 1.5, 2.9, 2.6, *long_paras, autofit="none", line=ln(1, "C00000"))
    s.label(3.55, 1.2, 2.9, 0.3, "noAutofit: overflows the box", sz=9)
    s.textbox(6.7, 1.5, 2.9, 1.1, p(r("spAutoFit: box hugs its text", sz=18)), autofit="shape", line=ln(1, "C00000"))
    s.textbox(0.4, 4.9, 2.9, 1.2, *long_paras, vert_overflow="clip", line=ln(1, "0070C0"))
    s.label(0.4, 6.15, 2.9, 0.3, "vertOverflow=clip", sz=9)
    s.textbox(3.55, 4.9, 2.9, 1.2, *long_paras, vert_overflow="ellipsis", line=ln(1, "0070C0"))
    s.label(3.55, 6.15, 2.9, 0.3, "vertOverflow=ellipsis", sz=9)
    s.textbox(6.7, 4.9, 2.9, 1.2, *long_paras, autofit=("norm", None, None), line=ln(1, "0070C0"))
    s.label(6.7, 6.15, 2.9, 0.3, "normAutofit without stored scale", sz=9)
    s = d.slide(title="wrap=none and horizontal overflow")
    for i, al in enumerate(["l", "ctr", "r"]):
        y = 1.6 + i * 1.6
        s.shape(3.5, y, 3.0, 1.0, fill=solid("DEEBF7"), line=ln(1, "2F5597"))
        s.textbox(3.5, y, 3.0, 1.0, p(r(f"wrap=none algn={al}: this line is wider than its box", sz=18), algn=al),
                  wrap="none", anchor="ctr")
    s.textbox(1.0, 6.4, 8.0, 0.8, p(r("Box with wrap=square, horzOverflow=clip: " + "words " * 20, sz=14)),
              horz_overflow="clip", line=ln(1, "7F7F7F"))
    s = d.slide(title="Vertical text types")
    verts = ["vert", "vert270", "eaVert", "wordArtVert", "mongolianVert", "wordArtVertRtl"]
    for (x, y, w, h), v in zip(grid_cells(6, 1, 0.4, 1.5, 9.2, 5.0), verts):
        s.textbox(x, y, w, h, p(r(f"{v}: Budget 2024 予算", sz=18, ea="MS Gothic")), vert=v,
                  line=ln(0.75, "7F7F7F"), fill=solid("F2F2F2"))
        s.label(x, 6.6, w, 0.4, v, sz=10)
    s = d.slide(title="Columns")
    s.textbox(0.4, 1.5, 9.2, 2.3, p(r(LONG_TEXT + " " + LONG_TEXT + " " + LONG_TEXT, sz=14)), num_col=2, spc_col=0.4,
              line=ln(0.75, "7F7F7F"))
    s.textbox(0.4, 4.2, 9.2, 2.2, p(r(" ".join([LONG_TEXT] * 4), sz=12)), num_col=3, spc_col=0.25,
              line=ln(0.75, "7F7F7F"))
    s.textbox(0.4, 6.6, 9.2, 0.7, p(r("rtlCol=1: columns fill right to left. " + LONG_TEXT, sz=8)), num_col=2,
              spc_col=0.3, rtl_col=True, line=ln(0.75, "7F7F7F"))
    s = d.slide(title="Rotated, flipped and bodyPr-rotated text")
    for i, rot in enumerate([0, 30, 90, 180, 270, 330]):
        x = 0.5 + (i % 3) * 3.1
        y = 1.6 + (i // 3) * 2.0
        s.textbox(x, y, 2.5, 0.9, p(r(f"Text box rot={rot}", sz=16), algn="ctr"), rot=rot, anchor="ctr",
                  line=ln(1, "2F5597"), fill=solid("DEEBF7"))
    for i, (fh, fv, brot) in enumerate([(True, False, None), (False, True, None), (False, False, 90),
                                        (False, False, -90)]):
        x = 0.4 + i * 2.35
        label_ = ("flipH" if fh else "") + ("flipV" if fv else "") + (f"bodyPr rot={brot}" if brot else "")
        sid = s.nid()
        s.add(sp(sid, f"Arrow {sid}", inch(x), inch(5.6), inch(2.1), inch(1.3), geom="rightArrow",
                 fill=solid("FBE5D6"), line=ln(1, "C55A11"), flip_h=fh, flip_v=fv,
                 text=body(p(r(label_, sz=14), algn="ctr"), anchor="ctr", rot=brot)))
    return d


def deck_text_unicode() -> Deck:
    d = Deck("text-unicode", "Text: Unicode scripts, RTL, CJK, emoji, math",
             "Accented Latin, Greek, Cyrillic, CJK (Chinese, Japanese, Korean) with ea fonts, Arabic and Hebrew "
             "right-to-left paragraphs with cs fonts, Thai, emoji, combining marks, currency and math symbols.",
             ["text", "unicode", "rtl", "cjk", "emoji", "math-symbols"])
    s = d.slide(title="Latin, Greek, Cyrillic")
    rows = ["Français: « Économie déjà prévue » — çà et là, œuvre",
            "Deutsch: Größenänderung übermäßig Straße ẞ",
            "Polski: Zażółć gęślą jaźń; Čeština: Příliš žluťoučký kůň",
            "Tiếng Việt: Ngân sách năm nay được điều chỉnh",
            "Ελληνικά: Ο προϋπολογισμός του έτους αυξήθηκε κατά 5%",
            "Русский: Бюджет на 2024 год утверждён; Українська: Ґрунт їжак",
            "Combining marks: é ä ñ ộ (decomposed)"]
    s.textbox(0.4, 1.4, 9.2, 5.8, *[p(r(t, sz=20)) for t in rows])
    s = d.slide(title="CJK and Thai")
    rows = [("简体中文：年度预算报告，收入增长百分之十二。", "SimSun"), ("繁體中文：年度預算報告與財務報表", "PMingLiU"),
            ("日本語：売上高は前年比１２％増加しました。カタカナ・ひらがな", "MS Gothic"),
            ("한국어: 연간 예산 보고서 및 재무제표", "Malgun Gothic"),
            ("Mixed: Revenue 収益 $12.5M 增长", "MS Mincho"), ("ไทย: งบประมาณประจำปี", "Tahoma")]
    s.textbox(0.4, 1.4, 9.2, 5.8, *[p(r(t, sz=22, ea=f, cs=f, lang=("th-TH" if "ไทย" in t else "en-US"))) for t, f in rows])
    s = d.slide(title="Right-to-left: Arabic and Hebrew")
    s.textbox(0.4, 1.4, 9.2, 2.6,
              p(r("الميزانية السنوية للعام ٢٠٢٤ زادت بنسبة ١٢٪", sz=26, cs="Arial", lang="ar-SA"), rtl=True, algn="r"),
              p(r("التقرير المالي: الإيرادات 12.5 مليون دولار", sz=22, cs="Arial", lang="ar-SA"), rtl=True, algn="r"),
              p(r("Mixed LTR inside RTL: ", sz=18), r("الإيرادات Revenue 2024", sz=18, cs="Arial", lang="ar-SA"),
                rtl=True, algn="r"), line=ln(0.75, "BFBFBF"))
    s.textbox(0.4, 4.3, 9.2, 2.8,
              p(r("התקציב השנתי עלה ב-12% לעומת השנה הקודמת", sz=26, cs="Arial", lang="he-IL"), rtl=True, algn="r"),
              p(r("דוח כספי רבעוני – הכנסות והוצאות", sz=22, cs="Arial", lang="he-IL"), rtl=True, algn="r"),
              p(r("RTL paragraph, left aligned", sz=18, cs="Arial"), rtl=True, algn="l"), line=ln(0.75, "BFBFBF"))
    s = d.slide(title="Emoji, currency, math and symbols")
    rows = ["Emoji: 😀 🎉 📈 📉 💰 🏦 ✅ ❌ 👨‍👩‍👧 🇺🇸",
            "Currency: $ € £ ¥ ₹ ₩ ₽ ₿ ¢ ₪ ₫",
            "Math: ∑ ∏ ∫ √ ∞ ≤ ≥ ≠ ≈ ± × ÷ ∂ ∆ π θ µ ‰",
            "Arrows & shapes: ← → ↑ ↓ ⇒ ⇔ ■ □ ● ○ ◆ ★ ☆ ✓ ✗",
            "Typography: “quotes” ‘single’ – en — em … • † ‡ § ¶ © ® ™",
            "Box drawing: ┌─┬─┐ │ ├─┼─┤ └─┴─┘",
            "Fractions: ½ ¼ ¾ ⅓ ⅔ ⅛  Superscripts: x² y³ 10⁻⁶"]
    s.textbox(0.4, 1.4, 9.2, 5.8, *[p(r(t, sz=22, sym="Segoe UI Emoji" if "Emoji" in t else None)) for t in rows])
    return d


# =============================================================================
# Placeholders, inheritance, themes
# =============================================================================

def deck_placeholders() -> Deck:
    d = Deck("placeholders-all-layouts", "Placeholders: every layout of the default template",
             "One slide per layout of the default Office template (title slide, title and content, section "
             "header, two content, comparison, title only, blank, content with caption, picture with caption, "
             "vertical layouts) with placeholder text inheriting master/layout formatting.",
             ["placeholders", "layouts", "inheritance", "picture-placeholder"])
    photo = media.jpeg_photo()
    for lay in d.prs.slide_layouts:
        s = d.prs.slides.add_slide(lay)
        w = Slide(d, s)
        for ph in s.placeholders:
            t = ph.placeholder_format.type
            idx = ph.placeholder_format.idx
            name = getattr(t, "name", str(t))
            if idx == 0:
                ph.text_frame.text = f"{lay.name}"
            elif "PICTURE" in name:
                ph.insert_picture(io.BytesIO(photo))
            elif "SUBTITLE" in name:
                ph.text_frame.text = "Subtitle placeholder (idx 1)"
            else:
                tf = ph.text_frame
                tf.text = f"Placeholder idx {idx} ({name.lower()})"
                if name == "BODY" and lay.name not in ("Title and Vertical Text", "Vertical Title and Text"):
                    continue  # small heading/caption placeholders: one line only
                for lvl, txt in ((0, "Revenue up 12%"), (1, "Subscriptions"), (1, "Services"), (0, "Costs flat")):
                    para = tf.add_paragraph()
                    para.text = txt
                    para.level = lvl
        if lay.name == "Blank":
            w.textbox(1, 3, 8, 1.5, p(r("Blank layout: only a text box on this slide", sz=24), algn="ctr"),
                      anchor="ctr", line=ln(1, "7F7F7F"))
        if lay.name == "Title Only":
            w.shape(2.5, 2.5, 5, 3, geom="roundRect", fill=solid("scheme:accent1"),
                    text=body(p(r("Shape under a title-only layout", sz=20, fill="FFFFFF"), algn="ctr"), anchor="ctr"))
    return d


def deck_inheritance() -> Deck:
    d = Deck("inheritance-master-layout", "Placeholders: master/layout/shape inheritance and overrides",
             "Body text inheriting the master text styles; a shape-level lstStyle override plus paragraph and run "
             "overrides; a layout whose title placeholder is restyled; slide clrMapOvr remapping bg/tx to a dark "
             "scheme; placeholder geometry override; text box vs autoshape default text.",
             ["placeholders", "inheritance", "lstStyle", "clrmap-override", "layout-override"])
    # Restyle the Title Only layout's title placeholder (layout overrides master).
    lay = d.layout("Title Only")
    for ph in lay.placeholders:
        if ph.placeholder_format.idx == 0:
            sppr = ph._element.spPr
            sppr.append(parse(solid("scheme:accent1", "lumMod=75000")))
            txb = ph._element.txBody
            lst = txb.find(qn("a:lstStyle"))
            txb.replace(lst, parse('<a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1" cap="all">'
                                   f'{solid("scheme:bg1")}<a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></a:lstStyle>'))
    texts = [(0, "Level 1 text"), (1, "Level 2 text"), (2, "Level 3 text"), (3, "Level 4 text"), (4, "Level 5 text")]
    s = d.slide("Title and Content", "Body text inherits master text styles")
    tf = s.s.placeholders[1].text_frame
    tf.text = texts[0][1]
    for lvl, t in texts[1:]:
        para = tf.add_paragraph()
        para.text = t
        para.level = lvl
    s = d.slide("Title and Content", "Shape lstStyle, paragraph and run overrides")
    ph = s.s.placeholders[1]
    lst = ('<a:lstStyle><a:lvl1pPr marL="342900" indent="-342900">'
           f'<a:buClr>{clr("scheme:accent2")}</a:buClr><a:buFont typeface="Wingdings" pitchFamily="2" charset="2"/>'
           '<a:buChar char="Ø"/><a:defRPr sz="2600" b="1">' + solid("scheme:accent1") + '</a:defRPr></a:lvl1pPr>'
           '<a:lvl2pPr marL="742950" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="–"/>'
           '<a:defRPr sz="2000" i="1"/></a:lvl2pPr></a:lstStyle>')
    paras = [p(r("Level 1 from shape lstStyle")), p(r("Level 2 from shape lstStyle"), lvl=1),
             p(r("Paragraph override: centered, no bullet"), algn="ctr", bullet=BU_NONE),
             p(r("Run overrides: "), r("red", fill="C00000"), r(" / "), r("14pt", sz=14), r(" / "),
               r("Courier", latin="Courier New")),
             p(r("Level 3 falls back to the master"), lvl=2)]
    ph._element.replace(ph._element.txBody, parse(body(*paras, lst_style=lst)))
    s = d.slide("Title Only", "Layout-restyled title (filled, caps)")
    s.textbox(0.6, 2.0, 8.8, 2.0, p(r("The title above inherits fill, size and caps from the Title Only layout, "
                                      "which overrides the master title style.", sz=20)))
    s = d.slide("Title and Content", "clrMapOvr: dark color mapping")
    clrmap = s.s._element.find(qn("p:clrMapOvr"))
    clrmap.getparent().replace(clrmap, parse(
        '<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" '
        'accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" '
        'hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>'))
    s.background('<p:bgRef idx="1001">' + clr("scheme:bg1") + "</p:bgRef>")
    tf = s.s.placeholders[1].text_frame
    tf.text = "Background bg1 now maps to dk1 (dark), text tx1 maps to lt1"
    tf.add_paragraph().text = "Scheme-colored shapes follow the override"
    for i, c in enumerate(["bg1", "tx1", "bg2", "tx2", "accent1"]):
        s.shape(0.6 + i * 1.8, 5.4, 1.5, 1.2, fill=solid(f"scheme:{c}"), line=ln(1, "scheme:tx1"),
                text=body(p(r(c, sz=14, fill=solid("scheme:accent2")), algn="ctr"), anchor="ctr"))
    s = d.slide("Title and Content", "Placeholder geometry override")
    t = s.s.shapes.title
    t.left, t.top, t.width, t.height = Inches(5.5), Inches(5.6), Inches(4.0), Inches(1.5)
    tf = s.s.placeholders[1].text_frame
    tf.text = "The title was moved to the bottom right via an explicit xfrm; this body keeps the layout geometry."
    s = d.slide("Blank")
    s.textbox(0.5, 0.5, 9, 1.2, p(r("Text box: inherits presentation defaultTextStyle (18pt, tx1)")),
              line=ln(0.75, "7F7F7F"))
    sid = s.nid()
    s.add(sp(sid, "Styled autoshape", inch(0.5), inch(2.0), inch(9), inch(1.6), geom="roundRect",
             style=style_ref(1, 3, 2), text=body(p(r("Autoshape with p:style: fill/line/effect/font from theme refs")),
                                                  anchor="ctr")))
    sid = s.nid()
    s.add(sp(sid, "Plain autoshape", inch(0.5), inch(4.2), inch(9), inch(1.6), geom="rect", fill=solid("FFF2CC"),
             line=ln(1, "BF9000"), text=body(p(r("Autoshape without p:style: default text, anchored top")))))
    return d


def custom_theme(deck: Deck) -> None:
    part = deck.theme_part()
    root = etree.fromstring(part.blob)
    a = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    root.set("name", "Corpus Custom Theme")
    scheme = root.find(f".//{a}clrScheme")
    scheme.set("name", "Corpus Custom")
    colors = {"dk1": "1A1A2E", "lt1": "FFFFFF", "dk2": "16425B", "lt2": "EFE9DD", "accent1": "D1495B",
              "accent2": "EDAE49", "accent3": "00798C", "accent4": "30638E", "accent5": "6A994E",
              "accent6": "8E5572", "hlink": "0563C1", "folHlink": "954F72"}
    for name, val in colors.items():
        el = scheme.find(f"{a}{name}")
        for child in list(el):
            el.remove(child)
        etree.SubElement(el, f"{a}srgbClr", val=val)
    fonts = root.find(f".//{a}fontScheme")
    fonts.set("name", "Corpus Fonts")
    fonts.find(f"{a}majorFont/{a}latin").set("typeface", "Times New Roman")
    fonts.find(f"{a}minorFont/{a}latin").set("typeface", "Arial")
    part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def deck_theme_custom() -> Deck:
    d = Deck("theme-custom-colors-fonts", "Theme: custom color scheme, font scheme and style matrix",
             "A modified theme (custom clrScheme, major Times New Roman / minor Arial): swatches of all 12 scheme "
             "colors with PowerPoint palette tints/shades, +mj/+mn font references, the fill/line/effect style "
             "matrix via p:style refs, hyperlink colors and a theme background (bgRef 1003).",
             ["theme", "scheme-colors", "theme-fonts", "style-refs", "bg-ref", "hyperlink"])
    custom_theme(d)
    s = d.slide(title="Scheme colors with tints and shades")
    names = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
    variants = [(), ("lumMod=20000", "lumOff=80000"), ("lumMod=40000", "lumOff=60000"), ("lumMod=60000", "lumOff=40000"),
                ("lumMod=75000",), ("lumMod=50000",)]
    for ci, n in enumerate(names):
        x = 0.35 + ci * 0.78
        s.label(x, 1.45, 0.75, 0.3, n, sz=8)
        for vi, mods in enumerate(variants):
            s.shape(x, 1.8 + vi * 0.85, 0.72, 0.78, fill=solid(f"scheme:{n}", *mods), line=ln(0.5, "A6A6A6"))
    s = d.slide(title="Theme fonts: +mj-lt (Times New Roman) and +mn-lt (Arial)")
    s.textbox(0.5, 1.5, 9, 5.5,
              p(r("+mj-lt major font: Quarterly results", sz=28, latin="+mj-lt")),
              p(r("+mn-lt minor font: Quarterly results", sz=28, latin="+mn-lt")),
              p(r("No typeface: inherits minor font from defaultTextStyle", sz=28)),
              p(r("Explicit Courier New for contrast", sz=28, latin="Courier New")),
              p(r("Hyperlink uses the hlink scheme color", sz=24, hlink=f'<a:hlinkClick r:id="{s.link("https://example.com/")}"/>')))
    s = d.slide(title="Style matrix: fillRef x effectRef (lnRef 2, accent colors)")
    for fi in range(4):
        for ei in range(4):
            sid = s.nid()
            col = f"scheme:accent{(fi + ei) % 6 + 1}"
            s.add(sp(sid, f"style f{fi} e{ei}", inch(1.0 + ei * 2.2), inch(1.6 + fi * 1.4), inch(1.8), inch(1.0),
                     geom="roundRect", style=style_ref(2, fi, ei, ln_clr=col, fill_clr=col, effect_clr=col,
                                                       font_clr="scheme:dk1" if fi == 0 else "scheme:lt1"),
                     text=body(p(r(f"fillRef {fi} / effectRef {ei}", sz=11), algn="ctr"), anchor="ctr")))
    s = d.slide("Title Only", "Theme background: bgRef idx=1003 with accent3")
    s.background('<p:bgRef idx="1003">' + clr("scheme:accent3") + "</p:bgRef>")
    s.textbox(1, 2.5, 8, 2, p(r("bgFillStyleLst entry 3 (path gradient) tinted with accent3", sz=24, fill="FFFFFF"),
                              algn="ctr"), anchor="ctr")
    return d


# =============================================================================
# Shapes
# =============================================================================

PRESETS = [
    "line", "lineInv", "triangle", "rtTriangle", "rect", "diamond", "parallelogram", "trapezoid",
    "nonIsoscelesTrapezoid", "pentagon", "hexagon", "heptagon", "octagon", "decagon", "dodecagon", "star4",
    "star5", "star6", "star7", "star8", "star10", "star12", "star16", "star24", "star32", "roundRect",
    "round1Rect", "round2SameRect", "round2DiagRect", "snipRoundRect", "snip1Rect", "snip2SameRect",
    "snip2DiagRect", "plaque", "ellipse", "teardrop", "homePlate", "chevron", "pieWedge", "pie", "blockArc",
    "donut", "noSmoking", "rightArrow", "leftArrow", "upArrow", "downArrow", "stripedRightArrow",
    "notchedRightArrow", "bentUpArrow", "leftRightArrow", "upDownArrow", "leftUpArrow", "leftRightUpArrow",
    "quadArrow", "leftArrowCallout", "rightArrowCallout", "upArrowCallout", "downArrowCallout",
    "leftRightArrowCallout", "upDownArrowCallout", "quadArrowCallout", "bentArrow", "uturnArrow",
    "circularArrow", "leftCircularArrow", "leftRightCircularArrow", "curvedRightArrow", "curvedLeftArrow",
    "curvedUpArrow", "curvedDownArrow", "swooshArrow", "cube", "can", "lightningBolt", "heart", "sun", "moon",
    "smileyFace", "irregularSeal1", "irregularSeal2", "foldedCorner", "bevel", "frame", "halfFrame", "corner",
    "diagStripe", "chord", "arc", "leftBracket", "rightBracket", "leftBrace", "rightBrace", "bracketPair",
    "bracePair", "straightConnector1", "bentConnector2", "bentConnector3", "bentConnector4", "bentConnector5",
    "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5", "callout1", "callout2",
    "callout3", "accentCallout1", "accentCallout2", "accentCallout3", "borderCallout1", "borderCallout2",
    "borderCallout3", "accentBorderCallout1", "accentBorderCallout2", "accentBorderCallout3",
    "wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout", "cloudCallout", "cloud", "ribbon",
    "ribbon2", "ellipseRibbon", "ellipseRibbon2", "leftRightRibbon", "verticalScroll", "horizontalScroll",
    "wave", "doubleWave", "plus", "flowChartProcess", "flowChartDecision", "flowChartInputOutput",
    "flowChartPredefinedProcess", "flowChartInternalStorage", "flowChartDocument", "flowChartMultidocument",
    "flowChartTerminator", "flowChartPreparation", "flowChartManualInput", "flowChartManualOperation",
    "flowChartConnector", "flowChartPunchedCard", "flowChartPunchedTape", "flowChartSummingJunction",
    "flowChartOr", "flowChartCollate", "flowChartSort", "flowChartExtract", "flowChartMerge",
    "flowChartOfflineStorage", "flowChartOnlineStorage", "flowChartMagneticTape", "flowChartMagneticDisk",
    "flowChartMagneticDrum", "flowChartDisplay", "flowChartDelay", "flowChartAlternateProcess",
    "flowChartOffpageConnector", "actionButtonBlank", "actionButtonHome", "actionButtonHelp",
    "actionButtonInformation", "actionButtonForwardNext", "actionButtonBackPrevious", "actionButtonEnd",
    "actionButtonBeginning", "actionButtonReturn", "actionButtonDocument", "actionButtonSound",
    "actionButtonMovie", "gear6", "gear9", "funnel", "mathPlus", "mathMinus", "mathMultiply", "mathDivide",
    "mathEqual", "mathNotEqual", "cornerTabs", "squareTabs", "plaqueTabs", "chartX", "chartStar", "chartPlus",
]
LINE_LIKE = {"line", "lineInv", "straightConnector1", "bentConnector2", "bentConnector3", "bentConnector4",
             "bentConnector5", "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5", "arc",
             "leftBracket", "rightBracket", "leftBrace", "rightBrace", "bracketPair", "bracePair"}


def deck_shapes_presets() -> Deck:
    d = Deck("shapes-presets-all", "Shapes: all 187 preset geometries",
             "Every ST_ShapeType preset geometry with default adjust values, a solid fill, outline and short text "
             "(exercising each preset's text rectangle). Line-like presets get a thick arrowed outline.",
             ["shapes", "preset-geometry", "text-in-shapes"])
    per = 24
    for page in range(0, len(PRESETS), per):
        chunk = PRESETS[page:page + per]
        s = d.slide(title=f"Preset geometries {page + 1}-{page + len(chunk)}", title_size=24)
        for i, (x, y, w, h) in enumerate(grid_cells(6, 4, 0.3, 1.35, 9.4, 5.95, 0.2, 0.12)):
            if i >= len(chunk):
                break
            name = chunk[i]
            col = ACCENTS[i % len(ACCENTS)]
            sh = h - 0.3
            if name in LINE_LIKE:
                fill, line = NOFILL, ln(3, col, tail=("triangle", "med", "med"))
                text = None
            else:
                fill, line = solid(col, "lumMod=60000", "lumOff=40000"), ln(1.25, col, join="round")
                text = body(p(r("Ab", sz=11, fill="000000"), algn="ctr"), anchor="ctr", ins=(0, 0, 0, 0))
            sid = s.nid()
            s.add(sp(sid, name, inch(x + 0.12), inch(y), inch(w - 0.24), inch(sh), geom=name, fill=fill,
                     line=line, text=text))
            s.label(x - 0.05, y + sh, w + 0.1, 0.28, name, sz=8)
    return d


def deck_shapes_adjust() -> Deck:
    d = Deck("shapes-adjust-values", "Shapes: adjust values (avLst) including out-of-range clamping",
             "Preset geometries drawn with several adjust-value combinations each: roundRect, star5, rightArrow, "
             "chevron, donut, blockArc, arc, pie, chord, can, cube, bevel, callouts, trapezoid, parallelogram, "
             "brace, frame, teardrop, gear, circularArrow, mathNotEqual, plus a clamped out-of-range value.",
             ["shapes", "adjust-values", "preset-geometry"])
    rows1 = [
        ("roundRect", [{"adj": 0}, {"adj": 16667}, {"adj": 50000}, {"adj": 90000}]),
        ("star5", [{"adj": 5000}, {"adj": 19098}, {"adj": 40000}, {"adj": 19098, "hf": 70000, "vf": 130000}]),
        ("rightArrow", [{"adj1": 20000, "adj2": 30000}, {"adj1": 50000, "adj2": 50000}, {"adj1": 80000, "adj2": 100000}, {"adj1": 100000, "adj2": 20000}]),
        ("chevron", [{"adj": 10000}, {"adj": 50000}, {"adj": 80000}, {"adj": 100000}]),
        ("donut", [{"adj": 5000}, {"adj": 25000}, {"adj": 40000}, {"adj": 50000}]),
        ("blockArc", [{"adj1": 10800000, "adj2": 0, "adj3": 25000}, {"adj1": 5400000, "adj2": 16200000, "adj3": 10000},
                      {"adj1": 0, "adj2": 18000000, "adj3": 40000}, {"adj1": 13500000, "adj2": 8100000, "adj3": 20000}]),
        ("arc", [{"adj1": 16200000, "adj2": 0}, {"adj1": 10800000, "adj2": 0}, {"adj1": 0, "adj2": 10800000}, {"adj1": 2700000, "adj2": 8100000}]),
        ("pie", [{"adj1": 0, "adj2": 16200000}, {"adj1": 5400000, "adj2": 10800000}, {"adj1": 18900000, "adj2": 2700000}, {"adj1": 0, "adj2": 21000000}]),
    ]
    rows2 = [
        ("chord", [{"adj1": 2700000, "adj2": 16200000}, {"adj1": 0, "adj2": 10800000}, {"adj1": 5400000, "adj2": 1}, {"adj1": 12000000, "adj2": 9000000}]),
        ("can", [{"adj": 5000}, {"adj": 25000}, {"adj": 50000}, {"adj": 100000}]),
        ("cube", [{"adj": 5000}, {"adj": 25000}, {"adj": 50000}, {"adj": 100000}]),
        ("bevel", [{"adj": 0}, {"adj": 12500}, {"adj": 30000}, {"adj": 50000}]),
        ("wedgeRectCallout", [{"adj1": -20833, "adj2": 62500}, {"adj1": 60000, "adj2": 80000}, {"adj1": -80000, "adj2": -70000}, {"adj1": 0, "adj2": 0}]),
        ("borderCallout1", [{"adj1": 18750, "adj2": -8333, "adj3": 112500, "adj4": -38333}, {"adj1": 50000, "adj2": 100000, "adj3": 120000, "adj4": 140000},
                            {"adj1": 0, "adj2": 50000, "adj3": -60000, "adj4": 70000}, {"adj1": 100000, "adj2": 0, "adj3": 150000, "adj4": -30000}]),
        ("trapezoid", [{"adj": 0}, {"adj": 25000}, {"adj": 50000}, {"adj": 80000}]),
        ("parallelogram", [{"adj": 0}, {"adj": 25000}, {"adj": 60000}, {"adj": 100000}]),
    ]
    rows3 = [
        ("leftBrace", [{"adj1": 8333, "adj2": 50000}, {"adj1": 25000, "adj2": 25000}, {"adj1": 4000, "adj2": 85000}, {"adj1": 50000, "adj2": 50000}]),
        ("frame", [{"adj1": 5000}, {"adj1": 12500}, {"adj1": 30000}, {"adj1": 50000}]),
        ("teardrop", [{"adj": 0}, {"adj": 100000}, {"adj": 150000}, {"adj": 200000}]),
        ("gear6", [{"adj1": 5000, "adj2": 1000}, {"adj1": 15000, "adj2": 3526}, {"adj1": 20000, "adj2": 10000}, {"adj1": 10000, "adj2": 5000}]),
        ("circularArrow", [{}, {"adj1": 25000, "adj2": 1142319, "adj3": 20457681, "adj4": 10800000, "adj5": 12500},
                           {"adj1": 5000, "adj2": 600000, "adj3": 15000000, "adj4": 5400000, "adj5": 5000}, {"adj5": 25000}]),
        ("mathNotEqual", [{}, {"adj1": 10000, "adj2": 8000000, "adj3": 5000}, {"adj1": 20000, "adj2": 6600000, "adj3": 23520}, {"adj1": 5000, "adj2": 4800000, "adj3": 15000}]),
        ("plaque", [{"adj": 0}, {"adj": 16667}, {"adj": 35000}, {"adj": 50000}]),
        ("homePlate", [{"adj": 10000}, {"adj": 50000}, {"adj": 90000}, {"adj": 200000}]),
    ]
    for title_, rows in (("Adjust values 1/3", rows1), ("Adjust values 2/3", rows2), ("Adjust values 3/3", rows3)):
        s = d.slide(title=title_, title_size=24)
        for ri, (prst, avs) in enumerate(rows):
            y = 1.35 + ri * 0.75
            s.label(0.2, y + 0.18, 1.6, 0.35, prst, sz=10, algn="r")
            for ci, av in enumerate(avs):
                x = 2.0 + ci * 1.95
                col = ACCENTS[ri % len(ACCENTS)]
                line_only = prst in ("arc", "leftBrace")
                sid = s.nid()
                s.add(sp(sid, f"{prst} {ci}", inch(x), inch(y), inch(1.2), inch(0.62), geom=prst, av=av,
                         fill=NOFILL if line_only else solid(col, "lumMod=60000", "lumOff=40000"),
                         line=ln(2 if line_only else 1, col)))
                s.label(x + 1.22, y + 0.05, 0.75, 0.6, " ".join(f"{k}={v}" for k, v in av.items()) or "defaults", sz=6, algn="l")
    return d


def deck_shapes_transforms() -> Deck:
    d = Deck("shapes-rotation-flip", "Shapes: rotation, flips and text in transformed shapes",
             "Shapes with text at rotations 0-330 degrees, flipH/flipV/both on asymmetric presets (text is not "
             "mirrored; flipV turns text upside down), rotation+flip combinations, and line shapes whose direction "
             "is encoded with flips.", ["shapes", "rotation", "flip", "text-in-shapes", "lines"])
    s = d.slide(title="Rotation (text rotates with the shape)")
    for i, rot in enumerate([0, 30, 45, 90, 135, 180, 270, 315]):
        x = 0.5 + (i % 4) * 2.35
        y = 1.8 + (i // 4) * 2.6
        sid = s.nid()
        s.add(sp(sid, f"rot {rot}", inch(x), inch(y), inch(1.9), inch(1.0), geom="rightArrow", rot=rot,
                 fill=solid("scheme:accent1", "lumMod=40000", "lumOff=60000"), line=ln(1.5, "scheme:accent1"),
                 text=body(p(r(f"rot={rot}", sz=14), algn="ctr"), anchor="ctr")))
    s = d.slide(title="Flips on asymmetric shapes")
    shapes_ = ["rtTriangle", "homePlate", "wedgeRectCallout", "curvedRightArrow"]
    flips = [(False, False), (True, False), (False, True), (True, True)]
    for ri, prst in enumerate(shapes_):
        for ci, (fh, fv) in enumerate(flips):
            sid = s.nid()
            lbl = ("flipH " if fh else "") + ("flipV" if fv else "") or "none"
            s.add(sp(sid, f"{prst} {lbl}", inch(0.7 + ci * 2.3), inch(1.4 + ri * 1.5), inch(1.6), inch(1.1),
                     geom=prst, flip_h=fh, flip_v=fv, fill=solid(ACCENTS[ri], "lumMod=60000", "lumOff=40000"),
                     line=ln(1.25, ACCENTS[ri]), text=body(p(r(lbl, sz=12), algn="ctr"), anchor="ctr")))
    s = d.slide(title="Rotation combined with flips; lines encoded with flips")
    for i, (rot, fh, fv) in enumerate([(30, False, False), (30, True, False), (30, False, True), (30, True, True)]):
        sid = s.nid()
        s.add(sp(sid, f"combo {i}", inch(0.5 + i * 2.35), inch(1.7), inch(1.8), inch(1.1), geom="flowChartManualInput",
                 rot=rot, flip_h=fh, flip_v=fv, fill=solid("FBE5D6"), line=ln(1.5, "C55A11"),
                 text=body(p(r(f"rot 30 {'H' if fh else ''}{'V' if fv else ''}", sz=12), algn="ctr"), anchor="ctr")))
    for i, (fh, fv) in enumerate([(False, False), (True, False), (False, True), (True, True)]):
        x = 0.7 + i * 2.35
        sid = s.nid()
        s.add(sp(sid, f"line {i}", inch(x), inch(4.0), inch(1.6), inch(1.4), geom="line", flip_h=fh, flip_v=fv,
                 fill=None, line=ln(3, "2F5597", tail=("triangle", "lg", "lg"), head=("oval", "med", "med"))))
        s.label(x - 0.2, 5.6, 2.0, 0.4, f"line flipH={int(fh)} flipV={int(fv)}", sz=10)
    sid = s.nid()
    s.add(sp(sid, "rotated line", inch(4), inch(6.3), inch(2.0), inch(0), geom="line", rot=20,
             line=ln(4, "C00000", tail=("stealth", "lg", "lg"))))
    return d


def custgeom(paths: list[str], gd: str = "", av: str = "", cxn_: str = "", rect: str | None = None) -> str:
    rect_xml = rect or '<a:rect l="l" t="t" r="r" b="b"/>'
    return (f"<a:custGeom><a:avLst>{av}</a:avLst><a:gdLst>{gd}</a:gdLst><a:ahLst/><a:cxnLst>{cxn_}</a:cxnLst>"
            f"{rect_xml}<a:pathLst>{''.join(paths)}</a:pathLst></a:custGeom>")


def deck_shapes_custgeom() -> Deck:
    d = Deck("shapes-custom-geometry", "Shapes: custom geometry (custGeom paths)",
             "custGeom with moveTo/lnTo/close, cubicBezTo, quadBezTo, arcTo, multiple sub-paths, fill=none and "
             "stroke=0 paths, path coordinate spaces differing from the shape size, guide formulas, connection "
             "sites, a custom text rectangle, darken/lighten path fills and an open freeform polyline.",
             ["shapes", "custgeom", "bezier", "arcto"])
    s = d.slide(title="custGeom path commands")
    house = custgeom(['<a:path w="100" h="100"><a:moveTo><a:pt x="50" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="45"/></a:lnTo>'
                      '<a:lnTo><a:pt x="85" y="45"/></a:lnTo><a:lnTo><a:pt x="85" y="100"/></a:lnTo><a:lnTo><a:pt x="15" y="100"/></a:lnTo>'
                      '<a:lnTo><a:pt x="15" y="45"/></a:lnTo><a:lnTo><a:pt x="0" y="45"/></a:lnTo><a:close/></a:path>'])
    wave = custgeom(['<a:path w="400" h="100"><a:moveTo><a:pt x="0" y="50"/></a:moveTo>'
                     '<a:cubicBezTo><a:pt x="100" y="-30"/><a:pt x="100" y="130"/><a:pt x="200" y="50"/></a:cubicBezTo>'
                     '<a:cubicBezTo><a:pt x="300" y="-30"/><a:pt x="300" y="130"/><a:pt x="400" y="50"/></a:cubicBezTo>'
                     '<a:lnTo><a:pt x="400" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path>'])
    quad = custgeom(['<a:path w="200" h="200"><a:moveTo><a:pt x="0" y="200"/></a:moveTo>'
                     '<a:quadBezTo><a:pt x="100" y="-150"/><a:pt x="200" y="200"/></a:quadBezTo><a:close/></a:path>'])
    tab = custgeom(['<a:path w="300" h="200"><a:moveTo><a:pt x="0" y="200"/></a:moveTo><a:lnTo><a:pt x="0" y="50"/></a:lnTo>'
                    '<a:arcTo wR="50" hR="50" stAng="10800000" swAng="5400000"/><a:lnTo><a:pt x="250" y="0"/></a:lnTo>'
                    '<a:arcTo wR="50" hR="50" stAng="16200000" swAng="5400000"/><a:lnTo><a:pt x="300" y="200"/></a:lnTo>'
                    '<a:close/></a:path>'])
    pie3 = custgeom([f'<a:path w="200" h="200"><a:moveTo><a:pt x="100" y="100"/></a:moveTo><a:lnTo><a:pt x="200" y="100"/></a:lnTo>'
                     f'<a:arcTo wR="100" hR="100" stAng="0" swAng="{ang}"/><a:close/></a:path>' for ang in (8100000,)] +
                    ['<a:path w="200" h="200" fill="darken"><a:moveTo><a:pt x="100" y="100"/></a:moveTo><a:lnTo><a:pt x="29" y="171"/></a:lnTo>'
                     '<a:arcTo wR="100" hR="100" stAng="8100000" swAng="8100000"/><a:close/></a:path>',
                     '<a:path w="200" h="200" fill="lightenLess"><a:moveTo><a:pt x="100" y="100"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo>'
                     '<a:arcTo wR="100" hR="100" stAng="16200000" swAng="5400000"/><a:close/></a:path>'])
    multi = custgeom(['<a:path w="100" h="100" stroke="0"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo>'
                      '<a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path>',
                      '<a:path w="100" h="100" fill="none"><a:moveTo><a:pt x="10" y="90"/></a:moveTo><a:lnTo><a:pt x="40" y="40"/></a:lnTo>'
                      '<a:lnTo><a:pt x="60" y="60"/></a:lnTo><a:lnTo><a:pt x="90" y="10"/></a:lnTo></a:path>',
                      '<a:path w="100" h="100" fill="lighten" stroke="0"><a:moveTo><a:pt x="20" y="20"/></a:moveTo>'
                      '<a:lnTo><a:pt x="45" y="20"/></a:lnTo><a:lnTo><a:pt x="45" y="45"/></a:lnTo><a:lnTo><a:pt x="20" y="45"/></a:lnTo><a:close/></a:path>'])
    # guide-driven shape: notched banner whose notch depth comes from an adjust value
    guided = custgeom(
        ['<a:path><a:moveTo><a:pt x="l" y="t"/></a:moveTo><a:lnTo><a:pt x="r" y="t"/></a:lnTo><a:lnTo><a:pt x="x2" y="vc"/></a:lnTo>'
         '<a:lnTo><a:pt x="r" y="b"/></a:lnTo><a:lnTo><a:pt x="l" y="b"/></a:lnTo><a:lnTo><a:pt x="x1" y="vc"/></a:lnTo><a:close/></a:path>'],
        av='<a:gd name="adj" fmla="val 30000"/>',
        gd='<a:gd name="a" fmla="pin 0 adj 50000"/><a:gd name="dx" fmla="*/ w a 100000"/><a:gd name="x1" fmla="+- l dx 0"/>'
           '<a:gd name="x2" fmla="+- r 0 dx"/><a:gd name="txL" fmla="+- x1 dx 0"/><a:gd name="txR" fmla="+- x2 0 dx"/>',
        cxn_='<a:cxn ang="0"><a:pos x="x2" y="vc"/></a:cxn><a:cxn ang="10800000"><a:pos x="x1" y="vc"/></a:cxn>',
        rect='<a:rect l="txL" t="t" r="txR" b="b"/>')
    items = [("moveTo/lnTo/close", house), ("cubicBezTo", wave), ("quadBezTo", quad), ("arcTo tab", tab),
             ("3 paths: plain/darken/lightenLess", pie3), ("stroke=0 + fill=none + lighten", multi),
             ("guides, adj, text rect", guided)]
    for (x, y, w, h), (lbl, geom) in zip(grid_cells(4, 2, 0.4, 1.5, 9.2, 5.6, 0.3, 0.5), items):
        sid = s.nid()
        txt = body(p(r("text rect", sz=12, fill="FFFFFF"), algn="ctr"), anchor="ctr") if "guides" in lbl else None
        s.add(sp(sid, lbl, inch(x), inch(y), inch(w), inch(h - 0.4), cust=geom, fill=solid("scheme:accent1"),
                 line=ln(1.5, "1F3864", join="round"), text=txt))
        s.label(x, y + h - 0.35, w, 0.35, lbl, sz=9)
    s = d.slide(title="Freeform polyline (open path) and path scaling")
    pts = "".join(f'<a:lnTo><a:pt x="{int(500 + 450 * math.cos(t / 6.0) * (1 - t / 80))}" y="{int(500 + 450 * math.sin(t / 6.0) * (1 - t / 80))}"/></a:lnTo>'
                  for t in range(1, 75))
    spiral = custgeom([f'<a:path w="1000" h="1000" fill="none"><a:moveTo><a:pt x="950" y="500"/></a:moveTo>{pts}</a:path>'])
    sid = s.nid()
    s.add(sp(sid, "spiral freeform", inch(0.5), inch(1.6), inch(4.2), inch(4.2), cust=spiral,
             line=ln(2.5, "C00000", cap="rnd", join="round")))
    for i, (x, y, w, h) in enumerate([(5.0, 1.6, 1.2, 2.4), (6.6, 1.6, 2.4, 1.2), (5.0, 4.6, 3.6, 0.8)]):
        sid = s.nid()
        s.add(sp(sid, f"scaled house {i}", inch(x), inch(y), inch(w), inch(h), cust=house,
                 fill=grad([(0, "FFC000"), (100, "C55A11")], ang=90), line=ln(1, "7F3F00")))
    return d


# =============================================================================
# Fills, backgrounds, lines, effects
# =============================================================================

def deck_fills_gradient() -> Deck:
    d = Deck("fills-solid-gradient", "Fills: solid, alpha, linear and path gradients",
             "Solid fills with alpha overlap, linear gradients (2-5 stops, angles 0-315, scaled), rotWithShape, "
             "path gradients (circle/rect/shape) with fillToRect variants and tileRect, gradients with transparent "
             "stops.", ["fills", "solid-fill", "alpha", "linear-gradient", "path-gradient"])
    s = d.slide(title="Solid fills and alpha")
    for i, (c, a) in enumerate([("C00000", 100), ("0070C0", 75), ("00B050", 50), ("FFC000", 25)]):
        s.shape(0.8 + i * 1.3, 1.8 + i * 0.5, 2.6, 2.6, geom="ellipse", fill=solid(c, f"alpha={a * 1000}"),
                line=ln(1, c))
        s.label(0.8 + i * 1.3, 4.5 + i * 0.5, 2.6, 0.3, f"alpha {a}%", sz=10)
    s.shape(6.4, 1.6, 3.0, 5.4, fill=patt("smCheck", "BFBFBF", "FFFFFF"))
    for i, a in enumerate([90, 60, 30, 10]):
        s.shape(6.6, 1.8 + i * 1.3, 2.6, 1.0, fill=solid("scheme:accent1", f"alpha={a * 1000}"),
                text=body(p(r(f"accent1 alpha {a}%", sz=12), algn="ctr"), anchor="ctr"))
    s = d.slide(title="Linear gradients: angles and stops")
    for i, ang in enumerate([0, 45, 90, 135, 180, 225, 270, 315]):
        x = 0.4 + (i % 4) * 2.35
        y = 1.5 + (i // 4) * 1.55
        s.shape(x, y, 2.1, 1.2, fill=grad([(0, "1F4E79"), (100, "BDD7EE")], ang=ang),
                text=body(p(r(f"lin {ang}°", sz=12, fill="FFFFFF", b=True), algn="ctr"), anchor="ctr"))
    stops3 = [(0, "C00000"), (50, "FFFF00"), (100, "00B050")]
    stops5 = [(0, "7030A0"), (25, "0070C0"), (50, "00B050"), (75, "FFC000"), (100, "C00000")]
    s.shape(0.4, 4.7, 2.9, 1.1, fill=grad(stops3, ang=0), text=body(p(r("3 stops", sz=12), algn="ctr"), anchor="ctr"))
    s.shape(3.5, 4.7, 2.9, 1.1, fill=grad(stops5, ang=0), text=body(p(r("5 stops", sz=12), algn="ctr"), anchor="ctr"))
    s.shape(6.6, 4.7, 2.9, 1.1, fill=grad([(0, "000000"), (30, "FFFFFF"), (31, "C00000"), (100, "C00000")], ang=0),
            text=body(p(r("hard stop", sz=12), algn="ctr"), anchor="ctr"))
    s.shape(0.4, 6.0, 4.4, 1.2, fill=grad(stops3, ang=45, scaled=True),
            text=body(p(r("45° scaled=1 on wide box", sz=12), algn="ctr"), anchor="ctr"))
    s.shape(5.1, 6.0, 4.4, 1.2, fill=grad(stops3, ang=45, scaled=False),
            text=body(p(r("45° scaled=0 on wide box", sz=12), algn="ctr"), anchor="ctr"))
    s = d.slide(title="Path gradients and rotWithShape")
    specs = [("circle center", "circle", (50, 50, 50, 50)), ("circle top-left", "circle", (0, 0, 100, 100)),
             ("rect center", "rect", (50, 50, 50, 50)), ("rect bottom-right", "rect", (100, 100, 0, 0)),
             ("shape", "shape", (50, 50, 50, 50)), ("circle wide ftr", "circle", (-30, -30, -30, -30))]
    for (x, y, w, h), (lbl, path, ftr) in zip(grid_cells(3, 2, 0.4, 1.5, 9.2, 3.4), specs):
        geom = "star7" if path == "shape" else "rect"
        s.shape(x, y, w, h, geom=geom, fill=grad([(0, "FFFFFF"), (100, "2F5597")], path=path, fill_to=ftr),
                text=body(p(r(lbl, sz=11, fill="000000"), algn="ctr"), anchor="b"))
    for i, rws in enumerate([True, False]):
        s.shape(1.4 + i * 4.4, 5.6, 2.4, 1.2, fill=grad([(0, "C00000"), (100, "FFC000")], ang=0, rot_with_shape=rws),
                rot=40, text=body(p(r(f"rot 40, rotWithShape={int(rws)}", sz=11), algn="ctr"), anchor="ctr"))
    s = d.slide(title="Gradients with transparency and tileRect")
    s.shape(0.4, 1.5, 9.2, 5.6, fill=patt("lgCheck", "D9D9D9", "FFFFFF"))
    s.shape(0.8, 1.9, 4.0, 2.2, fill=grad([(0, clr("0070C0")), (100, clr("0070C0", "alpha=0"))], ang=0),
            text=body(p(r("opaque → transparent", sz=14), algn="ctr"), anchor="ctr"))
    s.shape(5.2, 1.9, 4.0, 2.2, geom="ellipse",
            fill=grad([(0, clr("FFFFFF", "alpha=100000")), (100, clr("C00000", "alpha=20000"))], path="circle",
                      fill_to=(50, 50, 50, 50)), text=body(p(r("radial alpha", sz=14), algn="ctr"), anchor="ctr"))
    s.shape(0.8, 4.5, 4.0, 2.2, fill=grad([(0, "00B050"), (100, "002060")], ang=90, tile=(0, 0, -100, 0), flip="x"),
            text=body(p(r("tileRect r=-100% flip=x", sz=12, fill="FFFFFF"), algn="ctr"), anchor="ctr"))
    s.shape(5.2, 4.5, 4.0, 2.2, fill=grad([(0, "FFC000"), (100, "7F3F00")], path="rect", fill_to=(50, 50, 50, 50),
                                          tile=(-50, -50, -50, -50)),
            text=body(p(r("path rect with tileRect", sz=12), algn="ctr"), anchor="ctr"))
    return d


PATTERNS = ["pct5", "pct10", "pct20", "pct25", "pct30", "pct40", "pct50", "pct60", "pct70", "pct75", "pct80",
            "pct90", "horz", "vert", "ltHorz", "ltVert", "dkHorz", "dkVert", "narHorz", "narVert", "dashHorz",
            "dashVert", "cross", "dnDiag", "upDiag", "ltDnDiag", "ltUpDiag", "dkDnDiag", "dkUpDiag", "wdDnDiag",
            "wdUpDiag", "dashDnDiag", "dashUpDiag", "diagCross", "smCheck", "lgCheck", "smGrid", "lgGrid",
            "dotGrid", "smConfetti", "lgConfetti", "horzBrick", "diagBrick", "solidDmnd", "openDmnd", "dotDmnd",
            "plaid", "sphere", "weave", "divot", "shingle", "wave", "trellis", "zigZag"]


def deck_fills_pattern_picture() -> Deck:
    d = Deck("fills-pattern-picture", "Fills: all 54 pattern presets, picture fills, noFill, group fill",
             "Every ST_PresetPatternVal, picture fills (stretch, srcRect-cropped stretch, tile with scale/offset/"
             "flip/alignment) in rectangles and non-rectangular shapes, outline-only shapes and grpFill children.",
             ["fills", "pattern-fill", "picture-fill", "tile", "group-fill"])
    for page in range(2):
        chunk = PATTERNS[page * 27:(page + 1) * 27]
        s = d.slide(title=f"Pattern fills {page * 27 + 1}-{page * 27 + len(chunk)}", title_size=24)
        for (x, y, w, h), name in zip(grid_cells(7, 4, 0.3, 1.4, 9.4, 5.9, 0.12, 0.1), chunk):
            s.shape(x, y, w, h - 0.3, fill=patt(name, "1F4E79", "DEEBF7"), line=ln(0.75, "1F4E79"))
            s.label(x, y + h - 0.3, w, 0.3, name, sz=8)
    s = d.slide(title="Picture fills")
    card = s.image(media.png_testcard(), "png")
    tile = s.image(media.png_pattern_tile(), "png")
    specs = [("stretch", "rect", blipfill(card)), ("stretch + srcRect", "rect", blipfill(card, src_rect=(25, 25, 0, 0))),
             ("tile 100%", "rect", blipfill(tile, "tile", tile={"tx": 0, "ty": 0, "sx": 100000, "sy": 100000, "flip": "none", "algn": "tl"})),
             ("tile 50% flip xy", "rect", blipfill(tile, "tile", tile={"tx": 0, "ty": 0, "sx": 50000, "sy": 50000, "flip": "xy", "algn": "ctr"})),
             ("ellipse stretch", "ellipse", blipfill(card)), ("star5 stretch", "star5", blipfill(card)),
             ("heart tile offset", "heart", blipfill(tile, "tile", tile={"tx": inch(0.1), "ty": inch(0.2), "sx": 75000, "sy": 75000, "algn": "br"})),
             ("text over picture", "roundRect", blipfill(card))]
    for (x, y, w, h), (lbl, geom, fill) in zip(grid_cells(4, 2, 0.4, 1.5, 9.2, 5.6, 0.25, 0.4), specs):
        txt = body(p(r("Text on picture fill", sz=14, b=True, fill="FFFFFF"), algn="ctr"), anchor="ctr") if lbl.startswith("text") else None
        s.shape(x, y, w, h - 0.35, geom=geom, fill=fill, line=ln(1, "404040"), text=txt)
        s.label(x, y + h - 0.33, w, 0.33, lbl, sz=9)
    s = d.slide(title="noFill outlines and group fill (grpFill)")
    for i, g in enumerate(["rect", "ellipse", "star5", "cloud"]):
        s.shape(0.5 + i * 2.3, 1.6, 1.9, 1.6, geom=g, fill=NOFILL, line=ln(2.5, ACCENTS[i]))
    sid = s.nid()
    kids = ""
    for i, g in enumerate(["rect", "ellipse", "triangle"]):
        kid = s.nid()
        kids += sp(kid, f"grpFill child {i}", inch(i * 1.5), 0, inch(1.3), inch(1.3), geom=g, fill="<a:grpFill/>",
                   line=ln(1, "000000"))
    s.add(grp(sid, "Group with gradient fill", inch(1.0), inch(4.0), inch(4.3), inch(1.3),
              (0, 0, inch(4.3), inch(1.3)), kids, fill=grad([(0, "FFC000"), (100, "C00000")], ang=0)))
    s.label(1.0, 5.4, 4.3, 0.4, "children use <a:grpFill/> (group gradient spans all)", sz=10)
    return d


def deck_backgrounds() -> Deck:
    d = Deck("backgrounds", "Backgrounds: master, layout and slide backgrounds",
             "Master background (solid), layout background (gradient) inherited by its slides, and slide "
             "backgrounds: solid, linear gradient, path gradient, stretched picture, tiled picture, pattern, "
             "theme bgRef 1001-1003.", ["backgrounds", "master-background", "layout-background", "bg-ref"])
    master_csld = d.prs.slide_master._element.find(qn("p:cSld"))
    master_csld.replace(master_csld.find(qn("p:bg")), parse(
        f"<p:bg><p:bgPr>{solid('F3F0E8')}<a:effectLst/></p:bgPr></p:bg>"))
    lay = d.layout("Section Header")
    lay._element.find(qn("p:cSld")).insert(0, parse(
        f"<p:bg><p:bgPr>{grad([(0, 'DEEBF7'), (100, '2F5597')], ang=90)}<a:effectLst/></p:bgPr></p:bg>"))

    def caption(s, text, color="000000"):
        s.textbox(0.6, 5.6, 8.8, 1.2, p(r(text, sz=20, fill=color), algn="ctr"), anchor="ctr",
                  fill=solid("FFFFFF", "alpha=70000"))

    s = d.slide("Title Only", "Inherited master background (solid F3F0E8)")
    caption(s, "No <p:bg> on the slide or layout")
    s = d.slide("Section Header", "Layout background (gradient)")
    caption(s, "Inherited from the Section Header layout")
    for title_, inner in [
        ("Slide solid background", f"<p:bgPr>{solid('FFF2CC')}<a:effectLst/></p:bgPr>"),
        ("Slide linear gradient", f"<p:bgPr>{grad([(0, '002060'), (60, '7030A0'), (100, 'FF66CC')], ang=45)}<a:effectLst/></p:bgPr>"),
        ("Slide path gradient", f"<p:bgPr>{grad([(0, 'FFFFFF'), (100, '00B050')], path='circle', fill_to=(50, 50, 50, 50))}<a:effectLst/></p:bgPr>"),
        ("Slide pattern background", f"<p:bgPr>{patt('dotDmnd', 'BF9000', 'FFF2CC')}<a:effectLst/></p:bgPr>"),
    ]:
        s = d.slide("Title Only", title_)
        s.background(inner)
        caption(s, title_)
    s = d.slide("Title Only", "Slide picture background (stretch)")
    s.background(f"<p:bgPr>{blipfill(s.image(media.jpeg_photo(), 'jpeg'))}<a:effectLst/></p:bgPr>")
    caption(s, "Picture stretched to the slide")
    s = d.slide("Title Only", "Slide picture background (tiled)")
    s.background(f"<p:bgPr>{blipfill(s.image(media.png_pattern_tile(), 'png'), 'tile', tile={'tx': 0, 'ty': 0, 'sx': 100000, 'sy': 100000, 'flip': 'none', 'algn': 'tl'})}<a:effectLst/></p:bgPr>")
    caption(s, "Picture tiled at 100%")
    for idx, c in ((1001, "accent2"), (1002, "accent1"), (1003, "accent6")):
        s = d.slide("Title Only", f"Theme background bgRef idx={idx} ({c})")
        s.background(f'<p:bgRef idx="{idx}">{clr("scheme:" + c)}</p:bgRef>')
        caption(s, f"bgFillStyleLst entry {idx - 1000} with phClr = {c}")
    return d


def deck_lines() -> Deck:
    d = Deck("lines-widths-dashes", "Lines: widths, dash styles, caps, joins, compound lines",
             "Line widths 0.25-12pt, all 11 preset dashes and custom dashes, flat/square/round caps on dashed "
             "lines, round/bevel/miter joins, compound lines (dbl, thickThin, thinThick, tri), inset alignment, "
             "gradient and semi-transparent line fills.", ["lines", "line-widths", "dashes", "caps", "joins", "compound-lines"])
    s = d.slide(title="Line widths")
    for i, w in enumerate([0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6, 9, 12]):
        y = 1.6 + i * 0.52
        s.label(0.3, y - 0.15, 1.1, 0.3, f"{w} pt", sz=11, algn="r")
        sid = s.nid()
        s.add(sp(sid, f"w{w}", inch(1.6), inch(y), inch(7.8), 0, geom="line", line=ln(w, "1F3864")))
    s = d.slide(title="Dash styles (3 pt)")
    dashes = ["solid", "dot", "dash", "lgDash", "dashDot", "lgDashDot", "lgDashDotDot", "sysDash", "sysDot",
              "sysDashDot", "sysDashDotDot"]
    for i, ds in enumerate(dashes):
        y = 1.55 + i * 0.47
        s.label(0.2, y - 0.15, 1.9, 0.3, ds, sz=11, algn="r")
        sid = s.nid()
        s.add(sp(sid, ds, inch(2.3), inch(y), inch(7.2), 0, geom="line", line=ln(3, "C00000", dash=ds)))
    for i, cd in enumerate([[(400, 200)], [(100, 100), (300, 100), (800, 300)]]):
        y = 1.55 + (len(dashes) + i) * 0.47
        s.label(0.2, y - 0.15, 1.9, 0.3, f"custDash {i + 1}", sz=11, algn="r")
        sid = s.nid()
        s.add(sp(sid, f"custDash {i}", inch(2.3), inch(y), inch(7.2), 0, geom="line", line=ln(3, "7030A0", cust_dash=cd)))
    s = d.slide(title="Caps and joins")
    for i, cap in enumerate(["flat", "sq", "rnd"]):
        y = 1.8 + i * 0.75
        s.label(0.3, y - 0.15, 1.2, 0.3, f"cap={cap}", sz=11, algn="r")
        sid = s.nid()
        s.add(sp(sid, f"cap {cap}", inch(1.7), inch(y), inch(3.2), 0, geom="line", line=ln(12, "2F5597", cap=cap)))
        sid = s.nid()
        s.add(sp(sid, f"cap dash {cap}", inch(5.4), inch(y), inch(4.0), 0, geom="line",
                 line=ln(8, "2F5597", cap=cap, dash="sysDot")))
    zig = custgeom(['<a:path w="400" h="100" fill="none"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="80" y="0"/></a:lnTo>'
                    '<a:lnTo><a:pt x="160" y="100"/></a:lnTo><a:lnTo><a:pt x="240" y="0"/></a:lnTo><a:lnTo><a:pt x="320" y="100"/></a:lnTo>'
                    '<a:lnTo><a:pt x="400" y="10"/></a:lnTo></a:path>'])
    for i, jn in enumerate(["round", "bevel", "miter"]):
        y = 4.3 + i * 1.0
        s.label(0.3, y + 0.2, 1.2, 0.3, f"join={jn}", sz=11, algn="r")
        sid = s.nid()
        s.add(sp(sid, f"join {jn}", inch(1.7), inch(y), inch(3.6), inch(0.7), cust=zig, line=ln(10, "C55A11", join=jn)))
        sid = s.nid()
        s.add(sp(sid, f"join tri {jn}", inch(6.0), inch(y), inch(1.4), inch(0.8), geom="triangle", fill=solid("FBE5D6"),
                 line=ln(10, "C55A11", join=jn)))
    s = d.slide(title="Compound lines, alignment, gradient and alpha lines")
    for i, cm in enumerate(["sng", "dbl", "thickThin", "thinThick", "tri"]):
        x = 0.5 + i * 1.85
        s.shape(x, 1.7, 1.5, 1.3, fill=solid("F2F2F2"), line=ln(9, "1F3864", cmpd=cm))
        s.label(x, 3.1, 1.5, 0.3, f"cmpd={cm}", sz=10)
    for i, al in enumerate(["ctr", "in"]):
        s.shape(0.8 + i * 2.4, 3.9, 1.8, 1.4, fill=solid("DEEBF7"), line=ln(14, solid("2F5597", "alpha=60000"), algn=al))
        s.label(0.8 + i * 2.4, 5.4, 1.8, 0.3, f"algn={al} 14pt alpha", sz=10)
    sid = s.nid()
    s.add(sp(sid, "gradient line", inch(5.6), inch(3.9), inch(3.6), inch(1.4), geom="ellipse", fill=NOFILL,
             line=ln(10, grad([(0, "C00000"), (50, "FFC000"), (100, "00B050")], ang=0))))
    s.label(5.6, 5.4, 3.6, 0.3, "gradient-filled 10pt outline", sz=10)
    sid = s.nid()
    s.add(sp(sid, "pattern line", inch(0.8), inch(6.0), inch(8.4), 0, geom="line", line=ln(10, patt("wdDnDiag", "000000", "FFFF00"))))
    return d


def deck_arrows_connectors() -> Deck:
    d = Deck("lines-arrows-connectors", "Lines: arrowheads and connectors",
             "Arrowhead types (triangle, stealth, diamond, oval, arrow) x sizes (sm/med/lg width and length) on head "
             "and tail, straight/bent/curved connectors with stCxn/endCxn between shapes, connector adjust values "
             "and flipped/rotated connectors.", ["lines", "arrowheads", "connector"])
    s = d.slide(title="Arrowhead types and sizes")
    types = ["triangle", "stealth", "diamond", "oval", "arrow"]
    sizes = [("sm", "sm"), ("med", "med"), ("lg", "lg"), ("sm", "lg"), ("lg", "sm")]
    for ti, t in enumerate(types):
        s.label(0.2, 1.75 + ti * 1.05, 1.1, 0.3, t, sz=11, algn="r")
        for si, (w, l_) in enumerate(sizes):
            x = 1.5 + si * 1.65
            y = 1.9 + ti * 1.05
            sid = s.nid()
            s.add(sp(sid, f"{t} {w}{l_}", inch(x), inch(y), inch(1.3), 0, geom="line",
                     line=ln(2.5, "1F3864", head=(t, w, l_), tail=(t, w, l_))))
            if ti == 0:
                s.label(x, 1.35, 1.3, 0.3, f"w={w} len={l_}", sz=9)
    s = d.slide(title="Connectors glued to shapes (stCxn / endCxn)")
    boxes = {}
    for name, (x, y) in {"A": (0.6, 1.8), "B": (4.0, 1.6), "C": (7.4, 3.0), "D": (0.6, 5.2), "E": (4.0, 5.6), "F": (7.4, 5.8)}.items():
        sid = s.nid()
        boxes[name] = (sid, x, y)
        s.add(sp(sid, f"Box {name}", inch(x), inch(y), inch(2.0), inch(0.9), geom="roundRect",
                 fill=solid("scheme:accent1", "lumMod=40000", "lumOff=60000"), line=ln(1.25, "scheme:accent1"),
                 text=body(p(r(name, sz=16, b=True), algn="ctr"), anchor="ctr")))

    def site(name, idx):  # roundRect sites: 0 top, 1 left, 2 bottom, 3 right
        _, x, y = boxes[name]
        return {0: (x + 1.0, y), 1: (x, y + 0.45), 2: (x + 1.0, y + 0.9), 3: (x + 2.0, y + 0.45)}[idx]

    def connect(geom, a, ai, b, bi, color, **kw):
        (x1, y1), (x2, y2) = site(a, ai), site(b, bi)
        sid = s.nid()
        s.add(cxn(sid, f"{geom} {a}-{b}", inch(min(x1, x2)), inch(min(y1, y2)), inch(abs(x2 - x1)), inch(abs(y2 - y1)),
                  geom=geom, st=(boxes[a][0], ai), end=(boxes[b][0], bi), flip_h=x2 < x1, flip_v=y2 < y1,
                  line=ln(2, color, tail=("triangle", "med", "med")), **kw))

    connect("straightConnector1", "A", 3, "B", 1, "C00000")
    connect("bentConnector3", "B", 3, "C", 1, "00B050")
    connect("curvedConnector3", "A", 2, "E", 1, "7030A0")
    connect("bentConnector3", "D", 3, "E", 1, "0070C0", av={"adj1": 25000})
    connect("straightConnector1", "F", 1, "E", 3, "C55A11")
    connect("curvedConnector3", "C", 2, "F", 0, "000000")
    s = d.slide(title="Bent and curved connector variants")
    for i, g in enumerate(["bentConnector2", "bentConnector3", "bentConnector4", "bentConnector5",
                           "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5"]):
        x = 0.6 + (i % 4) * 2.3
        y = 1.7 + (i // 4) * 2.7
        sid = s.nid()
        s.add(cxn(sid, g, inch(x), inch(y), inch(1.8), inch(1.6), geom=g, line=ln(2.5, ACCENTS[i % 6], tail=("arrow", "med", "med"))))
        s.label(x - 0.1, y + 1.7, 2.0, 0.3, g, sz=10)
    sid = s.nid()
    s.add(cxn(sid, "rotated bent", inch(4.0), inch(6.75), inch(1.6), inch(0.6), geom="bentConnector3", rot=180,
              line=ln(2, "404040", tail=("stealth", "med", "lg"))))
    return d


def deck_effects() -> Deck:
    d = Deck("effects-shadow-glow-reflection", "Effects: shadows, glow, soft edges, reflection, 3D",
             "outerShdw with varied blur/distance/direction/alpha/scale/skew, innerShdw, glow radii and colors, "
             "softEdge, reflection variants, effects on text and pictures, 3D bevels/extrusion with cameras and "
             "light rigs, and the default theme's effect styles via effectRef.",
             ["effects", "shadow", "inner-shadow", "glow", "soft-edge", "reflection", "3d", "style-refs"])
    s = d.slide(title="Outer and inner shadows")
    specs = [("blur 4 dist 3 dir 45", outer_shdw(4, 3, 45)), ("blur 0 dist 6 dir 45", outer_shdw(0, 6, 45, alpha=60)),
             ("blur 12 dist 8 dir 90", outer_shdw(12, 8, 90, alpha=50)), ("blur 20 dist 0 (halo)", outer_shdw(20, 0, 0, "0070C0", 70)),
             ("dir 225 red", outer_shdw(6, 6, 225, "C00000", 60)), ("perspective sx/sy/kx", outer_shdw(8, 6, 60, alpha=40, sx=90, sy=-30, kx=-60, algn="bl")),
             ("innerShdw", inner_shdw(8, 5, 45)), ("inner + outer", inner_shdw(6, 3, 225) + outer_shdw(5, 4, 45))]
    for (x, y, w, h), (lbl, eff) in zip(grid_cells(4, 2, 0.5, 1.6, 9.0, 5.2, 0.45, 0.8), specs):
        s.shape(x, y, w, h, geom="roundRect", fill=solid("DEEBF7"), line=ln(1, "2F5597"),
                effects=f"<a:effectLst>{eff}</a:effectLst>",
                text=body(p(r(lbl, sz=11), algn="ctr"), anchor="ctr"))
    s = d.slide(title="Glow and soft edges")
    for i, (rad, c) in enumerate([(4, "FFC000"), (10, "00B0F0"), (18, "FF00FF")]):
        s.shape(0.7 + i * 3.1, 1.8, 2.3, 1.5, geom="ellipse", fill=solid("1F3864"), effects=effect_lst(glow(rad, c, 60)),
                text=body(p(r(f"glow {rad}pt", sz=14, fill="FFFFFF"), algn="ctr"), anchor="ctr"))
    for i, rad in enumerate([2.5, 10, 25]):
        s.shape(0.7 + i * 3.1, 4.2, 2.3, 1.5, fill=solid("C00000"), effects=effect_lst(soft_edge(rad)),
                text=body(p(r(f"softEdge {rad}pt", sz=14, fill="FFFFFF"), algn="ctr"), anchor="ctr"))
    rid = s.image(media.png_testcard(), "png")
    sid = s.nid()
    s.add(pic(sid, "soft-edged picture", rid, inch(3.8), inch(6.0), inch(1.7), inch(1.28), effects=effect_lst(soft_edge(8))))
    s = d.slide(title="Reflections")
    for i, (lbl, refl) in enumerate([("tight", reflection(0.5, 52, 300, 35, 0)), ("half, 4pt away", reflection(1, 50, 0, 55, 4)),
                                     ("full, blurred", reflection(4, 60, 900, 90, 1))]):
        s.shape(0.8 + i * 3.0, 2.0, 2.4, 1.6, geom="roundRect", fill=grad([(0, "70AD47"), (100, "375623")], ang=90),
                effects=effect_lst(refl), text=body(p(r(lbl, sz=14, fill="FFFFFF"), algn="ctr"), anchor="ctr"))
    rid = s.image(media.png_testcard(), "png")
    sid = s.nid()
    s.add(pic(sid, "reflected picture", rid, inch(3.6), inch(4.8), inch(2.4), inch(1.4), effects=effect_lst(reflection(0.5, 50, 300, 40, 2))))
    s = d.slide(title="Effects on text and pictures")
    s.textbox(0.5, 1.6, 9, 1.2, p(r("Shadowed heading", sz=40, b=True, fill="2F5597",
                                    effects=effect_lst(outer_shdw(4, 4, 45, alpha=45))), algn="ctr"))
    s.textbox(0.5, 2.9, 9, 1.2, p(r("Glowing heading", sz=40, b=True, fill="FFFFFF", effects=effect_lst(glow(8, "C00000", 80))),
                                  algn="ctr"), fill=solid("404040"))
    rid = s.image(media.jpeg_photo(), "jpeg")
    for i, eff in enumerate([effect_lst(outer_shdw(10, 8, 45, alpha=50)), effect_lst(glow(10, "FFC000", 70)),
                             effect_lst(inner_shdw(12, 6, 45, alpha=70))]):
        sid = s.nid()
        s.add(pic(sid, f"picture effect {i}", rid, inch(0.7 + i * 3.1), inch(4.5), inch(2.4), inch(1.8),
                  line=ln(3, "FFFFFF"), effects=eff))
    s = d.slide(title="3D: bevels, extrusion, cameras, materials")
    specs3d = [
        ("bevel circle", '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
         '<a:sp3d><a:bevelT w="101600" h="63500"/></a:sp3d>'),
        ("relaxedInset + softRound", '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="balanced" dir="t"/></a:scene3d>',
         '<a:sp3d prstMaterial="softEdge"><a:bevelT w="152400" h="50800" prst="relaxedInset"/><a:bevelB prst="softRound"/></a:sp3d>'),
        ("extrusion iso", '<a:scene3d><a:camera prst="isometricOffAxis1Right"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>',
         '<a:sp3d extrusionH="381000"><a:extrusionClr><a:srgbClr val="7F3F00"/></a:extrusionClr></a:sp3d>'),
        ("perspective + contour", '<a:scene3d><a:camera prst="perspectiveRelaxedModerately"/><a:lightRig rig="flood" dir="t"/></a:scene3d>',
         '<a:sp3d contourW="38100" extrusionH="190500"><a:bevelT prst="angle"/><a:contourClr><a:srgbClr val="002060"/></a:contourClr></a:sp3d>'),
    ]
    for i, (lbl, sc, s3) in enumerate(specs3d):
        s.shape(0.7 + (i % 2) * 4.6, 1.7 + (i // 2) * 2.6, 3.4, 1.8, geom="roundRect" if i % 2 else "ellipse",
                fill=solid(ACCENTS[i]), scene3d=sc, sp3d=s3, text=body(p(r(lbl, sz=14, b=True), algn="ctr"), anchor="ctr"))
    s = d.slide(title="Default theme effect styles via effectRef 0-3")
    for ei in range(4):
        sid = s.nid()
        s.add(sp(sid, f"effectRef {ei}", inch(0.6 + ei * 2.3), inch(2.5), inch(1.9), inch(1.9), geom="rect",
                 style=style_ref(1, 3, ei), text=body(p(r(f"effectRef idx={ei}", sz=12), algn="ctr"), anchor="ctr")))
    s.label(0.6, 5.0, 8.8, 0.8, "fillRef 3 (gradient) / lnRef 1; effectRef 3 adds the theme's scene3d + bevel", sz=12)
    return d


# =============================================================================
# Pictures and OLE
# =============================================================================

def deck_pictures_raster() -> Deck:
    d = Deck("pictures-raster-formats", "Pictures: PNG (alpha), JPEG, GIF, BMP, TIFF",
             "Raster picture formats placed at native aspect and scaled non-uniformly, PNG transparency over a "
             "checkerboard, palette GIF with a transparent index, and tiny/huge scaling.",
             ["pictures", "png", "jpeg", "gif", "bmp", "tiff", "alpha"])
    s = d.slide(title="Raster formats")
    s.shape(0.4, 1.5, 3.0, 2.3, fill=patt("lgCheck", "BFBFBF", "FFFFFF"))
    items = [("png", media.png_alpha(), (0.4, 1.5, 3.0, 2.25), "PNG with alpha"),
             ("jpeg", media.jpeg_photo(), (3.6, 1.5, 3.0, 2.25), "JPEG"),
             ("gif", media.gif_palette(), (6.8, 1.5, 2.8, 2.1), "GIF (transparent index)"),
             ("bmp", media.bmp_testcard(), (0.4, 4.4, 3.0, 2.25), "BMP 24-bit"),
             ("tiff", media.tiff_testcard(), (3.6, 4.4, 3.0, 2.25), "TIFF (LZW)"),
             ("png", media.png_testcard(), (6.8, 4.4, 2.8, 2.1), "PNG RGB")]
    for ext, blob, (x, y, w, h), lbl in items:
        rid = s.image(blob, ext)
        sid = s.nid()
        s.add(pic(sid, lbl, rid, inch(x), inch(y), inch(w), inch(h)))
        s.label(x, y + h + 0.03, w, 0.3, lbl, sz=10)
    s.shape(6.8, 1.5, 2.8, 2.1, fill=NOFILL, line=ln(0.75, "C00000", dash="dash"))
    s = d.slide(title="Scaling: stretched, tiny, large")
    rid = s.image(media.png_testcard(), "png")
    for i, (x, y, w, h) in enumerate([(0.4, 1.5, 4.5, 1.2), (0.4, 3.0, 1.0, 4.0), (1.7, 3.0, 0.3, 0.22), (2.3, 3.0, 7.3, 4.2)]):
        sid = s.nid()
        s.add(pic(sid, f"scaled {i}", rid, inch(x), inch(y), inch(w), inch(h)))
    rid2 = s.image(media.gif_palette(), "gif")
    sid = s.nid()
    s.add(pic(sid, "gif stretched", rid2, inch(5.2), inch(1.5), inch(4.4), inch(1.2)))
    return d


def deck_pictures_vector() -> Deck:
    d = Deck("pictures-vector-emf-wmf-svg", "Pictures: EMF, WMF and SVG (with PNG fallback)",
             "Hand-built EMF (chart-like and record-coverage drawings: gradients, beziers, paths, world transforms, "
             "hatch, DIB, rotated text), placeable WMF (pie chart, polygons, text), and SVG via asvg:svgBlip with a "
             "PNG fallback (the fallback carries a magenta corner marker).",
             ["pictures", "emf", "wmf", "svg", "svg-blip", "vector"])
    s = d.slide(title="EMF and WMF")
    for (x, y, w, h), (ext, blob, lbl) in zip([(0.4, 1.5, 4.5, 2.8), (5.1, 1.5, 4.5, 3.4), (0.4, 4.7, 4.5, 2.8)],
                                              [("emf", media.emf_bar_chart(), "EMF: chart-like (text, gridlines, bars)"),
                                               ("emf", media.emf_shapes(), "EMF: gradients, beziers, paths, transforms, DIB"),
                                               ("wmf", media.wmf_pie_chart(), "WMF (placeable): pie, polygons, text")]):
        rid = s.image(blob, ext)
        sid = s.nid()
        s.add(pic(sid, lbl, rid, inch(x), inch(y), inch(w), inch(h), line=ln(0.5, "BFBFBF")))
        s.label(x, y + h + 0.02, w, 0.3, lbl, sz=9)
    rid = s.image(media.emf_bar_chart(), "emf")
    sid = s.nid()
    s.add(pic(sid, "EMF stretched", rid, inch(5.1), inch(5.4), inch(4.5), inch(1.6)))
    s.label(5.1, 7.02, 4.5, 0.3, "same EMF, non-uniform scale", sz=9)
    s = d.slide(title="SVG with PNG fallback (asvg:svgBlip)")
    png_rid = s.image(media.svg_png_fallback(), "png")
    svg_rid = s.image(media.svg_drawing(), "svg")
    ext = ('<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">'
           f'<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="{svg_rid}"/>'
           "</a:ext></a:extLst>")
    for i, (x, y, w, h) in enumerate([(0.4, 1.5, 4.0, 3.0), (4.8, 1.5, 1.2, 0.9), (4.8, 2.6, 4.8, 4.6)]):
        sid = s.nid()
        s.add(pic(sid, f"svg {i}", png_rid, inch(x), inch(y), inch(w), inch(h), blip_inner=ext))
    sid = s.nid()
    s.add(pic(sid, "png fallback only", png_rid, inch(0.4), inch(4.8), inch(3.2), inch(2.4)))
    s.label(0.4, 7.2, 3.2, 0.3, "PNG fallback alone (no svgBlip)", sz=9)
    return d


def deck_pictures_crop() -> Deck:
    d = Deck("pictures-crop-effects", "Pictures: cropping, transforms, borders and blip effects",
             "srcRect crops (one side, all sides, negative/padding), rotated and flipped pictures, pictures with "
             "outlines, shadows and non-rectangular geometry, and blip effects: alphaModFix, grayscl, biLevel, "
             "lum bright/contrast, duotone, clrChange, tint/hsl.", ["pictures", "crop", "rotation", "flip", "blip-effects"])
    s = d.slide(title="Cropping with srcRect")
    rid = s.image(media.png_testcard(), "png")
    crops = [("none", None), ("l=25%", (25, 0, 0, 0)), ("t=10% b=10%", (0, 10, 0, 10)), ("all 20%", (20, 20, 20, 20)),
             ("top-left quadrant", (0, 0, 50, 50)), ("negative l/r -20%", (-20, 0, -20, 0)),
             ("negative all -10%", (-10, -10, -10, -10)), ("r=60% b=-30%", (0, 0, 60, -30))]
    for (x, y, w, h), (lbl, cr) in zip(grid_cells(4, 2, 0.4, 1.5, 9.2, 5.6, 0.3, 0.5), crops):
        sid = s.nid()
        s.add(pic(sid, lbl, rid, inch(x), inch(y), inch(w), inch(h - 0.35), src_rect=cr, line=ln(0.75, "000000")))
        s.label(x, y + h - 0.33, w, 0.3, lbl, sz=9)
    s = d.slide(title="Rotation, flips, outlines, shadows, geometry")
    rid = s.image(media.png_testcard(), "png")
    specs = [dict(rot=30), dict(flip_h=True), dict(flip_v=True), dict(rot=200, flip_h=True),
             dict(line=ln(6, "1F3864")), dict(line=ln(3, "C00000", cmpd="dbl"), effects=effect_lst(outer_shdw(8, 6, 45, alpha=50))),
             dict(geom="ellipse", line=ln(2, "000000")), dict(geom="roundRect", av={"adj": 30000}, line=ln(2, "00B050"))]
    labels = ["rot 30", "flipH", "flipV", "rot 200 flipH", "6pt border", "dbl border + shadow", "ellipse geometry", "roundRect geometry"]
    for (x, y, w, h), kw, lbl in zip(grid_cells(4, 2, 0.4, 1.5, 9.2, 5.6, 0.3, 0.5), specs, labels):
        sid = s.nid()
        s.add(pic(sid, lbl, rid, inch(x + 0.1), inch(y + 0.1), inch(w - 0.2), inch(h - 0.55), **kw))
        s.label(x, y + h - 0.33, w, 0.3, lbl, sz=9)
    s = d.slide(title="Blip effects")
    rid = s.image(media.jpeg_photo(), "jpeg")
    s.shape(0.4, 1.5, 9.2, 5.6, fill=patt("smCheck", "D9D9D9", "FFFFFF"))
    effects = [("alphaModFix 50%", '<a:alphaModFix amt="50000"/>'), ("grayscl", "<a:grayscl/>"),
               ("biLevel 50%", '<a:biLevel thresh="50000"/>'), ("lum bright +30 contrast +40", '<a:lum bright="30000" contrast="40000"/>'),
               ("duotone navy/gold", f'<a:duotone>{clr("prst:navy")}{clr("FFC000")}</a:duotone>'),
               ("clrChange sky->transparent", '<a:clrChange><a:clrFrom><a:srgbClr val="9AB2EB"/></a:clrFrom>'
                                              '<a:clrTo><a:srgbClr val="9AB2EB"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>'),
               ("hsl sat -100 (desaturate)", '<a:hsl hue="0" sat="-100000" lum="0"/>'),
               ("tint 50% + lum -20", '<a:tint hue="0" amt="50000"/><a:lum bright="-20000"/>')]
    for (x, y, w, h), (lbl, inner) in zip(grid_cells(4, 2, 0.4, 1.5, 9.2, 5.6, 0.3, 0.5), effects):
        sid = s.nid()
        s.add(pic(sid, lbl, rid, inch(x), inch(y), inch(w), inch(h - 0.35), blip_inner=inner))
        s.label(x, y + h - 0.33, w, 0.3, lbl, sz=9)
    return d


def xlsx_blob(rows) -> bytes:
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    ws = wb.add_worksheet("Summary")
    bold = wb.add_format({"bold": True})
    money = wb.add_format({"num_format": "#,##0;(#,##0)"})
    for ri, row in enumerate(rows):
        for ci, v in enumerate(row):
            if isinstance(v, (int, float)):
                ws.write_number(ri, ci, v, money)
            else:
                ws.write_string(ri, ci, v, bold if ri == 0 else None)
    ws.set_column(0, 0, 24)
    wb.close()
    return buf.getvalue()


def deck_ole() -> Deck:
    d = Deck("ole-embedded-objects", "OLE: embedded Excel worksheet with EMF preview",
             "p:oleObj graphic frames embedding an .xlsx package: one displayed as content with an EMF preview "
             "picture (as Excel writes for pasted tables), one displayed as an icon.", ["ole", "emf", "embedded-xlsx"])
    rows = [["($ thousands)", "FY2023", "FY2024", "Change"], ["Revenue", 118200, 132400, 14200],
            ["Cost of revenue", -51300, -55900, -4600], ["Gross profit", 66900, 76500, 9600],
            ["Operating expenses", -40100, -42800, -2700], ["Operating income", 26800, 33700, 6900]]
    blob = xlsx_blob(rows)

    def fmt(v):
        return v if isinstance(v, str) else (f"({abs(v):,})" if v < 0 else f"{v:,}")

    emf = media.emf_table([[fmt(v) for v in row] for row in rows], [180, 90, 90, 90])
    s = d.slide(title="Embedded worksheet shown as content (EMF preview)")
    part = EmbeddedXlsxPart.new(blob, d.prs.part.package)
    ole_rid = s.s.part.relate_to(part, RT.PACKAGE)
    img_rid = s.image(emf, "emf")
    x, y, w, h = inch(1.0), inch(2.0), inch(8.0), inch(3.6)
    sid = s.nid()
    s.add(f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{sid}" name="Object {sid}"/><p:cNvGraphicFramePr>'
          f'<a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
          f'<p:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></p:xfrm><a:graphic>'
          '<a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">'
          f'<p:oleObj name="Worksheet" r:id="{ole_rid}" imgW="{w}" imgH="{h}" progId="Excel.Sheet.12"><p:embed/>'
          f'<p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill>'
          f'<a:blip r:embed="{img_rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>{xfrm(x, y, w, h)}'
          f'{prst_geom("rect")}</p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>')
    s.label(1.0, 5.8, 8.0, 0.4, "Double-click target in PowerPoint; renderers draw the EMF preview", sz=11)
    s = d.slide(title="Embedded worksheet shown as an icon")
    s.s.shapes.add_ole_object(io.BytesIO(blob), "Excel.Sheet.12", Inches(4.0), Inches(3.0))
    return d


# =============================================================================
# Tables
# =============================================================================

def set_cell(cell, paras=None, anchor=None, margins=None, fill=None, borders=None, vert=None):
    """Rebuild a table cell's txBody/tcPr in schema order. borders: {"L": lnxml, "R":..., "T", "B", "TlToBr", "BlToTr"}."""
    tc = cell._tc
    if paras is not None:
        tc.replace(tc.find(qn("a:txBody")), parse(body(*paras, tag="a:txBody")))
    tcpr = tc.get_or_add_tcPr()
    for k, v in (("anchor", anchor), ("vert", vert)):
        if v:
            tcpr.set(k, v)
    if margins:
        for k, v in zip(("marL", "marR", "marT", "marB"), margins):
            tcpr.set(k, str(inch(v)))
    keep_fill = None
    for child in list(tcpr):
        if child.tag in (qn("a:solidFill"), qn("a:gradFill"), qn("a:noFill"), qn("a:pattFill")):
            keep_fill = child
        tcpr.remove(child)
    for side in ("L", "R", "T", "B", "TlToBr", "BlToTr"):
        if borders and side in borders:
            tcpr.append(parse(borders[side]))
    if fill is not None:
        tcpr.append(parse(fill))
    elif keep_fill is not None:
        tcpr.append(keep_fill)


def border(side: str, w=1.0, color="000000", **kw) -> str:
    if w == 0:
        return f'<a:ln{side} w="0"><a:noFill/></a:ln{side}>'
    return tag_ln(f"ln{side}", w, color, **kw)


NO_STYLE_NO_GRID = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"


def add_table(s: Slide, rows: int, cols: int, x, y, w, h, style: str | None = None, flags=None):
    gf = s.s.shapes.add_table(rows, cols, Inches(x), Inches(y), Inches(w), Inches(h))
    tbl = gf.table
    tblpr = tbl._tbl.tblPr
    flags = flags if flags is not None else {"firstRow": True, "bandRow": True}
    for k in ("firstRow", "lastRow", "firstCol", "lastCol", "bandRow", "bandCol"):
        if k in tblpr.attrib:
            del tblpr.attrib[k]
        if flags.get(k):
            tblpr.set(k, "1")
    # No style -> explicit "No Style, No Grid" rather than relying on tableStyles.xml/@def.
    tblpr.find(qn("a:tableStyleId")).text = style or NO_STYLE_NO_GRID
    return gf, tbl


def deck_tables_basic() -> Deck:
    d = Deck("tables-merge-borders", "Tables: merged cells, borders, fills, margins, alignment",
             "Tables with gridSpan/rowSpan/hMerge/vMerge merges, per-edge borders (widths, dashes, colors, "
             "double), diagonal borders, cell fills (solid/gradient/pattern), cell margins, vertical anchors, "
             "vertical cell text and rich text in cells.", ["table", "merged-cells", "cell-borders", "cell-fills"])
    s = d.slide(title="Merged cells")
    gf, tbl = add_table(s, 5, 5, 0.5, 1.5, 9.0, 4.0, style="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}")
    for rr in range(5):
        for cc in range(5):
            tbl.cell(rr, cc).text = f"r{rr}c{cc}"
    tbl.cell(0, 0).merge(tbl.cell(0, 2))
    tbl.cell(0, 0).text = "gridSpan=3 (header)"
    tbl.cell(1, 0).merge(tbl.cell(3, 0))
    tbl.cell(1, 0).text = "rowSpan=3"
    tbl.cell(2, 2).merge(tbl.cell(3, 3))
    tbl.cell(2, 2).text = "2x2 block (gridSpan+rowSpan)"
    tbl.cell(4, 3).merge(tbl.cell(4, 4))
    tbl.cell(4, 3).text = "last row span"
    s.label(0.5, 5.7, 9.0, 0.4, "Medium Style 2 - Accent 1 with firstRow + bandRow", sz=11)
    s = d.slide(title="Borders: per edge, dashed, double, diagonal")
    gf, tbl = add_table(s, 4, 4, 0.5, 1.5, 9.0, 4.5, style=None, flags={})
    specs = [
        dict(borders={"L": border("L", 3, "C00000"), "R": border("R", 3, "C00000"), "T": border("T", 3, "C00000"), "B": border("B", 3, "C00000")}),
        dict(borders={"T": border("T", 1, "0070C0", dash="dash"), "B": border("B", 1, "0070C0", dash="dash")}),
        dict(borders={"B": border("B", 4.5, "000000", cmpd="dbl")}),
        dict(borders={"TlToBr": border("TlToBr", 1, "7F7F7F"), "BlToTr": border("BlToTr", 1, "7F7F7F")}),
        dict(borders={"L": border("L", 6, "00B050"), "R": border("R", 0)}),
        dict(borders={"T": border("T", 2, "7030A0", dash="sysDot"), "B": border("B", 2, "7030A0", dash="lgDashDot")}),
        dict(borders={"TlToBr": border("TlToBr", 2, "C00000")}),
        dict(borders={"L": border("L", 0.5, "000000"), "R": border("R", 0.5, "000000"), "T": border("T", 0.5, "000000"), "B": border("B", 0.5, "000000")}),
    ]
    labels = ["3pt red box", "dashed T/B", "double bottom", "both diagonals", "thick left / none right", "dotted/dash-dot",
              "single diagonal", "hairline box"]
    for i in range(16):
        rr, cc = divmod(i, 4)
        spec = specs[i % len(specs)]
        set_cell(tbl.cell(rr, cc), [p(r(labels[i % len(labels)], sz=12), algn="ctr")], anchor="ctr", **spec)
    s = d.slide(title="Cell fills, margins, anchors and text")
    gf, tbl = add_table(s, 3, 4, 0.5, 1.5, 9.0, 5.2, style=None, flags={})
    fills = [solid("FFF2CC"), grad([(0, "DEEBF7"), (100, "2F5597")], ang=90), patt("ltUpDiag", "BFBFBF", "FFFFFF"), NOFILL]
    for cc in range(4):
        set_cell(tbl.cell(0, cc), [p(r(["solid", "gradient", "pattern", "noFill"][cc], sz=14, b=True), algn="ctr")],
                 fill=fills[cc], anchor="ctr", borders={k: border(k, 1, "404040") for k in "LRTB"})
    for cc, (anc, mar) in enumerate([("t", (0.05, 0.05, 0.05, 0.05)), ("ctr", (0.3, 0.1, 0.3, 0.1)),
                                     ("b", (0, 0, 0, 0)), ("ctr", (0.6, 0.4, 0.1, 0.1))]):
        set_cell(tbl.cell(1, cc), [p(r(f"anchor={anc} margins={mar}", sz=11))], anchor=anc, margins=mar,
                 borders={k: border(k, 1, "404040") for k in "LRTB"}, fill=solid("F2F2F2"))
    set_cell(tbl.cell(2, 0), [p(r("vert270 cell", sz=14))], vert="vert270", anchor="ctr",
             borders={k: border(k, 1, "404040") for k in "LRTB"})
    set_cell(tbl.cell(2, 1), [p(r("Bold ", b=True, sz=14), r("italic ", i=True, sz=14), r("red", fill="C00000", sz=14)),
                              p(r("• second paragraph", sz=12), algn="r")], borders={k: border(k, 1, "404040") for k in "LRTB"})
    set_cell(tbl.cell(2, 2), [p(r("Long text wraps inside the cell: " + SAMPLE, sz=11), algn="just")],
             borders={k: border(k, 1, "404040") for k in "LRTB"})
    set_cell(tbl.cell(2, 3), [p(r("1,234.56", sz=20, latin="Courier New"), algn="r")], anchor="b",
             borders={k: border(k, 1, "404040") for k in "LRTB"})
    return d


TABLE_STYLES = [
    ("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}", "Medium Style 2 - Accent 1"),
    ("{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}", "Medium Style 2"),
    ("{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}", "Light Style 1"),
    ("{69012ECD-51FC-41F1-AA8D-1B2483CD663E}", "Light Style 2 - Accent 1"),
    ("{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}", "Light Style 3 - Accent 1"),
    ("{B301B821-A1FF-4177-AEE7-76D212191A09}", "Medium Style 1 - Accent 1"),
    ("{6E25E649-3F16-4E02-A733-19D2CDBF48F0}", "Medium Style 3 - Accent 1"),
    ("{69CF1AB2-1976-4502-BF36-3FF5EA218861}", "Medium Style 4 - Accent 1"),
    ("{E8034E78-7F5D-4C2E-B375-FC64B27BC917}", "Dark Style 1"),
    ("{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}", "Dark Style 2 - Accent 1/Accent 2"),
    ("{3C2FFA5D-87B4-456A-9821-1D502468CF0F}", "Themed Style 1 - Accent 1"),
    ("{5940675A-B579-460E-94D1-54222C63F5DA}", "No Style, Table Grid"),
]

CUSTOM_TABLE_STYLE_ID = "{D1C3A0E2-5B7F-4C11-9E3A-2F7C0B5D8A41}"
CUSTOM_TABLE_STYLE = (
    f'<a:tblStyle styleId="{CUSTOM_TABLE_STYLE_ID}" styleName="Corpus Ledger">'
    '<a:wholeTbl><a:tcTxStyle><a:font><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:font>'
    '<a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>'
    '<a:left><a:ln w="0"><a:noFill/></a:ln></a:left><a:right><a:ln w="0"><a:noFill/></a:ln></a:right>'
    '<a:top><a:ln w="6350"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:ln></a:top>'
    '<a:bottom><a:ln w="6350"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:ln></a:bottom>'
    '<a:insideH><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></a:insideH>'
    '<a:insideV><a:ln w="0"><a:noFill/></a:ln></a:insideV></a:tcBdr>'
    '<a:fill><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>'
    '<a:band1H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:srgbClr val="F2F7EC"/></a:solidFill></a:fill></a:tcStyle></a:band1H>'
    '<a:band1V><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:srgbClr val="FFF8E5"/></a:solidFill></a:fill></a:tcStyle></a:band1V>'
    '<a:lastCol><a:tcTxStyle b="on"/><a:tcStyle><a:tcBdr/></a:tcStyle></a:lastCol>'
    '<a:firstCol><a:tcTxStyle i="on"/><a:tcStyle><a:tcBdr/></a:tcStyle></a:firstCol>'
    '<a:lastRow><a:tcTxStyle b="on"/><a:tcStyle><a:tcBdr><a:top><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></a:top>'
    '<a:bottom><a:ln w="38100" cmpd="dbl"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></a:bottom></a:tcBdr></a:tcStyle></a:lastRow>'
    '<a:firstRow><a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="white"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle>'
    '<a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:srgbClr val="375623"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>'
    "</a:tblStyle>"
)


def deck_tables_styles() -> Deck:
    d = Deck("tables-builtin-styles", "Tables: built-in style GUIDs, style flags and a custom tableStyles.xml style",
             "Twelve built-in PowerPoint table styles referenced by GUID only (no definitions in tableStyles.xml, "
             "as python-pptx/LibreOffice write them), style option flags (firstRow/lastRow/firstCol/lastCol/"
             "bandRow/bandCol), and a custom style defined in tableStyles.xml.",
             ["table", "table-styles", "table-style-flags", "custom-table-style"])
    data = [["Region", "Q1", "Q2", "Q3", "Total"], ["North", "12.1", "13.4", "14.0", "39.5"], ["South", "9.8", "10.2", "11.1", "31.1"],
            ["East", "7.4", "7.9", "8.3", "23.6"], ["Total", "29.3", "31.5", "33.4", "94.2"]]
    for page in range(2):
        s = d.slide(title=f"Built-in table styles {page + 1}/2 (GUID reference only)", title_size=24)
        for (x, y, w, h), (gid, name) in zip(grid_cells(3, 2, 0.3, 1.5, 9.4, 5.8, 0.2, 0.45), TABLE_STYLES[page * 6:(page + 1) * 6]):
            gf, tbl = add_table(s, 5, 5, x, y, w, h - 0.35, style=gid, flags={"firstRow": True, "bandRow": True, "lastRow": True})
            for rr, row in enumerate(data):
                for cc, v in enumerate(row):
                    set_cell(tbl.cell(rr, cc), [p(r(v, sz=9), algn="r" if cc else "l")], margins=(0.04, 0.04, 0.02, 0.02))
            s.label(x, y + h - 0.33, w, 0.3, name, sz=9)
    s = d.slide(title="Style option flags (Medium Style 2 - Accent 1)")
    combos = [{}, {"firstRow": True}, {"firstRow": True, "bandRow": True}, {"firstCol": True, "lastCol": True},
              {"bandCol": True}, {"firstRow": True, "lastRow": True, "firstCol": True, "lastCol": True, "bandRow": True, "bandCol": True}]
    for (x, y, w, h), fl in zip(grid_cells(3, 2, 0.3, 1.5, 9.4, 5.8, 0.2, 0.45), combos):
        gf, tbl = add_table(s, 5, 5, x, y, w, h - 0.35, style=TABLE_STYLES[0][0], flags=fl)
        for rr, row in enumerate(data):
            for cc, v in enumerate(row):
                set_cell(tbl.cell(rr, cc), [p(r(v, sz=9), algn="r" if cc else "l")], margins=(0.04, 0.04, 0.02, 0.02))
        s.label(x, y + h - 0.33, w, 0.3, " ".join(fl) or "no flags", sz=8)
    s = d.slide(title="Custom table style from tableStyles.xml")
    ts_part = d.prs.part.part_related_by(RT.TABLE_STYLES)
    root = etree.fromstring(ts_part.blob)
    root.append(etree.fromstring(f'<a:root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">{CUSTOM_TABLE_STYLE}</a:root>')[0])
    ts_part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    gf, tbl = add_table(s, 6, 5, 1.0, 1.7, 8.0, 3.6, style=CUSTOM_TABLE_STYLE_ID,
                        flags={"firstRow": True, "lastRow": True, "firstCol": True, "lastCol": True, "bandRow": True})
    rows6 = data[:-1] + [["West", "5.0", "5.5", "6.1", "16.6"], ["Total", "34.3", "37.0", "39.5", "110.8"]]
    for rr, row in enumerate(rows6):
        for cc, v in enumerate(row):
            set_cell(tbl.cell(rr, cc), [p(r(v, sz=14), algn="r" if cc else "l")])
    s.label(1.0, 5.5, 8.0, 0.6, "Corpus Ledger: wholeTbl/band1H/firstRow/lastRow/firstCol/lastCol parts, insideH rules, "
                                "double rule under the total row", sz=11)
    return d


INCOME = [
    ("Revenue", None, None, "h"),
    ("Product", 84_210, 76_532, "1"), ("Subscription", 41_880, 33_015, "1"), ("Services", 6_310, 8_702, "1"),
    ("Total revenue", 132_400, 118_249, "sub"),
    ("Cost of revenue", None, None, "h"),
    ("Product", -36_115, -34_020, "1"), ("Subscription", -12_904, -10_867, "1"), ("Services", -6_881, -6_413, "1"),
    ("Total cost of revenue", -55_900, -51_300, "sub"),
    ("Gross profit", 76_500, 66_949, "sub2"),
    ("Operating expenses", None, None, "h"),
    ("Research and development", -18_204, -16_877, "1"), ("Sales and marketing", -15_993, -15_120, "1"),
    ("General and administrative", -8_603, -8_102, "1"), ("Restructuring", 0, -1_250, "1"),
    ("Total operating expenses", -42_800, -41_349, "sub"),
    ("Operating income", 33_700, 25_600, "sub2"),
    ("Interest expense, net", -1_215, -1_480, "1"), ("Other income (expense)", 342, -95, "1"),
    ("Income before income taxes", 32_827, 24_025, "sub"),
    ("Provision for income taxes", -6_894, -4_805, "1"),
    ("Net income", 25_933, 19_220, "total"),
    ("Diluted EPS", 1.27, 0.94, "eps"),
]


def fmt_money(v, eps=False):
    if v is None:
        return ""
    if eps:
        return f"$ {v:.2f}"
    if v == 0:
        return "—"
    return f"({abs(v):,})" if v < 0 else f"{v:,}"


def income_statement(s: Slide, x, y, w, row_h=0.205, font=9, styled=True):
    gf, tbl = add_table(s, len(INCOME) + 1, 4, x, y, w, row_h * (len(INCOME) + 1), style=None, flags={})
    widths = [w * 0.52, w * 0.17, w * 0.17, w * 0.14]
    for i, cw in enumerate(widths):
        tbl.columns[i].width = Inches(cw)
    for rr in range(len(INCOME) + 1):
        tbl.rows[rr].height = Inches(row_h)
    none = {k: border(k, 0) for k in "LRTB"}
    hdr = ["(in thousands, except per share)", "FY2024", "FY2023", "% chg"]
    for cc, t in enumerate(hdr):
        set_cell(tbl.cell(0, cc), [p(r(t, sz=font, b=True), algn="l" if cc == 0 else "r")], anchor="b",
                 margins=(0.05, 0.05, 0.01, 0.01), fill=NOFILL,
                 borders={**none, "B": border("B", 1, "000000")})
    for rr, (label_, cur, prev, kind) in enumerate(INCOME, start=1):
        bold = kind in ("sub2", "total", "h")
        indent = 0.15 if kind == "1" else 0
        cells = [label_, fmt_money(cur, kind == "eps"), fmt_money(prev, kind == "eps"), ""]
        if cur is not None and prev not in (None, 0):
            chg = (cur - prev) / abs(prev) * 100
            cells[3] = f"{chg:.1f}%" if chg >= 0 else f"({abs(chg):.1f}%)"
        # Accounting rules sit over the numeric columns only: single above subtotals, double under the total.
        rules = dict(none)
        if kind in ("sub", "sub2", "total"):
            rules["T"] = border("T", 0.75, "000000")
        if kind == "total":
            rules["B"] = border("B", 2.25, "000000", cmpd="dbl")
        fill = solid("F2F2F2") if (styled and kind == "sub2") else NOFILL
        for cc, t in enumerate(cells):
            neg = t.startswith("(")
            run = r(t, sz=font, b=bold, fill=("C00000" if neg and styled else "000000"),
                    i=(kind == "h" or None), u=("sng" if kind == "h" and cc == 0 else None))
            set_cell(tbl.cell(rr, cc), [p(run, algn="l" if cc == 0 else "r", mar_l=indent if cc == 0 else None)],
                     anchor="ctr", margins=(0.05, 0.05, 0.0, 0.0), fill=fill, borders=rules if cc > 0 else none)
    return tbl


def deck_tables_financial() -> Deck:
    d = Deck("tables-financial-statement", "Tables: income statement and balance sheet formatting",
             "A 25-row income statement table: right-aligned numbers, parenthesized negatives in red, em-dash "
             "zeros, indented line items, subtotal rules, double rule under net income, shaded key rows, 9pt "
             "text; plus a balance sheet with column groups and footnote markers.",
             ["table", "financial-table", "number-alignment", "cell-borders"])
    s = d.slide(title="Consolidated Statement of Operations", title_size=24)
    income_statement(s, 0.8, 1.35, 8.4)
    s.textbox(0.8, 6.85, 8.4, 0.4, p(r("Unaudited. Amounts may not sum due to rounding. Fictional company for test purposes.",
                                       sz=8, i=True, fill="595959")))
    s = d.slide(title="Condensed Balance Sheet", title_size=24)
    rows = [("", "Dec 31, 2024", "Dec 31, 2023", "hdr"), ("Assets", "", "", "h"),
            ("Cash and cash equivalents", "210,415", "185,230", "1"), ("Short-term investments", "99,800", "88,120", "1"),
            ("Accounts receivable, net (1)", "41,770", "37,904", "1"), ("Total current assets", "351,985", "311,254", "sub"),
            ("Property and equipment, net", "62,410", "58,013", "1"), ("Goodwill (2)", "120,000", "120,000", "1"),
            ("Total assets", "534,395", "489,267", "total"), ("Liabilities and equity", "", "", "h"),
            ("Accounts payable", "18,442", "17,010", "1"), ("Deferred revenue", "73,915", "66,402", "1"),
            ("Long-term debt", "150,000", "175,000", "1"), ("Total liabilities", "242,357", "258,412", "sub"),
            ("Stockholders' equity", "292,038", "230,855", "1"), ("Total liabilities and equity", "534,395", "489,267", "total")]
    gf, tbl = add_table(s, len(rows), 3, 1.2, 1.4, 7.6, 0.31 * len(rows), style=None, flags={})
    tbl.columns[0].width, tbl.columns[1].width, tbl.columns[2].width = Inches(4.0), Inches(1.8), Inches(1.8)
    none = {k: border(k, 0) for k in "LRTB"}
    for rr, (lbl, a, b, kind) in enumerate(rows):
        brd = dict(none)
        if kind == "hdr":
            brd["B"] = border("B", 1.5, "1F3864")
        if kind == "sub":
            brd["T"] = border("T", 0.75, "000000")
        if kind == "total":
            brd["T"] = border("T", 0.75, "000000")
            brd["B"] = border("B", 2.25, "000000", cmpd="dbl")
        for cc, t in enumerate((lbl, a, b)):
            set_cell(tbl.cell(rr, cc), [p(r(t, sz=11, b=kind in ("hdr", "total", "h"), fill="1F3864" if kind == "hdr" else "000000"),
                                          algn="l" if cc == 0 else "r", mar_l=0.2 if (kind == "1" and cc == 0) else None)],
                     anchor="ctr", margins=(0.06, 0.06, 0.0, 0.0), fill=solid("DEEBF7") if kind == "hdr" else NOFILL,
                     borders=brd if (cc > 0 or kind == "hdr") else none)
    s.textbox(1.2, 6.55, 7.6, 0.7, p(r("(1) Net of allowance of $1.2 million.  (2) No impairment recorded.", sz=8, fill="595959")),
              p(r("Fictional company; figures for rendering tests only.", sz=8, i=True, fill="595959")))
    return d


# =============================================================================
# Charts
# =============================================================================

def cat_data(categories, series, fmt="#,##0"):
    cd = CategoryChartData(number_format=fmt)
    cd.categories = categories
    for name, vals in series:
        cd.add_series(name, vals)
    return cd


def add_chart(s: Slide, kind, x, y, w, h, data, title=None, legend=XL_LEGEND_POSITION.BOTTOM, labels=False, num_fmt=None):
    gf = s.s.shapes.add_chart(kind, Inches(x), Inches(y), Inches(w), Inches(h), data)
    ch = gf.chart
    if title:
        ch.has_title = True
        ch.chart_title.text_frame.text = title
        ch.chart_title.text_frame.paragraphs[0].runs[0].font.size = Pt(14)
    ch.has_legend = legend is not None
    if legend is not None:
        ch.legend.position = legend
        ch.legend.include_in_layout = False
    if labels:
        plot = ch.plots[0]
        plot.has_data_labels = True
        if num_fmt:
            plot.data_labels.number_format = num_fmt
            plot.data_labels.number_format_is_linked = False
    return ch


def deck_charts_basic() -> Deck:
    d = Deck("charts-basic", "Charts: column, bar, line, pie, doughnut, area",
             "Native charts with embedded workbooks: clustered and stacked columns, clustered bars, line with "
             "markers, pie with percentage labels, doughnut, stacked area; titles, legends, data labels, number "
             "formats and gridlines.", ["chart", "column-chart", "bar-chart", "line-chart", "pie-chart", "area-chart"])
    q = ["Q1", "Q2", "Q3", "Q4"]
    s = d.slide(title="Column charts")
    ch = add_chart(s, XL_CHART_TYPE.COLUMN_CLUSTERED, 0.3, 1.4, 4.6, 5.6,
                   cat_data(q, [("FY2023", (24.1, 26.3, 25.8, 30.2)), ("FY2024", (27.4, 29.9, 31.2, 35.6))], "0.0"),
                   "Revenue ($M)", labels=True, num_fmt="0.0")
    ch.value_axis.has_major_gridlines = True
    ch.value_axis.tick_labels.number_format = '"$"0'
    ch.value_axis.tick_labels.number_format_is_linked = False
    add_chart(s, XL_CHART_TYPE.COLUMN_STACKED, 5.1, 1.4, 4.6, 5.6,
              cat_data(q, [("Product", (14, 15, 16, 18)), ("Services", (6, 7, 7, 8)), ("Other", (2, 2, 3, 3))]),
              "Revenue mix (stacked)")
    s = d.slide(title="Bar and line charts")
    add_chart(s, XL_CHART_TYPE.BAR_CLUSTERED, 0.3, 1.4, 4.6, 5.6,
              cat_data(["North", "South", "East", "West", "Central"], [("Units", (420, 380, 515, 290, 330))]),
              "Units by region", legend=None, labels=True)
    ch = add_chart(s, XL_CHART_TYPE.LINE_MARKERS, 5.1, 1.4, 4.6, 5.6,
                   cat_data(["Jan", "Feb", "Mar", "Apr", "May", "Jun"], [("Bookings", (5.1, 5.6, 6.2, 5.9, 6.8, 7.4)),
                                                                         ("Billings", (4.8, 5.0, 5.9, 6.1, 6.3, 7.0))], "0.0"),
                   "Monthly bookings vs billings")
    for i, ser in enumerate(ch.plots[0].series):
        ser.marker.style = [XL_MARKER_STYLE.CIRCLE, XL_MARKER_STYLE.DIAMOND][i]
        ser.marker.size = 8
        ser.smooth = i == 1
    s = d.slide(title="Pie, doughnut and area charts")
    ch = add_chart(s, XL_CHART_TYPE.PIE, 0.2, 1.4, 3.3, 5.5,
                   cat_data(["Payroll", "Benefits", "Operations", "Capital"], [("Mix", (0.42, 0.23, 0.20, 0.15))], "0%"),
                   "Spending mix", labels=True, num_fmt="0%")
    ch.plots[0].data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
    add_chart(s, XL_CHART_TYPE.DOUGHNUT, 3.4, 1.4, 3.2, 5.5,
              cat_data(["Equity", "Debt", "Cash"], [("Funding", (55, 30, 15))]), "Funding sources")
    add_chart(s, XL_CHART_TYPE.AREA_STACKED, 6.6, 1.4, 3.2, 5.5,
              cat_data(["2020", "2021", "2022", "2023", "2024"], [("Fees", (3, 4, 4.5, 5, 6)), ("Interest", (2, 2.2, 3, 3.5, 3.6))]),
              "Income streams")
    return d


def make_combo(chart, line_fmt="0%"):
    """Move the second bar series onto a line chart with secondary axes."""
    cs = chart._chartSpace
    plot_area = cs.find(".//" + qn("c:plotArea"))
    bar = plot_area.find(qn("c:barChart"))
    sers = bar.findall(qn("c:ser"))
    s2 = sers[1]
    bar.remove(s2)
    tx = etree.tostring(s2.find(qn("c:tx"))).decode()
    cat = etree.tostring(s2.find(qn("c:cat"))).decode()
    val = etree.tostring(s2.find(qn("c:val"))).decode()
    cns = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    line = etree.fromstring(
        f'<c:lineChart {cns}><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="1"/><c:order val="1"/>{tx}'
        '<c:spPr><a:ln w="31750" cap="rnd"><a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill><a:round/></a:ln></c:spPr>'
        '<c:marker><c:symbol val="circle"/><c:size val="7"/></c:marker>'
        f'{cat}{val}<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="50020001"/><c:axId val="50020002"/></c:lineChart>')
    bar.addnext(line)
    last_ax = plot_area.findall(qn("c:valAx"))[-1]
    axes = etree.fromstring(
        f'<root {cns}><c:catAx><c:axId val="50020001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/>'
        '<c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
        '<c:crossAx val="50020002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>'
        '<c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="50020002"/><c:scaling><c:orientation val="minMax"/></c:scaling>'
        f'<c:delete val="0"/><c:axPos val="r"/><c:numFmt formatCode="{line_fmt}" sourceLinked="0"/><c:majorTickMark val="out"/>'
        '<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="50020001"/><c:crosses val="max"/>'
        '<c:crossBetween val="between"/></c:valAx></root>')
    for ax in reversed(list(axes)):
        last_ax.addnext(ax)


def deck_charts_advanced() -> Deck:
    d = Deck("charts-advanced", "Charts: combo (secondary axis), scatter, bubble, radar, 100% stacked, waterfall",
             "Bar+line combo with a secondary percentage axis (XML-injected), XY scatter with lines, bubble, "
             "filled radar, 100% stacked bars, exploded pie, and a waterfall built from a stacked column with an "
             "invisible base series.", ["chart", "combo-chart", "secondary-axis", "scatter-chart", "bubble-chart", "radar-chart"])
    s = d.slide(title="Combo chart with secondary axis")
    ch = add_chart(s, XL_CHART_TYPE.COLUMN_CLUSTERED, 0.5, 1.4, 9.0, 5.7,
                   cat_data(["FY20", "FY21", "FY22", "FY23", "FY24"], [("Revenue ($M)", (88, 97, 104, 118, 132)),
                                                                        ("Operating margin", (0.18, 0.20, 0.19, 0.22, 0.25))], "0.00"),
                   "Revenue and operating margin")
    make_combo(ch)
    s = d.slide(title="Scatter, bubble and radar")
    xy = XyChartData()
    for name, pts in (("Plan", [(1, 2.0), (2, 2.8), (3, 3.1), (4, 4.4), (5, 5.0)]), ("Actual", [(1, 1.7), (2, 3.1), (3, 3.0), (4, 4.9), (5, 5.6)])):
        ser = xy.add_series(name)
        for xv, yv in pts:
            ser.add_data_point(xv, yv)
    add_chart(s, XL_CHART_TYPE.XY_SCATTER_LINES, 0.2, 1.4, 3.3, 5.6, xy, "Plan vs actual (XY)")
    bub = BubbleChartData()
    ser = bub.add_series("Segments")
    for xv, yv, zv in ((5, 12, 30), (9, 18, 60), (14, 9, 20), (18, 22, 80)):
        ser.add_data_point(xv, yv, zv)
    add_chart(s, XL_CHART_TYPE.BUBBLE, 3.4, 1.4, 3.2, 5.6, bub, "Growth vs margin (bubble)", legend=None)
    add_chart(s, XL_CHART_TYPE.RADAR_FILLED, 6.6, 1.4, 3.2, 5.6,
              cat_data(["Liquidity", "Leverage", "Growth", "Margin", "Efficiency"], [("Score", (4, 3, 5, 4, 2))]), "Scorecard")
    s = d.slide(title="100% stacked bar and exploded pie")
    add_chart(s, XL_CHART_TYPE.BAR_STACKED_100, 0.3, 1.4, 5.2, 5.6,
              cat_data(["2022", "2023", "2024"], [("Domestic", (60, 55, 52)), ("Europe", (25, 28, 30)), ("Asia", (15, 17, 18))]),
              "Revenue by geography")
    ch = add_chart(s, XL_CHART_TYPE.PIE_EXPLODED, 5.6, 1.4, 4.1, 5.6,
                   cat_data(["A", "B", "C", "D"], [("Share", (40, 30, 20, 10))]), "Exploded pie", labels=True)
    s = d.slide(title="Waterfall (stacked columns with invisible base)")
    cats = ["FY23 EBITDA", "Volume", "Price", "Mix", "Costs", "FX", "FY24 EBITDA"]
    base = (0, 30.0, 34.5, 35.2, 34.0, 33.4, 0)
    up = (0, 4.5, 2.5, 0, 0, 0, 0)
    down = (0, 0, 0, 1.8, 1.2, 0.6, 0)
    total = (30.0, 0, 0, 0, 0, 0, 33.4)
    ch = add_chart(s, XL_CHART_TYPE.COLUMN_STACKED, 0.5, 1.4, 9.0, 5.7,
                   cat_data(cats, [("Base", base), ("Increase", up), ("Decrease", down), ("Total", total)], "0.0"),
                   "EBITDA bridge ($M)", legend=None)
    plot = ch.plots[0]
    plot.gap_width = 60
    plot.overlap = 100
    colors = [None, "70AD47", "C00000", "2F5597"]
    for ser, col in zip(plot.series, colors):
        if col is None:
            ser.format.fill.background()
            ser.format.line.fill.background()
        else:
            ser.format.fill.solid()
            ser.format.fill.fore_color.rgb = RGBColor.from_string(col)
    return d


# =============================================================================
# Groups and slide-level features
# =============================================================================

def deck_groups() -> Deck:
    d = Deck("groups-nested-transforms", "Groups: nesting, child scaling, rotation and flips",
             "Groups nested three levels deep whose chOff/chExt differ from off/ext (scaling children; text is not "
             "scaled), rotated groups with rotated children, flipped groups (text stays readable), non-uniform "
             "group scaling, and a group of a picture, connector and text.",
             ["group", "nested-group", "group-scaling", "rotation", "flip"])
    s = d.slide(title="Nested groups with child coordinate scaling")

    def leaf(name, x, y, w, h, geom, col, text):
        return sp(s.nid(), name, x, y, w, h, geom=geom, fill=solid(col), line=ln(1, "404040"),
                  text=body(p(r(text, sz=12), algn="ctr"), anchor="ctr"))

    U = 914400
    lvl3 = grp(s.nid(), "Level 3 group", 2 * U, 2 * U, 2 * U, 1 * U, (0, 0, 4 * U, 2 * U),
               leaf("L3 a", 0, 0, 2 * U, 2 * U, "ellipse", "FFC000", "L3 (x0.5)") +
               leaf("L3 b", 2 * U, 0, 2 * U, 2 * U, "triangle", "ED7D31", "L3"))
    lvl2 = grp(s.nid(), "Level 2 group", 0, 0, 4 * U, 3 * U, (0, 0, 4 * U, 3 * U),
               leaf("L2 rect", 0, 0, 2 * U, 1.5 * U, "rect", "A9D18E", "L2") + lvl3 +
               leaf("L2 star", 0, 1.6 * U, 1.8 * U, 1.3 * U, "star5", "9DC3E6", "L2"))
    lvl1 = grp(s.nid(), "Level 1 group", inch(0.5), inch(1.6), inch(5.5), inch(4.1), (0, 0, 4 * U, 3 * U), lvl2)
    s.add(lvl1)
    s.label(0.5, 5.9, 5.5, 0.6, "Outer group ext 5.5x4.1in, chExt 4x3in (x1.375); level-3 chExt is 2x its ext", sz=10)
    lvl_stretch = grp(s.nid(), "Non-uniform group", inch(6.4), inch(1.6), inch(3.2), inch(4.1), (0, 0, 2 * U, 2 * U),
                      leaf("circle in stretched group", 0, 0, 2 * U, 2 * U, "ellipse", "C9C9C9", "Stretched circle"))
    s.add(lvl_stretch)
    s = d.slide(title="Rotated and flipped groups")
    for i, (rot, fh, fv) in enumerate([(0, False, False), (30, False, False), (0, True, False), (0, False, True), (200, True, False)]):
        x = 0.5 + (i % 3) * 3.1
        y = 1.6 + (i // 3) * 2.9
        kids = (sp(s.nid(), "arrow", 0, 0, 2 * U, U, geom="rightArrow", fill=solid("5B9BD5"), line=ln(1, "1F4E79"),
                   text=body(p(r(f"rot {rot} {'H' if fh else ''}{'V' if fv else ''}", sz=12), algn="ctr"), anchor="ctr")) +
                sp(s.nid(), "tag", int(0.1 * U), int(1.1 * U), int(0.9 * U), int(0.6 * U), geom="rect", rot=15,
                   fill=solid("FFC000"), text=body(p(r("child rot 15", sz=8), algn="ctr"), anchor="ctr")))
        s.add(grp(s.nid(), f"group {i}", inch(x), inch(y), inch(2.4), inch(2.0), (0, 0, 2 * U, int(1.7 * U)), kids,
                  rot=rot, flip_h=fh, flip_v=fv))
    s = d.slide(title="Group of picture, connector and text")
    rid = s.image(media.png_logo(), "png")
    a_id, b_id = s.nid(), s.nid()
    kids = (sp(a_id, "node A", 0, 0, int(1.2 * U), int(0.8 * U), geom="roundRect", fill=solid("DEEBF7"), line=ln(1, "2F5597"),
               text=body(p(r("Node A", sz=12), algn="ctr"), anchor="ctr")) +
            sp(b_id, "node B", int(3 * U), int(1.5 * U), int(1.2 * U), int(0.8 * U), geom="roundRect", fill=solid("DEEBF7"),
               line=ln(1, "2F5597"), text=body(p(r("Node B", sz=12), algn="ctr"), anchor="ctr")) +
            cxn(s.nid(), "link", int(1.2 * U), int(0.4 * U), int(1.8 * U), int(1.5 * U), geom="bentConnector3",
                st=(a_id, 3), end=(b_id, 1), line=ln(2, "2F5597", tail=("triangle",))) +
            pic(s.nid(), "logo", rid, int(1.5 * U), int(1.6 * U), int(0.8 * U), int(0.8 * U)))
    s.add(grp(s.nid(), "mixed group", inch(1.0), inch(2.0), inch(6.3), inch(3.6), (0, 0, int(4.2 * U), int(2.4 * U)), kids))
    return d


def add_sections(prs, sections):
    pres = prs.part._element
    ext_lst = pres.find(qn("p:extLst"))
    if ext_lst is None:
        ext_lst = parse("<p:extLst/>")
        pres.append(ext_lst)
    secs = "".join(
        f'<p14:section name="{esc(name)}" id="{guid("section-" + name)}"><p14:sldIdLst>'
        + "".join(f'<p14:sldId id="{sl.slide_id}"/>' for sl in slides) + "</p14:sldIdLst></p14:section>"
        for name, slides in sections)
    ext_lst.append(parse(f'<p:ext uri="{{521415D9-36F7-43E2-AB2F-B90AF26B5E84}}"><p14:sectionLst>{secs}</p14:sectionLst></p:ext>'))


def add_comments(deck: Deck, slide: Slide, comments):
    pkg = deck.prs.part.package
    authors = Part(PackURI("/ppt/commentAuthors.xml"),
                   "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml", pkg,
                   ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                    '<p:cmAuthorLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
                    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
                    f'<p:cmAuthor id="0" name="Corpus Reviewer" initials="CR" lastIdx="{len(comments)}" clrIdx="0"/>'
                    "</p:cmAuthorLst>").encode())
    deck.prs.part.relate_to(authors, RT.COMMENT_AUTHORS)
    cms = "".join(f'<p:cm authorId="0" dt="2024-01-0{i + 1}T09:00:00.000" idx="{i + 1}"><p:pos x="{x}" y="{y}"/>'
                  f"<p:text>{esc(t)}</p:text></p:cm>" for i, (x, y, t) in enumerate(comments))
    part = Part(PackURI("/ppt/comments/comment1.xml"),
                "application/vnd.openxmlformats-officedocument.presentationml.comments+xml", pkg,
                ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                 '<p:cmLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
                 f'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">{cms}</p:cmLst>').encode())
    slide.s.part.relate_to(part, RT.COMMENTS)


def deck_slide_features() -> Deck:
    d = Deck("slide-features", "Slide features: hidden slide, notes, sections, hyperlinks, footers, comments",
             "A hidden slide (show=0), speaker notes, p14 sections, external/mailto/slide-jump/next-slide "
             "hyperlinks on text and shapes, date/footer/slide-number placeholders, a text field gallery (slide 4 "
             "has live datetime fields: renderers substitute the current date, so mask it in pixel diffs) and "
             "legacy comments.", ["hidden-slide", "notes", "sections", "hyperlink", "footer", "fields", "comments"])
    s1 = d.slide("Title Slide")
    s1.s.shapes.title.text = "Slide features"
    s1.s.placeholders[1].text = "Hidden slide · notes · sections · links · footers"
    s1.footers("Corpus · Confidential")
    s1.note("Speaker notes on the title slide. Second sentence of the notes.")
    s2 = d.slide("Title and Content", "This slide is hidden (show=\"0\")")
    s2.s._element.set("show", "0")
    s2.s.placeholders[1].text = "Hidden slides are skipped in slide shows but still rendered in exports with ExportHiddenSlides."
    s2.footers("Corpus · Confidential")
    s3 = d.slide("Title and Content", "Hyperlinks")
    tf_el = s3.s.placeholders[1]._element
    paras = [p(r("External URL: "), r("example.com", hlink=f'<a:hlinkClick r:id="{s3.link("https://example.com/report")}"/>')),
             p(r("Email: "), r("finance@example.com", hlink=f'<a:hlinkClick r:id="{s3.link("mailto:finance@example.com")}"/>')),
             p(r("Jump to first slide", hlink=f'<a:hlinkClick r:id="{s3.slide_link(s1)}" action="ppaction://hlinksldjump"/>')),
             p(r("Next slide action", hlink='<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=nextslide"/>'))]
    tf_el.replace(tf_el.txBody, parse(body(*paras)))
    sid = s3.nid()
    s3.add(sp(sid, "Linked button", inch(6.5), inch(5.5), inch(2.5), inch(0.9), geom="actionButtonHome",
              fill=solid("scheme:accent1"), line=ln(1, "1F3864"),
              hlink=f'<a:hlinkClick r:id="{s3.slide_link(s1)}" action="ppaction://hlinksldjump"/>'))
    s3.footers("Corpus · Confidential")
    s3.note("Notes: hyperlinks on runs and on a shape (cNvPr/hlinkClick).")
    s4 = d.slide(title="Text fields")
    fields = [("slidenum", "4"), ("datetime1", "1/1/2024"), ("datetime2", "Monday, January 1, 2024"),
              ("datetime4", "January 1, 2024"), ("datetime8", "1/1/2024 9:00 AM"), ("datetime12", "9:00:00 AM")]
    s4.textbox(0.6, 1.6, 8.8, 4.0, *[p(r(f"{t}: ", sz=16, fill="7F7F7F"), fld(t, v, f"fld-{t}", sz=20)) for t, v in fields])
    s4.footers("Corpus · Confidential")
    add_comments(d, s4, [(10, 10, "Check the date format."), (400, 300, "Second comment on the same slide.")])
    s5 = d.slide("Section Header", "Appendix")
    s5.s.placeholders[1].text = "Last section"
    s5.footers("Corpus · Confidential")
    add_sections(d.prs, [("Introduction", [s1.s, s2.s]), ("Details", [s3.s, s4.s]), ("Appendix", [s5.s])])
    return d


def deck_a4_portrait() -> Deck:
    d = Deck("size-a4-portrait", "Slide size: A4 portrait (custom size)",
             "A custom 210x297 mm portrait slide size with the template rescaled; title, body, picture, table and "
             "shapes laid out for portrait.", ["slide-size", "portrait", "custom-size"], size=A4_PORTRAIT)
    s = d.slide("Title and Content", "A4 portrait report page")
    tf = s.s.placeholders[1].text_frame
    tf.text = "Portrait slides are common for one-page financial summaries."
    for t in ("Revenue up 12%", "Margin 25%", "Cash $310M"):
        tf.add_paragraph().text = t
    s = d.slide("Title Only", "Summary table and chart area")
    gf, tbl = add_table(s, 4, 3, 0.5, 1.8, 7.27, 2.0, style=TABLE_STYLES[0][0])
    for rr, row in enumerate([["Metric", "2023", "2024"], ["Revenue", "118.2", "132.4"], ["EBITDA", "30.0", "33.4"], ["Net income", "19.2", "25.9"]]):
        for cc, v in enumerate(row):
            set_cell(tbl.cell(rr, cc), [p(r(v, sz=14), algn="r" if cc else "l")])
    rid = s.image(media.emf_bar_chart(), "emf")
    sid = s.nid()
    s.add(pic(sid, "chart emf", rid, inch(0.5), inch(4.3), inch(7.27), inch(4.5)))
    s.shape(0.5, 9.3, 7.27, 1.6, geom="roundRect", fill=solid("DEEBF7"), line=ln(1, "2F5597"),
            text=body(p(r("Footer note box at the bottom of an A4 page", sz=14), algn="ctr"), anchor="ctr"))
    return d


def deck_kitchen_sink() -> Deck:
    d = Deck("kitchen-sink-financial", "Kitchen sink: 16:9 quarterly financial review deck",
             "A realistic 16:9 earnings-style deck for a fictional company: title slide with logo, agenda, KPI "
             "cards with deltas and shadows, combo revenue chart, income statement table, segment doughnut, "
             "EBITDA waterfall, 8pt footnotes, and footers with slide numbers on every slide.",
             ["kitchen-sink", "16:9", "chart", "table", "kpi-cards", "footer", "financial-table"], size=(W169, H43))
    logo = media.png_logo()
    FOOT = "Northwind Analytics · Q3 FY2024"

    def deco(s, dark=False):
        s.shape(0, 0, 13.333, 0.12, fill=solid("1F4E79"), name="Top bar")
        rid = s.image(logo, "png")
        s.add(pic(s.nid(), "Logo", rid, inch(12.45), inch(6.75), inch(0.55), inch(0.55)))

    s = d.slide("Title Slide")
    s.s.shapes.title.text = "Q3 FY2024 Earnings Review"
    s.s.placeholders[1].text = "Northwind Analytics, Inc. — October 2024"
    s.shape(0, 0, 13.333, 0.35, fill=grad([(0, "1F4E79"), (100, "2E75B6")], ang=0), name="Accent band")
    rid = s.image(logo, "png")
    s.add(pic(s.nid(), "Logo", rid, inch(5.9), inch(0.7), inch(1.5), inch(1.5)))
    s.footers(FOOT, "October 24, 2024")
    s = d.slide("Title and Content", "Agenda")
    deco(s)
    tf_el = s.s.placeholders[1]._element
    items = ["Highlights", "Financial results", "Segment performance", "Outlook", "Appendix: reconciliations"]
    tf_el.replace(tf_el.txBody, parse(body(*[p(r(t, sz=24), bullet=bullet_auto("arabicPeriod", color="scheme:accent1"),
                                               mar_l=0.5, indent=-0.5, spc_aft=("pts", 10)) for t in items])))
    s.footers(FOOT, "October 24, 2024")
    s = d.slide("Title Only", "Quarter at a glance")
    deco(s)
    kpis = [("$132.4M", "Revenue", "+12.0% YoY", True), ("76.5%", "Gross margin", "+1.4 pts", True),
            ("$33.7M", "Operating income", "+31.6% YoY", True), ("$(4.1)M", "Free cash flow", "-$9.8M YoY", False)]
    for i, (big, lbl, delta, good) in enumerate(kpis):
        x = 0.6 + i * 3.1
        s.shape(x, 2.0, 2.8, 3.0, geom="roundRect", av={"adj": 8000}, fill=solid("FFFFFF"), line=ln(1, "D9D9D9"),
                effects=effect_lst(outer_shdw(8, 3, 90, alpha=25)),
                text=body(p(r(big, sz=36, b=True, fill="1F4E79"), algn="ctr"), p(r(lbl, sz=14, fill="595959"), algn="ctr"),
                          anchor="ctr"))
        s.shape(x + 0.9, 4.3, 0.25, 0.22, geom="triangle" if good else "triangle", flip_v=not good,
                fill=solid("70AD47" if good else "C00000"))
        s.label(x + 1.2, 4.22, 1.5, 0.35, delta, sz=12, algn="l", color="70AD47" if good else "C00000", b=True)
    s.textbox(0.6, 6.1, 12, 0.5, p(r("Free cash flow excludes a one-time $12.0M tax payment. Margins are non-GAAP; "
                                     "see appendix for reconciliations.", sz=8, fill="7F7F7F")))
    s.footers(FOOT, "October 24, 2024")
    s = d.slide("Title Only", "Revenue and operating margin")
    deco(s)
    ch = add_chart(s, XL_CHART_TYPE.COLUMN_CLUSTERED, 0.6, 1.5, 8.2, 4.9,
                   cat_data(["Q3 FY23", "Q4 FY23", "Q1 FY24", "Q2 FY24", "Q3 FY24"],
                            [("Revenue ($M)", (118.2, 121.0, 124.9, 128.3, 132.4)), ("Operating margin", (0.217, 0.221, 0.236, 0.244, 0.255))], "0.0"),
                   None)
    make_combo(ch, "0%")
    s.textbox(9.1, 1.6, 3.7, 4.6, p(r("Highlights", sz=18, b=True, fill="1F4E79")),
              *[p(r(t, sz=14), bullet=bullet_char("•", "Arial", color="scheme:accent1"), mar_l=0.25, indent=-0.25, spc_bef=("pts", 6))
                for t in ("Fifth consecutive quarter of growth", "Subscription mix reached 32%", "Margin expansion from pricing",
                          "Opex held flat sequentially")])
    s.textbox(0.6, 6.5, 8.2, 0.3, p(r("Operating margin plotted on the secondary axis.", sz=8, fill="7F7F7F")))
    s.footers(FOOT, "October 24, 2024")
    s = d.slide("Title Only", "Consolidated statement of operations")
    deco(s)
    income_statement(s, 2.4, 1.15, 8.5, row_h=0.2, font=8)
    s.footers(FOOT, "October 24, 2024")
    s = d.slide("Title Only", "Segment performance")
    deco(s)
    add_chart(s, XL_CHART_TYPE.DOUGHNUT, 0.6, 1.4, 5.2, 5.0,
              cat_data(["Product", "Subscription", "Services"], [("Revenue", (84.2, 41.9, 6.3))], "0.0"), "Revenue by segment ($M)",
              labels=True, num_fmt="0.0")
    gf, tbl = add_table(s, 4, 4, 6.3, 1.9, 6.4, 2.4, style="{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}",
                        flags={"firstRow": True, "bandRow": True})
    for rr, row in enumerate([["Segment", "Revenue", "YoY", "Margin"], ["Product", "84.2", "10.0%", "57%"],
                              ["Subscription", "41.9", "26.9%", "81%"], ["Services", "6.3", "(27.5%)", "(9%)"]]):
        for cc, v in enumerate(row):
            set_cell(tbl.cell(rr, cc), [p(r(v, sz=14, fill="C00000" if v.startswith("(") else None), algn="r" if cc else "l")])
    s.footers(FOOT, "October 24, 2024")
    s = d.slide("Title Only", "EBITDA bridge")
    deco(s)
    ch = add_chart(s, XL_CHART_TYPE.COLUMN_STACKED, 0.6, 1.4, 12.0, 5.0,
                   cat_data(["Q3 FY23", "Volume", "Price", "Mix", "Opex", "FX", "Q3 FY24"],
                            [("Base", (0, 30.0, 34.5, 35.2, 34.0, 33.4, 0)), ("Up", (0, 4.5, 2.5, 0, 0, 0, 0)),
                             ("Down", (0, 0, 0, 1.8, 1.2, 0.6, 0)), ("Total", (30.0, 0, 0, 0, 0, 0, 33.4))], "0.0"), None, legend=None)
    plot = ch.plots[0]
    plot.gap_width = 50
    plot.overlap = 100
    for ser, col in zip(plot.series, [None, "70AD47", "C00000", "1F4E79"]):
        if col is None:
            ser.format.fill.background()
        else:
            ser.format.fill.solid()
            ser.format.fill.fore_color.rgb = RGBColor.from_string(col)
    s.footers(FOOT, "October 24, 2024")
    s = d.slide("Title Only", "Notes and disclaimers")
    deco(s)
    notes_ = [f"({i}) " + t for i, t in enumerate([
        "Non-GAAP measures exclude stock-based compensation, amortization of acquired intangibles and restructuring.",
        "Free cash flow is net cash provided by operating activities less capital expenditures.",
        "Segment margins are before unallocated corporate costs.", "Prior periods were reclassified to conform to the current presentation.",
        "All figures are fictional and exist only to exercise rendering of small type."], start=1)]
    s.textbox(0.6, 1.5, 12.1, 4.8, *[p(r(t, sz=8, fill="404040"), spc_aft=("pts", 4)) for t in notes_],
              line=ln(0.5, "BFBFBF"), ins=(0.15, 0.1, 0.15, 0.1))
    s.footers(FOOT, "October 24, 2024")
    return d


# =============================================================================
# LibreOffice round trips
# =============================================================================

LO_ROUNDTRIPS = [
    ("lo-roundtrip-text-bullets", "text-bullets-numbering"),
    ("lo-roundtrip-shapes-fills", "fills-solid-gradient"),
    ("lo-roundtrip-kitchen-sink", "kitchen-sink-financial"),
]


def lo_roundtrip(src: Path, dst: Path) -> None:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("soffice not found")
    with tempfile.TemporaryDirectory(prefix="corpus-lo-") as tmp:
        tmp_p = Path(tmp)
        prof = tmp_p / "profile"
        work = tmp_p / "deck.pptx"
        shutil.copyfile(src, work)
        base = [soffice, f"-env:UserInstallation=file://{prof}", "--headless", "--norestore"]
        subprocess.run(base + ["--convert-to", "odp", "--outdir", str(tmp_p / "odp"), str(work)], check=True,
                       capture_output=True, timeout=300)
        odp = tmp_p / "odp" / "deck.odp"
        subprocess.run(base + ["--convert-to", "pptx", "--outdir", str(tmp_p / "out"), str(odp)], check=True,
                       capture_output=True, timeout=300)
        shutil.copyfile(tmp_p / "out" / "deck.pptx", dst)


# =============================================================================
# Validation and main
# =============================================================================

MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
# ECMA-376 Part 4 (2016) types a:buSzPct/@val as "25%".."400%", but PowerPoint writes and expects the
# 1st-edition integer form (e.g. 50000); keep what PowerPoint writes and ignore that facet error.
XSD_IGNORED = ("buSzPct', attribute 'val': [facet 'pattern']",)


def resolve_mce(root) -> None:
    """Markup-compatibility preprocessing as a non-extended consumer would do it (take mc:Fallback)."""
    for ac in list(root.iter(f"{{{MC_NS}}}AlternateContent")):
        parent = ac.getparent()
        fallback = ac.find(f"{{{MC_NS}}}Fallback")
        idx = parent.index(ac)
        parent.remove(ac)
        if fallback is not None:
            for i, child in enumerate(list(fallback)):
                parent.insert(idx + i, child)


R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def check_package(path: Path) -> list[str]:
    """Every r:* reference resolves to a relationship, every internal target exists, every part has a content type."""
    errors = []
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        ct = etree.fromstring(zf.read("[Content_Types].xml"))
        defaults = {d.get("Extension").lower() for d in ct if etree.QName(d).localname == "Default"}
        overrides = {o.get("PartName").lstrip("/") for o in ct if etree.QName(o).localname == "Override"}
        for name in names:
            if name.endswith("/") or name == "[Content_Types].xml":
                continue
            if name not in overrides and name.rsplit(".", 1)[-1].lower() not in defaults:
                errors.append(f"{path.name}:{name}: no content type")
        for name in sorted(names):
            if not name.endswith(".rels"):
                continue
            src = name.replace("_rels/", "").removesuffix(".rels")
            base = src.rsplit("/", 1)[0] if "/" in src else ""
            ids = set()
            for rel in etree.fromstring(zf.read(name)):
                ids.add(rel.get("Id"))
                if rel.get("TargetMode") == "External":
                    continue
                target = rel.get("Target")
                full = target.lstrip("/") if target.startswith("/") else str(Path(base, target)).replace("\\", "/")
                parts = []
                for seg in full.split("/"):
                    if seg == "..":
                        parts and parts.pop()
                    elif seg not in ("", "."):
                        parts.append(seg)
                if "/".join(parts) not in names:
                    errors.append(f"{path.name}:{name}: missing target {target}")
            if src.endswith(".xml") and src in names:
                for el in etree.fromstring(zf.read(src)).iter():
                    for k, v in el.attrib.items():
                        if k.startswith(f"{{{R_NS}}}") and v and v not in ids:
                            errors.append(f"{path.name}:{src}: dangling {etree.QName(k).localname}={v}")
    return errors


def validate_xsd(path: Path, xsd_dir: Path) -> list[str]:
    pml = etree.XMLSchema(etree.parse(str(xsd_dir / "pml.xsd")))
    chart = etree.XMLSchema(etree.parse(str(xsd_dir / "dml-chart.xsd")))
    errors = []
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            if not name.endswith(".xml") or not name.startswith("ppt/"):
                continue
            root = etree.fromstring(zf.read(name))
            resolve_mce(root)
            ns = etree.QName(root).namespace
            if ns == "http://schemas.openxmlformats.org/drawingml/2006/chart":
                schema = chart
            elif ns in ("http://schemas.openxmlformats.org/presentationml/2006/main",
                        "http://schemas.openxmlformats.org/drawingml/2006/main"):
                schema = pml
            else:
                continue
            if not schema.validate(root):
                for err in schema.error_log:
                    if not any(ign in err.message for ign in XSD_IGNORED):
                        errors.append(f"{path.name}:{name}:{err.line}: {err.message}")
    return errors


DECKS = {
    "text-fonts-sizes": deck_text_fonts,
    "text-run-formatting": deck_text_runs,
    "text-paragraphs": deck_text_paragraphs,
    "text-bullets-numbering": deck_text_bullets,
    "text-autofit-vertical-columns": deck_text_autofit,
    "text-unicode": deck_text_unicode,
    "placeholders-all-layouts": deck_placeholders,
    "inheritance-master-layout": deck_inheritance,
    "theme-custom-colors-fonts": deck_theme_custom,
    "shapes-presets-all": deck_shapes_presets,
    "shapes-adjust-values": deck_shapes_adjust,
    "shapes-rotation-flip": deck_shapes_transforms,
    "shapes-custom-geometry": deck_shapes_custgeom,
    "fills-solid-gradient": deck_fills_gradient,
    "fills-pattern-picture": deck_fills_pattern_picture,
    "backgrounds": deck_backgrounds,
    "lines-widths-dashes": deck_lines,
    "lines-arrows-connectors": deck_arrows_connectors,
    "effects-shadow-glow-reflection": deck_effects,
    "pictures-raster-formats": deck_pictures_raster,
    "pictures-vector-emf-wmf-svg": deck_pictures_vector,
    "pictures-crop-effects": deck_pictures_crop,
    "ole-embedded-objects": deck_ole,
    "tables-merge-borders": deck_tables_basic,
    "tables-builtin-styles": deck_tables_styles,
    "tables-financial-statement": deck_tables_financial,
    "charts-basic": deck_charts_basic,
    "charts-advanced": deck_charts_advanced,
    "groups-nested-transforms": deck_groups,
    "slide-features": deck_slide_features,
    "size-a4-portrait": deck_a4_portrait,
    "kitchen-sink-financial": deck_kitchen_sink,
}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", help="deck names to build (default: all)")
    ap.add_argument("--list", action="store_true", help="list deck names and exit")
    ap.add_argument("--out", default=str(GEN_DIR), help="output directory (default: tests/corpus/generated)")
    ap.add_argument("--no-libreoffice", action="store_true", help="skip the lo-roundtrip-* decks")
    ap.add_argument("--xsd-dir", help="ECMA-376 transitional XSD folder; validate every generated deck")
    ap.add_argument("--no-manifest", action="store_true", help="do not refresh manifest.json")
    args = ap.parse_args(argv)

    out = Path(args.out)
    built: dict[str, Deck] = {}
    if args.list:
        for name in DECKS:
            print(name)
        for name, src in LO_ROUNDTRIPS:
            print(f"{name}  (LibreOffice round trip of {src})")
        return 0
    wanted = set(args.only or [])
    unknown = wanted - set(DECKS) - {lo for lo, _ in LO_ROUNDTRIPS}
    if unknown:
        ap.error(f"unknown deck(s): {', '.join(sorted(unknown))}")
    wanted |= {src for lo, src in LO_ROUNDTRIPS if lo in wanted}
    descriptions: dict[str, dict] = {}
    for name, fn in DECKS.items():
        if wanted and name not in wanted:
            continue
        deck = fn()
        assert deck.name == name, (deck.name, name)
        path = deck.save(out)
        built[deck.name] = deck
        descriptions[f"generated/{path.name}"] = {"description": deck.description, "extra_features": deck.features}
        print(f"wrote {path.relative_to(out.parent) if out.parent in path.parents else path}", file=sys.stderr)
    if not args.no_libreoffice:
        for name, src in LO_ROUNDTRIPS:
            if args.only and name not in args.only:
                continue
            src_path = out / f"{src}.pptx"
            dst = out / f"{name}.pptx"
            try:
                lo_roundtrip(src_path, dst)
            except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
                print(f"warning: LibreOffice round trip {name} failed: {e}", file=sys.stderr)
                continue
            src_deck = built.get(src)
            desc = (f"LibreOffice 24.2 round trip (pptx -> odp -> pptx) of generated/{src}.pptx, giving "
                    "LibreOffice-written PresentationML/DrawingML for the same content.")
            normalize_package(dst, f"LibreOffice round trip of {src}", desc, "libreoffice-export", None,
                              stable_field_ids=True)
            descriptions[f"generated/{dst.name}"] = {"description": desc,
                                                     "extra_features": ["libreoffice-export"] + (src_deck.features if src_deck else [])}
            print(f"wrote {dst}", file=sys.stderr)
    pkg_errors = []
    for path in sorted(out.glob("*.pptx")):
        if not wanted or path.stem in wanted:
            pkg_errors += check_package(path)
    for e in pkg_errors:
        print(e, file=sys.stderr)
    if pkg_errors:
        print(f"{len(pkg_errors)} package errors", file=sys.stderr)
        return 1
    if args.xsd_dir:
        errors = []
        for path in sorted(out.glob("*.pptx")):
            if wanted and path.stem not in wanted:
                continue
            errors += validate_xsd(path, Path(args.xsd_dir))
        for e in errors:
            print(e, file=sys.stderr)
        if errors:
            print(f"{len(errors)} schema errors", file=sys.stderr)
            return 1
        print("schema validation: OK", file=sys.stderr)
    if not args.no_manifest and out.resolve() == GEN_DIR.resolve():
        import update_manifest

        update_manifest.update(generated_info=descriptions)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
