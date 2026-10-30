"""Variable font: interpolate Light, Regular and ExtraBold masters on wght.

Masters are drawn with the same boolean constructions as the statics. The
booleans can start contours at different points or order them differently per
weight, so contours are matched and rotated into a common structure before
the cubic outlines are converted to compatible quadratics.
"""

import os

from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, InstanceDescriptor, SourceDescriptor
from fontTools.otlLib.builder import buildStatTable
from fontTools.pens.cu2quPen import Cu2QuMultiPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools import varLib

from . import features
from . import params as P
from .fontbuild import build_font
from .glyphs import Drawer, ordered_names

MASTERS = (300, 400, 800)  # 400 is the default master
DEFAULT = 400


class IncompatibleGlyph(Exception):
    pass


def _contours(shape):
    """Contours as (start, [(op, pts)...]) with zero-length lines dropped and
    the closing line made explicit."""
    rec = RecordingPen()
    shape.path.draw(rec)
    out = []
    cur = None
    for op, args in rec.value:
        if op == "moveTo":
            cur = [args[0], []]
        elif op in ("lineTo", "curveTo", "qCurveTo"):
            cur[1].append((op, list(args)))
        elif op in ("closePath", "endPath"):
            start, segs = cur
            last = segs[-1][1][-1] if segs else start
            if _dist2(last, start) > 1e-6:
                segs.append(("lineTo", [start]))
            # Drop degenerate lines.
            prev = start
            clean = []
            for sop, pts in segs:
                if sop == "lineTo" and _dist2(prev, pts[-1]) < 0.25:
                    prev = pts[-1]
                    continue
                clean.append((sop, pts))
                prev = pts[-1]
            if clean and _dist2(clean[-1][1][-1], start) > 1e-6:
                # The dropped line was the closing one; keep the contour closed.
                clean.append(("lineTo", [start]))
            out.append(clean)
            cur = None
    # Normalise: every contour as a list of segments, each ending on-curve;
    # the contour starts at the end point of its last segment.
    return out


def _dist2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def _rotate(segs, k):
    return segs[k:] + segs[:k]


def _sig(segs):
    return tuple(op for op, _ in segs)


def _cost(a, b):
    return sum(_dist2(sa[1][-1], sb[1][-1]) for sa, sb in zip(a, b))


def _match(default, other):
    """Reorder and rotate `other`'s contours to line up with `default`'s."""
    if len(default) != len(other):
        raise IncompatibleGlyph(f"{len(default)} vs {len(other)} contours")
    remaining = list(range(len(other)))
    result = []
    for dc in default:
        best = None
        sig = _sig(dc)
        for j in remaining:
            oc = other[j]
            if len(oc) != len(dc):
                continue
            for k in range(len(oc)):
                rot = _rotate(oc, k)
                if _sig(rot) != sig:
                    continue
                c = _cost(dc, rot)
                if best is None or c < best[0]:
                    best = (c, j, rot)
        if best is None:
            raise IncompatibleGlyph(f"no contour matching {sig}")
        remaining.remove(best[1])
        result.append(best[2])
    return result


def _draw_compatible(contour_sets, pens):
    """contour_sets: per master, a list of matched contours."""
    multi = Cu2QuMultiPen(pens, max_err=1.0, reverse_direction=True)
    for ci in range(len(contour_sets[0])):
        contours = [cs[ci] for cs in contour_sets]
        starts = [c[-1][1][-1] for c in contours]
        multi.moveTo([((round(s[0]), round(s[1])),) for s in starts])
        for si in range(len(contours[0])):
            op = contours[0][si][0]
            pts = [[(round(x), round(y)) for x, y in c[si][1]] for c in contours]
            if op == "lineTo":
                multi.lineTo([(p[0],) for p in pts])
            elif op == "curveTo":
                multi.curveTo([tuple(p) for p in pts])
            else:
                multi.qCurveTo([tuple(p) for p in pts])
        multi.closePath()


def build_variable(out_dir):
    drawn = {}
    for w in MASTERS:
        d = Drawer(P.params(w), strict=True)
        drawn[w] = d.draw_all()
    names = ordered_names()
    order = [DEFAULT] + [w for w in MASTERS if w != DEFAULT]

    glyph_objs = {w: {} for w in MASTERS}
    incompatible = {}
    for name in names:
        sets = {w: _contours(drawn[w][name].shape) for w in MASTERS}
        try:
            matched = {DEFAULT: sets[DEFAULT]}
            for w in MASTERS:
                if w != DEFAULT:
                    matched[w] = _match(sets[DEFAULT], sets[w])
        except IncompatibleGlyph as e:
            incompatible[name] = str(e)
            continue
        pens = {w: TTGlyphPen(None) for w in MASTERS}
        _draw_compatible([matched[w] for w in order], [pens[w] for w in order])
        for w in MASTERS:
            glyph_objs[w][name] = pens[w].glyph()
    if incompatible:
        lines = "\n".join(f"  {n}: {why}" for n, why in sorted(incompatible.items()))
        raise SystemExit(f"variable font: {len(incompatible)} glyphs are not interpolation-compatible:\n{lines}")

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

    vf, _, _ = varLib.build(doc, exclude=["MVAR"])
    _name_variable(vf)
    buildStatTable(
        vf,
        [{"tag": "wght", "name": "Weight", "values": [
            {"value": w, "name": s, **({"flags": 0x2, "linkedValue": 700} if w == 400 else {})}
            for w, s in sorted(P.WEIGHTS.items())
        ]}],
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
    for rec_id, value in ((1, fam), (2, "Regular"), (4, fam), (6, f"{P.PS_FAMILY}-Variable"), (3, f"{P.VERSION};MCRO;{P.PS_FAMILY}-Variable")):
        name.setName(value, rec_id, 3, 1, 0x409)
    name.removeNames(nameID=16)
    name.removeNames(nameID=17)
    name.setName(P.PS_FAMILY + "Variable", 25, 3, 1, 0x409)
    vf["OS/2"].usWeightClass = DEFAULT
    vf["OS/2"].fsSelection = (vf["OS/2"].fsSelection & ~0x21) | 0x40
    vf["head"].macStyle = 0
