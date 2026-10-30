"""Variable font: every static weight is a master on wght.

Masters are drawn with the same boolean constructions as the statics;
compat.py brings their contours into one structure before the cubic outlines
are converted to compatible quadratics. Because every static is a master,
the named instances reproduce the statics even where a parameter is not
linear in the stem (thinner heavy horizontals, capped dots, superiors).
"""

import os

from fontTools import varLib
from fontTools.designspaceLib import (
    AxisDescriptor,
    DesignSpaceDocument,
    InstanceDescriptor,
    SourceDescriptor,
)
from fontTools.otlLib.builder import buildStatTable
from fontTools.pens.cu2quPen import Cu2QuMultiPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

from . import features
from . import params as P
from .compat import IncompatibleGlyph, match_masters
from .fontbuild import build_font, pin_timestamps
from .glyphs import Drawer, ordered_names

MASTERS = tuple(sorted(P.WEIGHTS))  # 400 is the default master
DEFAULT = 400


def _draw_compatible(contour_sets, pens):
    """contour_sets: per master, matched contours from compat.match_masters."""
    multi = Cu2QuMultiPen(pens, max_err=1.0, reverse_direction=True)

    def r(pt):
        return (round(pt[0]), round(pt[1]))

    for ci in range(len(contour_sets[0])):
        contours = [cs[ci] for cs in contour_sets]
        multi.moveTo([(r(c[0][1]),) for c in contours])
        for si in range(len(contours[0])):
            segs = [c[si] for c in contours]
            if segs[0][0] == "L":
                multi.lineTo([(r(s[2]),) for s in segs])
            else:
                multi.curveTo([(r(s[2]), r(s[3]), r(s[4])) for s in segs])
        multi.closePath()


def compatible_outlines(drawn, names):
    """{weight: {name: matched contours}} and {name: reason} for failures."""
    out = {w: {} for w in MASTERS}
    failures = {}
    for name in names:
        try:
            m = match_masters({w: drawn[w][name].shape for w in MASTERS}, DEFAULT)
        except IncompatibleGlyph as e:
            failures[name] = str(e)
            continue
        for w in MASTERS:
            out[w][name] = m[w]
    return out, failures


def build_variable(out_dir):
    drawn = {}
    for w in MASTERS:
        d = Drawer(P.params(w), strict=True)
        drawn[w] = d.draw_all()
    names = ordered_names()
    order = [DEFAULT] + [w for w in MASTERS if w != DEFAULT]

    glyph_objs = {w: {} for w in MASTERS}
    matched, incompatible = compatible_outlines(drawn, names)
    for name in names:
        if name in incompatible:
            continue
        pens = {w: TTGlyphPen(None) for w in MASTERS}
        _draw_compatible([matched[w][name] for w in order], [pens[w] for w in order])
        for w in MASTERS:
            glyph_objs[w][name] = pens[w].glyph()
    if incompatible:
        lines = "\n".join(f"  {n}: {why}" for n, why in sorted(incompatible.items()))
        raise SystemExit(
            f"variable font: {len(incompatible)} glyphs are not interpolation-compatible:\n{lines}"
        )

    doc = DesignSpaceDocument()
    axis = AxisDescriptor()
    axis.tag, axis.name = "wght", "Weight"
    axis.minimum, axis.default, axis.maximum = min(P.WEIGHTS), DEFAULT, max(P.WEIGHTS)
    # Outlines are (close to) linear in the stem, so map weight classes to
    # stems; varLib turns this into an avar table.
    axis.map = [(w, P.STEMS[w]) for w in sorted(P.WEIGHTS)]
    doc.addAxis(axis)
    for w in MASTERS:
        p = P.params(w)
        fea = features.feature_code(drawn[w], p)
        font = build_font(drawn[w], p, "ttf", fea)
        glyf = font["glyf"]
        for name in names:
            glyf[name] = glyph_objs[w][name]
            glyf[name].recalcBounds(glyf)
        hmtx = font["hmtx"]
        for name in names:
            g = glyf[name]
            hmtx[name] = (hmtx[name][0], g.xMin if g.numberOfContours else 0)
        src = SourceDescriptor()
        src.font = font
        src.name = f"master-{w}"
        src.location = {"Weight": P.STEMS[w]}
        doc.addSource(src)
    for w, style in sorted(P.WEIGHTS.items()):
        inst = InstanceDescriptor()
        inst.styleName = style
        inst.familyName = f"{P.FAMILY} Variable"
        inst.designLocation = {"Weight": P.STEMS[w]}
        doc.addInstance(inst)

    vf, _, _ = varLib.build(doc)
    _name_variable(vf)
    pin_timestamps(vf)
    buildStatTable(
        vf,
        [
            {
                "tag": "wght",
                "name": "Weight",
                "values": [
                    {
                        "value": w,
                        "name": s,
                        **({"flags": 0x2, "linkedValue": 700} if w == 400 else {}),
                    }
                    for w, s in sorted(P.WEIGHTS.items())
                ],
            }
        ],
        macNames=False,
    )
    os.makedirs(os.path.join(out_dir, "variable"), exist_ok=True)
    ttf = os.path.join(out_dir, "variable", f"{P.PS_FAMILY}[wght].ttf")
    vf.save(ttf)
    vf.flavor = "woff2"
    woff2 = os.path.join(out_dir, "variable", f"{P.PS_FAMILY}[wght].woff2")
    vf.save(woff2)
    return [ttf, woff2]


def _name_variable(vf):
    name = vf["name"]
    fam = f"{P.FAMILY} Variable"
    for rec_id, value in (
        (1, fam),
        (2, "Regular"),
        (4, fam),
        (6, f"{P.PS_FAMILY}-Variable"),
        (3, f"{P.VERSION};MCRO;{P.PS_FAMILY}-Variable"),
    ):
        name.setName(value, rec_id, 3, 1, 0x409)
    name.removeNames(nameID=16)
    name.removeNames(nameID=17)
    name.setName(P.PS_FAMILY + "Variable", 25, 3, 1, 0x409)
    vf["OS/2"].usWeightClass = DEFAULT
    vf["OS/2"].fsSelection = (vf["OS/2"].fsSelection & ~0x21) | 0x40
    vf["head"].macStyle = 0
