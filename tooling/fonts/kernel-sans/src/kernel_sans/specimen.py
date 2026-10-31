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

# Close-ups of the cyber details: (glyph, weight, framing, title, caption).
# Framing is computed from the outline and the weight's parameters in
# _detail_view; captions take numbers from the same parameters.
DETAILS = [
    (
        "o",
        800,
        "full",
        "Squircle curves",
        "Every round contour is a superellipse (exponent {sq:.1f} outside, {sq_in:.1f} in the counter): the squared-off roundness of SF Pro pushed further.",
    ),
    (
        "n",
        800,
        "chamfer",
        "Chamfered stroke ends",
        "Free stem tops and curve terminals are clipped at 45°. The leg is 0.36 of the stem ({cut:.0f} units at ExtraBold), so the cut keeps its proportion at every weight.",
    ),
    (
        "n",
        800,
        "trap",
        "Ink traps",
        "Acute joins are notched. The trap grows with weight, from {trap_light:.0f} units at Light to {trap_bold:.0f} at ExtraBold, so heavy text keeps its crotches open.",
    ),
    (
        "i",
        800,
        "dot",
        "Square dots",
        "Dots are squares with two opposing chamfers, shared by i, j and all punctuation.",
    ),
]


def _detail_view(font, name, framing, p):
    """viewBox (x, y-top, w, h) in font units, y up."""
    from fontTools.pens.boundsPen import BoundsPen

    bp = BoundsPen(font.getGlyphSet())
    font.getGlyphSet()[name].draw(bp)
    x0, _y0, x1, y1 = bp.bounds
    if framing == "chamfer":
        size = 2.6 * p.stem
        return (x0 - 0.35 * size, P.XH + 0.3 * size, size, size)
    if framing == "trap":
        cx, cy = x0 + p.stem, P.XH - p.hair - 0.17 * P.XH
        size = 1.9 * p.stem
        return (cx - size / 2, cy + size * 0.6, size, size)
    if framing == "dot":
        size = (y1 - (P.XH - 140)) + 80
        cx = (x0 + x1) / 2
        return (cx - size / 2, y1 + 40, size, size)
    return None


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
        if op == "moveTo" or op == "lineTo":
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
        view = (
            -pad,
            P.XH + 80 + pad if name.islower() else P.CAP + 80 + pad,
            adv + 2 * pad,
            0,
        )
        view = (
            view[0],
            view[1],
            view[2],
            view[1] - (P.DESC if name in ("g", "j", "p", "q", "y") else -60),
        )
    x, ytop, w, h = view
    # Font units are y-up; flip with a group transform.
    parts = [
        f'<svg viewBox="{x} {-ytop} {w} {h}" role="img" aria-label="Outline of {html.escape(name)}">'
    ]
    parts.append('<g class="metrics">')
    for y, label in (
        (P.ASC, "asc"),
        (P.CAP, "cap"),
        (P.XH, "x"),
        (0, "base"),
        (P.DESC, "desc"),
    ):
        parts.append(f'<line x1="{x - w}" x2="{x + 2 * w}" y1="{-y}" y2="{-y}"/>')
    parts.append(
        f'<line class="adv" x1="0" x2="0" y1="{-ytop - h}" y2="{-ytop + 2 * h}"/>'
    )
    parts.append(
        f'<line class="adv" x1="{adv}" x2="{adv}" y1="{-ytop - h}" y2="{-ytop + 2 * h}"/>'
    )
    parts.append("</g>")
    parts.append(f'<g transform="scale(1,-1)"><path class="ink" d="{d}"/>')
    parts.append(
        '<g class="handles">'
        + "".join(
            f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}"/>'
            for a, b in handles
        )
        + "</g>"
    )
    r = max(3.0, w / 110)
    parts.append(
        '<g class="off">'
        + "".join(f'<circle cx="{p[0]}" cy="{p[1]}" r="{r * 0.8:.1f}"/>' for p in off)
        + "</g>"
    )
    parts.append(
        '<g class="on">'
        + "".join(
            f'<rect x="{p[0] - r:.1f}" y="{p[1] - r:.1f}" width="{2 * r:.1f}" height="{2 * r:.1f}"/>'
            for p in on
        )
        + "</g>"
    )
    parts.append("</g></svg>")
    return "".join(parts)


