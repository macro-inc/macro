"""Type specimen: one HTML page generated from the built fonts.

The page shows the variable font live (weight slider, tester, glyph set with
an inspector) and outline views of the four cyber details drawn from the
ExtraBold outlines.
"""

import base64
import html
import json
import os

from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

from . import params as P

TEMPLATE = os.path.join(os.path.dirname(__file__), "specimen_template.html")

# Close-ups of the cyber details: (glyph, weight, viewBox in font units
# (x, y-top, w, h) with y up, title, caption).
DETAILS = [
    ("o", 800, None, "Squircle curves",
     "Every round contour is a superellipse (exponent 3.0 outside, 2.7 in the counter): the squared-off roundness of SF Pro pushed further."),
    ("n", 800, (-10, 760, 470, 470), "Chamfered stroke ends",
     "Free stem tops and curve terminals are clipped at 45°. The leg is 0.36 of the stem, so the cut keeps its proportion at every weight."),
    ("n", 800, (40, 560, 330, 330), "Ink traps",
     "Acute joins are notched. The trap grows with weight (0 at Light, 37 units at ExtraBold) so heavy text keeps its crotches open."),
    ("i", 800, (-20, 800, 300, 300), "Square dots",
     "Dots are squares with two opposing chamfers, shared by i, j and all punctuation."),
]


def _glyph_svg(font, name, view=None, pad=40):
    gs = font.getGlyphSet()
    pen = SVGPathPen(gs)
    gs[name].draw(pen)
    d = pen.getCommands()
    rec = RecordingPen()
    gs[name].draw(rec)
    on, off, handles = [], [], []
    prev = None
    for op, args in rec.value:
        if op == "moveTo":
            on.append(args[0])
            prev = args[0]
        elif op == "lineTo":
            on.append(args[0])
            prev = args[0]
        elif op == "curveTo":
            c1, c2, pt = args
            off += [c1, c2]
            handles += [(prev, c1), (c2, pt)]
            on.append(pt)
            prev = pt
        elif op == "qCurveTo":
            for c in args[:-1]:
                off.append(c)
            on.append(args[-1])
            prev = args[-1]
    adv = font["hmtx"][name][0]
    if view is None:
        view = (-pad, P.XH + 80 + pad if name.islower() else P.CAP + 80 + pad, adv + 2 * pad, 0)
        view = (view[0], view[1], view[2], view[1] - (P.DESC if name in ("g", "j", "p", "q", "y") else -60))
    x, ytop, w, h = view
    # Font units are y-up; flip with a group transform.
    parts = [f'<svg viewBox="{x} {-ytop} {w} {h}" role="img" aria-label="Outline of {html.escape(name)}">']
    parts.append('<g class="metrics">')
    for y, label in ((P.ASC, "asc"), (P.CAP, "cap"), (P.XH, "x"), (0, "base"), (P.DESC, "desc")):
        parts.append(f'<line x1="{x}" x2="{x + w}" y1="{-y}" y2="{-y}"/>')
    parts.append(f'<line class="adv" x1="0" x2="0" y1="{-ytop}" y2="{-ytop + h}"/>')
    parts.append(f'<line class="adv" x1="{adv}" x2="{adv}" y1="{-ytop}" y2="{-ytop + h}"/>')
    parts.append("</g>")
    parts.append(f'<g transform="scale(1,-1)"><path class="ink" d="{d}"/>')
    parts.append('<g class="handles">' + "".join(
        f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}"/>' for a, b in handles) + "</g>")
    r = max(3.0, w / 110)
    parts.append('<g class="off">' + "".join(f'<circle cx="{p[0]}" cy="{p[1]}" r="{r * 0.8:.1f}"/>' for p in off) + "</g>")
    parts.append('<g class="on">' + "".join(
        f'<rect x="{p[0] - r:.1f}" y="{p[1] - r:.1f}" width="{2 * r:.1f}" height="{2 * r:.1f}"/>' for p in on) + "</g>")
    parts.append("</g></svg>")
    return "".join(parts)


def _glyph_table(fonts_by_weight):
    reg = fonts_by_weight[400]
    cmap = reg.getBestCmap()
    rows = []
    for u, name in sorted(cmap.items()):
        if u in (0x20, 0xA0, 0xAD):
            continue
        rows.append({
            "n": name,
            "u": u,
            "w": {str(w): f["hmtx"][name][0] for w, f in sorted(fonts_by_weight.items())},
        })
    order = reg.getGlyphOrder()
    alternates = []
    for name in order:
        if "." in name and not name.startswith("."):
            base, suffix = name.split(".", 1)
            base_u = next((u for u, n in cmap.items() if n == base), None)
            feature = {"ss01": "ss01", "zero": "zero", "case": "case", "tf": "tnum"}.get(suffix)
            if base_u is not None and feature:
                alternates.append({
                    "n": name,
                    "u": base_u,
                    "f": feature,
                    "w": {str(w): f["hmtx"][name][0] for w, f in sorted(fonts_by_weight.items())},
                })
    return rows, alternates


def build_specimen(fonts_dir, out_html, embed=False):
    """fonts_dir holds otf/ ttf/ variable/ from build.py."""
    static = {}
    for w, style in P.WEIGHTS.items():
        static[w] = TTFont(os.path.join(fonts_dir, "otf", f"{P.PS_FAMILY}-{style}.otf"))
    vf_path = os.path.join(fonts_dir, "variable", f"{P.PS_FAMILY}[wght].woff2")
    if embed:
        with open(vf_path, "rb") as f:
            font_url = "data:font/woff2;base64," + base64.b64encode(f.read()).decode()
    else:
        font_url = os.path.relpath(vf_path, os.path.dirname(out_html)).replace("[", "%5B").replace("]", "%5D")

    details = []
    for name, w, view, title, caption in DETAILS:
        if name not in static[w].getGlyphOrder():
            continue
        svg = _glyph_svg(static[w], name, view)
        details.append(
            f'<figure class="detail"><div class="outline">{svg}</div>'
            f'<figcaption><h3>{html.escape(title)}</h3><p>{html.escape(caption)}</p>'
            f'<span class="tag">{html.escape(name)} · {P.WEIGHTS[w]} {w}</span></figcaption></figure>'
        )

    glyph_rows, alternates = _glyph_table(static)
    data = {
        "weights": {str(w): s for w, s in P.WEIGHTS.items()},
        "stems": {str(w): P.STEMS[w] for w in P.WEIGHTS},
        "metrics": {"upm": P.UPM, "cap": P.CAP, "xh": P.XH, "asc": P.ASC, "desc": P.DESC},
        "glyphs": glyph_rows,
        "alternates": alternates,
    }
    glyph_count = len(static[400].getGlyphOrder())
    with open(TEMPLATE, encoding="utf-8") as f:
        page = f.read()
    page = (
        page.replace("{{FONT_URL}}", font_url)
        .replace("{{DETAILS}}", "\n".join(details))
        .replace("{{DATA}}", json.dumps(data, separators=(",", ":")))
        .replace("{{GLYPH_COUNT}}", str(glyph_count))
        .replace("{{ENCODED_COUNT}}", str(len(glyph_rows)))
        .replace("{{VERSION}}", P.VERSION)
    )
    os.makedirs(os.path.dirname(out_html), exist_ok=True)
    with open(out_html, "w", encoding="utf-8") as f:
        f.write(page)
    return out_html