def _glyph_table(fonts_by_weight):
    reg = fonts_by_weight[400]
    cmap = reg.getBestCmap()
    rows = []
    for u, name in sorted(cmap.items()):
        if u in (0x20, 0xA0, 0xAD):
            continue
        rows.append(
            {
                "n": name,
                "u": u,
                "w": {
                    str(w): f["hmtx"][name][0]
                    for w, f in sorted(fonts_by_weight.items())
                },
            }
        )
    order = reg.getGlyphOrder()
    alternates = []
    for name in order:
        if "." in name and not name.startswith("."):
            base, suffix = name.split(".", 1)
            base_u = next((u for u, n in cmap.items() if n == base), None)
            feature = {
                "ss01": "ss01",
                "ss02": "ss02",
                "zero": "zero",
                "case": "case",
                "tf": "tnum",
            }.get(suffix)
            if base_u is not None and feature:
                alternates.append(
                    {
                        "n": name,
                        "u": base_u,
                        "f": feature,
                        "w": {
                            str(w): f["hmtx"][name][0]
                            for w, f in sorted(fonts_by_weight.items())
                        },
                    }
                )
    return rows, alternates


STANDALONE_HEAD = (
    '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
)


def build_specimen(fonts_dir, out_html, embed=False):
    """fonts_dir holds otf/ ttf/ variable/ from build.py.

    The default page links the variable font by relative path and is a full
    HTML document to open from the repository. With embed=True the font is
    inlined and the page is a fragment for publishing as a claude.ai
    artifact, whose viewer supplies the document wrapper."""
    static = {}
    for w, style in P.WEIGHTS.items():
        static[w] = TTFont(os.path.join(fonts_dir, "otf", f"{P.PS_FAMILY}-{style}.otf"))
    vf_path = os.path.join(fonts_dir, "variable", f"{P.PS_FAMILY}[wght].woff2")
    if embed:
        with open(vf_path, "rb") as f:
            font_url = "data:font/woff2;base64," + base64.b64encode(f.read()).decode()
    else:
        font_url = (
            os.path.relpath(vf_path, os.path.dirname(out_html))
            .replace("[", "%5B")
            .replace("]", "%5D")
        )

    details = []
    numbers = {
        "sq": P.params(400).sq,
        "sq_in": P.params(400).sq_in,
        "cut": P.params(800).cut,
        "trap_light": P.params(300).trap * 1.3,
        "trap_bold": P.params(800).trap * 1.3,
    }
    for name, w, framing, title, caption in DETAILS:
        if name not in static[w].getGlyphOrder():
            continue
        caption = caption.format(**numbers)
        svg = _glyph_svg(
            static[w], name, _detail_view(static[w], name, framing, P.params(w))
        )
        details.append(
            f'<figure class="detail"><div class="outline">{svg}</div>'
            f"<figcaption><h3>{html.escape(title)}</h3><p>{html.escape(caption)}</p>"
            f'<span class="tag">{html.escape(name)} · {P.WEIGHTS[w]} {w}</span></figcaption></figure>'
        )

    glyph_rows, alternates = _glyph_table(static)
    data = {
        "weights": {str(w): s for w, s in P.WEIGHTS.items()},
        "stems": {str(w): P.STEMS[w] for w in P.WEIGHTS},
        "metrics": {
            "upm": P.UPM,
            "cap": P.CAP,
            "xh": P.XH,
            "asc": P.ASC,
            "desc": P.DESC,
        },
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
    if embed:
        page = page.replace("{{STANDALONE_HEAD}}", "")
    else:
        page = page.replace("{{STANDALONE_HEAD}}", STANDALONE_HEAD).replace(
            '<meta name="claude:viewport-fit-sides" content="cover">\n', ""
        )
    os.makedirs(os.path.dirname(out_html), exist_ok=True)
    with open(out_html, "w", encoding="utf-8") as f:
        f.write(page)
    return out_html
