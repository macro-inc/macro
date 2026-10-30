"""Accents (spacing marks and their .case forms for capitals) and the accented
letters composed from them.

Marks are drawn at their final height, centred on x = 0, and attach by their
own horizontal centre (or "_top" / "_bottom" anchor) to the base's "top" /
"bottom" anchor. Lowercase marks sit between about x-height + 70 and 790,
.case marks between about cap height + 50 and 930; .case marks are flatter
and a little wider.

Style, following DESIGN.md: acute and grave are parallelograms with flat
(horizontal) ends like the house diagonals; circumflex and caron are chevrons
with flat-cut tips and apex; dots are the house square dot (p.dot, capped
at ExtraBold and hanging from the ascender exactly like the i dot); ring,
breve and tilde are squircle strokes whose free ends are cut horizontally;
cedilla and ogonek are small squircle hooks below the baseline with
chamfered tails.
Mark strokes are a little lighter than the stems and grow more slowly with
weight, so the small counters of ring, breve and tilde stay open at
ExtraBold. Breve, cedilla and ogonek share one pair of strokes (`_curve`)
and one chamfer rule (`_mark_cut`: 0.36 of the mark's own stroke).

Stylistic-set forms of the accented letters (`SS_COMPOSITES`: a.ss01 and
I.ss02 with their marks) are unencoded; features.py adds them to ss01 / ss02
by name.
"""

import math
import sys

import pathops

from .. import params as P
from ..geom import Shape, chamfer, diag, dot, rect, ring, superness
from . import REGISTRY, Compose, G, glyph, ref

PROOF_TEXT = [
    "nònónônõnön ñ ç oåo HÒHÓHÔHÕHÖH",
    "ÀÁÂÃÄÅ àáâãäå ÉÈÊË éèêë ÌÍÎÏ ìíîï",
    "Ñ ñ Ç ç Ü ü Ÿ ÿ Ý ý Š š Ž ž",
    "naïve naïf haïk façade crème brûlée",
    "São Paulo Ångström Mañana Škoda Žižek",
    "o`o´oˆoˇo˜o¨o¯o˚o˘o˙o˝o¸o˛o",
    "naïf haïk NAÏF HAÏTI ÄÖÜ äöüÿ ëï ŠŽ šž",
]

_MODULE = __name__.rsplit(".", 1)[-1]


def _glyph(name, *unicodes):
    """`glyph`, but skip (with a warning) a name or code point that another
    module already registered, so this module never fails to import."""

    def deco(fn):
        prev = REGISTRY.get(name)
        taken = [
            u
            for u in unicodes
            for d in REGISTRY.values()
            if u in d.unicodes and d.name != name
        ]
        if (prev is not None and prev.module != _MODULE) or taken:
            print(
                f"marks: {name} is already defined in another module; skipped",
                file=sys.stderr,
            )
            return fn
        return glyph(name, *unicodes)(fn)

    return deco


# ---------------------------------------------------------------------------
# Zones and strokes

LC_BOT = P.XH + 72  # bottom of lowercase marks (612)
UC_BOT = P.CAP + 52  # bottom of capital (.case) marks (772)


def _bot(case):
    return UC_BOT if case else LC_BOT


def _t(p, case=False):
    """Stroke of marks: about 0.8 of the stem at Regular, 0.7 at ExtraBold."""
    t = 0.6 * p.stem + 16
    return t * 0.96 if case else t


def _up(p):
    """Stem growth above Regular only (0 at Light and Regular). Used, like
    p.hair, for proportions that change only towards ExtraBold; the kink sits
    on the Regular master, so the variable font still interpolates."""
    return max(0.0, p.grow)


def _contrast(p):
    """Horizontal / vertical stroke ratio of the house (p.hair / p.stem):
    0.88 up to Regular, thinning to 0.74 at ExtraBold."""
    return p.hair / p.stem


def _curve(p, case=False):
    """(side, horizontal) strokes of the open curved marks: breve, cedilla and
    ogonek share them so they read as one hand. Sides are 0.8 of the straight
    mark stroke; horizontals follow the house contrast a little more strongly
    (0.8 of the side at Regular, 0.72 at ExtraBold) so the small counters of
    the cups and hooks stay open."""
    ws = 0.8 * _t(p, case)
    return ws, ws * (0.8 - 0.08 * _up(p) / 70)


def _mark_cut(ws):
    """45-degree chamfer leg on a mark's free terminal: 0.36 of the mark's own
    stroke, the same proportion as p.cut to the stem."""
    return 0.36 * ws


def _mark(shape, p, top=None, bottom=None):
    """Spacing mark with small even sidebearings. `top` / `bottom` set the
    attachment x (in drawn coordinates) when it is not the outline centre."""
    anchors = {}
    if top is not None:
        anchors["_top"] = top
    if bottom is not None:
        anchors["_bottom"] = bottom
    s = 0.57 * p.sb  # 40 at Regular; tightens with weight like the letters
    return G(shape, l=s, r=s, anchors=anchors)


# ---------------------------------------------------------------------------
# Explicit contours
#
# Hooks, cups and the tilde are open squircle strokes. Building them from
# booleans leaves edges that only touch (a half ring meeting a rectangle on
# its centre line), which pathops resolves differently at different weights
# and breaks the variable font. So they are drawn as single contours from
# squircle quadrants (the same cubics `geom.squircle` uses), split exactly
# where a terminal or join cuts them.


def _quadrant(cx, cy, rx, ry, n, q):
    """Cubic of quadrant q of the squircle `geom.squircle` draws, running
    counter-clockwise: 0 right->top, 1 top->left, 2 left->bottom,
    3 bottom->right."""
    k = superness(n)
    unit = [
        ((1, 0), (1, k), (k, 1), (0, 1)),
        ((0, 1), (-k, 1), (-1, k), (-1, 0)),
        ((-1, 0), (-1, -k), (-k, -1), (0, -1)),
        ((0, -1), (k, -1), (1, -k), (1, 0)),
    ][q]
    return [(cx + x * rx, cy + y * ry) for x, y in unit]


def _at(seg, t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = seg
    m = 1 - t
    a, b, c, d = m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t
    return (a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3)


def _split(seg, t):
    """de Casteljau: the two halves of a cubic at t."""
    p0, p1, p2, p3 = seg

    def lerp(a, b):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    a, b, c = lerp(p0, p1), lerp(p1, p2), lerp(p2, p3)
    d, e = lerp(a, b), lerp(b, c)
    f = lerp(d, e)
    return [p0, a, d, f], [f, e, c, p3]


def _solve(seg, axis, value):
    """t where a monotonic quadrant cubic reaches `value` on axis 0 (x) or
    1 (y)."""
    lo, hi = 0.0, 1.0
    rising = seg[3][axis] > seg[0][axis]
    for _ in range(60):
        mid = (lo + hi) / 2
        if (_at(seg, mid)[axis] < value) == rising:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _rev(seg):
    return list(reversed(seg))


def _contour(start, segs):
    """A closed contour: segs are points (lines) or 4-point cubics whose
    first point is the current point."""
    path = pathops.Path()
    pen = path.getPen()
    pen.moveTo(start)
    for s in segs:
        if len(s) == 4 and isinstance(s[0], tuple):
            pen.curveTo(s[1], s[2], s[3])
        else:
            pen.lineTo(s)
    pen.closePath()
    path.simplify(fix_winding=True)
    return Shape(path)


def _rot(pt, cy):
    """Half a turn about (0, cy)."""
    return (-pt[0], 2 * cy - pt[1])


# ---------------------------------------------------------------------------
# Acute, grave, hungarumlaut


def _acute_shape(p, case, t=None, slant=None, h=None):
    """A parallelogram with horizontal ends, leaning right, centred on x = 0."""
    b = _bot(case)
    if h is None:
        h = (134 if case else 160) + 0.1 * p.grow
    t = _t(p, case) if t is None else t
    dx = h * ((0.76 if case else 0.58) if slant is None else slant)
    return diag(-dx / 2, b, dx / 2, b + h, t)


def _acute(p, case):
    s = _acute_shape(p, case)
    # Sit a little right of centre: the eye reads the acute by its foot.
    bx = s.bounds()
    return _mark(s, p, top=(bx[0] + bx[2]) / 2 - (bx[2] - bx[0]) * 0.08)


def _grave(p, case):
    s = _acute_shape(p, case).flip_x()
    bx = s.bounds()
    return _mark(s, p, top=(bx[0] + bx[2]) / 2 + (bx[2] - bx[0]) * 0.08)


def _hungarumlaut(p, case):
    t = _t(p, case) * 0.88
    h = (122 if case else 146) + 0.1 * p.grow
    one = _acute_shape(p, case, t=t, slant=0.66 if case else 0.5, h=h)
    b = one.bounds()
    step = (b[2] - b[0]) + p.w(44 if case else 40, 0.3)
    shape = one.move(-step / 2, 0) + one.move(step / 2, 0)
    bx = shape.bounds()
    return _mark(shape, p, top=(bx[0] + bx[2]) / 2 - (bx[2] - bx[0]) * 0.04)


# ---------------------------------------------------------------------------
# Circumflex and caron


def _chevron(p, case, flip=False):
    """Two diagonals meeting in a flat apex, with flat tips. The outer width
    is fixed and the leg spread solved for it, so the inner counter keeps a
    good size as the strokes thicken."""
    b = _bot(case)
    # The height grows with weight, and above Regular the legs thin a little
    # (0.88 of the mark stroke at ExtraBold, where the apex is dense), so the
    # inner notch stays open at ExtraBold, about 80 units deep lowercase and
    # 70 .case, instead of filling into a solid cap. The lowercase top stays
    # under 790, the .case top under 930.
    h = 122 + 0.3 * p.grow if case else 146 + 0.35 * p.grow
    t = _t(p, case) * (0.95 - 0.07 * _up(p) / 80)
    w = p.w(286 if case else 250, 1.1)
    # Outer width = 2a + horizontal stroke width; solve for the spread a.
    a = w / 2
    for _ in range(30):
        hw = t * math.hypot(a, h) / h
        a = (w - hw) / 2
    left = diag(-a, b, 0, b + h, t)
    shape = left + left.flip_x()
    if flip:
        shape = shape.flip_y(b + h / 2)
    return shape


# ---------------------------------------------------------------------------
# Dots


# Least white between the i dot and the stem; the same rule as the i dot in
# lower_straight (Inter ExtraBold keeps about this much).
I_DOT_GAP = 64


def _dot_size(p, case):
    """Accent dots are the house dot, capped like the i dot: p.dot up to
    about Bold, then no taller than leaves I_DOT_GAP under a dot hanging
    from the ascender (156 at ExtraBold). The .case dots use the same side,
    so the 772-930 .case zone holds them at every weight."""
    return min(p.dot, P.ASC - P.XH - I_DOT_GAP)


def _dot_y(p, case, d=None):
    """Centre height of dieresis / dotaccent dots of side d. Lowercase dots
    hang from the ascender like the i dot, so i, ï and ü line up and sit
    I_DOT_GAP above a flat x-height at ExtraBold; .case dots span the .case
    zone (774-930) at ExtraBold."""
    if case:
        return 846 + 0.08 * p.grow
    return P.ASC - (_dot_size(p, case) if d is None else d) / 2


def _dieresis_shape(p, case, narrow=False):
    d = _dot_size(p, case)
    # The gap narrows towards ExtraBold, where the dots are large.
    gap = p.w(104 if case else 95, -0.28)
    if narrow:
        # For the i: the dots set closer so the pair overhangs the dotless i
        # by at most about half a sidebearing and clears neighbouring
        # ascenders (naïf, haïk, laïque). That fits the full house dot up to
        # Regular; towards ExtraBold, where the sidebearings are tight, the
        # dots give up 5% of their side rather than crowd an l or k or
        # close the gap between them (48 units at ExtraBold).
        d, gap = d * (1 - 0.05 * _up(p) / 80), p.w(56, 0.1) - 0.2 * _up(p)
    y = _dot_y(p, case, d)
    off = (d + gap) / 2
    return dot(-off, y, d) + dot(off, y, d)


def _dotaccent_shape(p, case):
    return dot(0, _dot_y(p, case), _dot_size(p, case))


# ---------------------------------------------------------------------------
# Macron, ring, breve


def _macron_shape(p, case):
    w = p.w(260 if case else 236, 0.6)
    t = _t(p, case) * 0.88
    y = (UC_BOT + 66 if case else LC_BOT + 76) + 0.1 * p.grow
    return rect(-w / 2, y - t / 2, w / 2, y + t / 2)


def _ring_shape(p, case):
    """A squircle ring, lighter than the other marks (a closed ring reads
    darker than an open stroke). Above Regular it grows faster than the
    stroke and its top and bottom thin with the house contrast, so the
    counter stays at least 80 units each way at ExtraBold. The .case ring
    sits on the .case floor at every weight (clear of the apex of A) and
    grows up, to about 954 at ExtraBold, inside the 960 line box; there its
    top and bottom thin a little more (6%) so the counter keeps 80 units of
    height in the shorter ring."""
    up = _up(p)
    ws = 0.3 * p.stem + 26
    wt = ws * _contrast(p)
    if case:
        b = UC_BOT
        w, h = p.w(174, 0.6) + 0.15 * up, p.w(150, 0.36) + 0.04 * up
        wt *= 1 - 0.06 * up / 80
    else:
        b = LC_BOT - 4 - 0.1 * p.grow
        w, h = p.w(170, 0.45) + 0.4 * up, p.w(164, 0.35) + 0.1 * up
    return ring(-w / 2, b, w / 2, b + h, ws, wt, n=p.sq, n_in=p.sq_in)


def _breve_shape(p, case):
    """A squircle cup; its tips are cut flat with the outer corner chamfered,
    like any curve terminal."""
    b = _bot(case)
    h = (100 if case else 118) + 0.25 * p.grow
    w = p.w(244 if case else 220, 0.9)
    ws, wb = _curve(p, case)
    r = h * 0.7  # height of the curved part; above it the sides run straight
    top, cy = b + h, b + r
    rxi, ryi = w / 2 - ws, r - wb
    shape = _contour(
        (-w / 2, top),
        [
            (-w / 2, cy),
            _quadrant(0, cy, w / 2, r, p.sq, 2),
            _quadrant(0, cy, w / 2, r, p.sq, 3),
            (w / 2, top),
            (rxi, top),
            (rxi, cy),
            _rev(_quadrant(0, cy, rxi, ryi, p.sq_in, 3)),
            _rev(_quadrant(0, cy, rxi, ryi, p.sq_in, 2)),
            (-rxi, top),
        ],
    )
    c = _mark_cut(ws)  # shorter than the straight part of the tip at every weight
    return shape - chamfer(-w / 2, top, c, "nw") - chamfer(w / 2, top, c, "ne")


# ---------------------------------------------------------------------------
# Tilde


def _tilde_shape(p, case):
    """A squarish wave: two squircle-ring caps, the second the first turned
    half a turn about the centre. Each cap is the part of a ring above a line
    a little over its centre, so the middle stroke and both ends slant like
    a real tilde instead of standing upright. Drawn as one contour so the
    two caps join edge to edge at every weight."""
    t = 0.56 * p.stem + 22
    if case:
        w, ht = p.w(292, 1.2), p.w(112, 0.62)
    else:
        w, ht = p.w(270, 1.2), p.w(124, 0.7)
    # The flat tops grow slowly so the bays under the caps stay open at
    # ExtraBold, where the tilde cannot get any taller.
    ws, wt = t * 0.8, 0.3 * p.stem + 22
    n, n_in = p.sq, p.sq_in
    ym = _bot(case) + 4 + ht / 2
    h2 = ht / 2
    k = 0.75  # the cut sits this fraction of the inner radius above centre
    d = k * (h2 - wt) / (1 - k)
    ry = h2 + d
    ryi = ry - wt
    # Where the cut crosses the unit quadrant, outside and inside.
    uo = _quadrant(0, 0, 1, 1, n, 0)
    ui = _quadrant(0, 0, 1, 1, n_in, 0)
    fo = _at(uo, _solve(uo, 1, d / ry))[0]
    fi = _at(ui, _solve(ui, 1, d / ryi))[0]
    # Place the cap so its right side straddles x = 0 at the cut (the two
    # halves then share that edge) and its left end sits at -w / 2.
    rx = (w / 2 + 0.5 * ws * fi) / (1.5 * fo + 0.5 * fi)
    rxi = rx - ws
    cx = -(rx * fo + rxi * fi) / 2
    yc = ym - d

    def arc(rx_, ry_, n_):
        """Cap arc from the right cut point over the top to the left one."""
        q0 = _quadrant(cx, yc, rx_, ry_, n_, 0)
        q1 = _quadrant(cx, yc, rx_, ry_, n_, 1)
        a = _split(q0, _solve(q0, 1, ym))[1]
        b = _split(q1, _solve(q1, 1, ym))[0]
        return [a, b]

    outer = arc(rx, ry, n)
    inner = [_rev(s) for s in reversed(arc(rxi, ryi, n_in))]  # left -> right
    # Snap the shared joins exactly.
    ao = (-inner[-1][3][0], ym)
    inner[-1][3] = (-ao[0], ym)
    outer[0][0] = ao

    def rot(seg):
        return [_rot(pt, ym) for pt in seg]

    segs = (
        outer
        + [inner[0][0]]
        + inner
        + [rot(s) for s in outer]
        + [rot(inner[0])[0]]
        + [rot(s) for s in inner]
    )
    return _contour(ao, segs)


# ---------------------------------------------------------------------------
# Cedilla and ogonek


def _cedilla_shape(p):
    """A short stub hanging from the letter into a squircle hook that turns
    right and back left, ending in a chamfered tail. Its top overlaps the
    base by 14 units so it joins c, C, s, t... at every weight. Strokes and
    chamfer come from `_curve` / `_mark_cut`, shared with ogonek and breve.
    Above Regular its two horizontals thin a little more (8% at ExtraBold),
    so the hook keeps a real counter (about 48 units, as at Regular) in the
    height between the baseline and the descender."""
    ws, wh = _curve(p)
    wh *= 1 - 0.08 * _up(p) / 80
    st, wt, wb = ws * 0.92, wh, wh
    top, yt = 14, -34
    h = p.w(130, 0.45)  # its foot reaches the descender (-200) at ExtraBold
    rx = p.w(96, 0.6)
    yb = yt - h
    cy, ry = (yt + yb) / 2, h / 2
    cyi, ryi, rxi = (yt - wt + yb + wb) / 2, (h - wt - wb) / 2, rx - ws
    xt = -rx * 0.5
    c = _mark_cut(ws)
    q0 = _quadrant(0, cy, rx, ry, p.sq, 0)
    q0 = _split(q0, _solve(q0, 0, st / 2))[0]  # up to the stub's right edge
    return _contour(
        (-st / 2, top),
        [
            (-st / 2, yt - wt),
            (0, yt - wt),
            _rev(_quadrant(0, cyi, rxi, ryi, p.sq_in, 0)),
            _rev(_quadrant(0, cyi, rxi, ryi, p.sq_in, 3)),
            (xt, yb + wb),
            (xt, yb + c),
            (xt + c, yb),
            (0, yb),
            _quadrant(0, cy, rx, ry, p.sq, 3),
            q0,
            (st / 2, top),
        ],
    )


def _ogonek_shape(p):
    """The left half of a tall squircle ring, its top meeting the letter and
    its foot running right into a chamfered tail. Same strokes and chamfers
    as the cedilla; it widens with weight so its inner curve keeps about the
    same radius (about 28 units) instead of closing into a slot."""
    ws, wh = _curve(p)
    wt, wb = wh, wh
    top = 10
    h = p.w(180, 0.3)
    rx = p.w(160, 1.0) / 2
    n, n_in = p.sq * 0.87, p.sq_in * 0.9
    yb = top - h
    cy, ry = (top + yb) / 2, h / 2
    cyi, ryi, rxi = (top - wt + yb + wb) / 2, (h - wt - wb) / 2, rx - ws
    xt = rx * 0.85
    c = _mark_cut(ws)
    shape = _contour(
        (0, top),
        [
            _quadrant(0, cy, rx, ry, n, 1),
            _quadrant(0, cy, rx, ry, n, 2),
            (xt - c, yb),
            (xt, yb + c),
            (xt, yb + wb),
            (0, yb + wb),
            _rev(_quadrant(0, cyi, rxi, ryi, n_in, 2)),
            _rev(_quadrant(0, cyi, rxi, ryi, n_in, 1)),
        ],
    )
    return shape - chamfer(0, top, c, "ne")


# ---------------------------------------------------------------------------
# Spacing accents


@_glyph("grave", 0x0060)
def grave(p):
    return _grave(p, False)


@_glyph("acute", 0x00B4)
def acute(p):
    return _acute(p, False)


@_glyph("circumflex", 0x02C6)
def circumflex(p):
    return _mark(_chevron(p, False), p)


@_glyph("caron", 0x02C7)
def caron(p):
    return _mark(_chevron(p, False, flip=True), p)


@_glyph("tilde", 0x02DC)
def tilde(p):
    return _mark(_tilde_shape(p, False), p)


@_glyph("dieresis", 0x00A8)
def dieresis(p):
    return _mark(_dieresis_shape(p, False), p)


@_glyph("dieresis.narrow")
def dieresis_narrow(p):
    """Unencoded component: the dieresis of idieresis."""
    return _mark(_dieresis_shape(p, False, narrow=True), p)


@_glyph("dotaccent", 0x02D9)
def dotaccent(p):
    return _mark(_dotaccent_shape(p, False), p)


@_glyph("macron", 0x00AF)
def macron(p):
    return _mark(_macron_shape(p, False), p)


@_glyph("ring", 0x02DA)
def ring_(p):
    return _mark(_ring_shape(p, False), p)


@_glyph("breve", 0x02D8)
def breve(p):
    return _mark(_breve_shape(p, False), p)


@_glyph("hungarumlaut", 0x02DD)
def hungarumlaut(p):
    return _hungarumlaut(p, False)


@_glyph("cedilla", 0x00B8)
def cedilla(p):
    # Attach by the stub, not the hook's centre.
    return _mark(_cedilla_shape(p), p, bottom=0)


@_glyph("ogonek", 0x02DB)
def ogonek(p):
    return _mark(_ogonek_shape(p), p, bottom=0)


# Capital forms -------------------------------------------------------------


@_glyph("grave.case")
def grave_case(p):
    return _grave(p, True)


@_glyph("acute.case")
def acute_case(p):
    return _acute(p, True)


@_glyph("circumflex.case")
def circumflex_case(p):
    return _mark(_chevron(p, True), p)


@_glyph("caron.case")
def caron_case(p):
    return _mark(_chevron(p, True, flip=True), p)


@_glyph("tilde.case")
def tilde_case(p):
    return _mark(_tilde_shape(p, True), p)


@_glyph("dieresis.case")
def dieresis_case(p):
    return _mark(_dieresis_shape(p, True), p)


@_glyph("dotaccent.case")
def dotaccent_case(p):
    return _mark(_dotaccent_shape(p, True), p)


@_glyph("macron.case")
def macron_case(p):
    return _mark(_macron_shape(p, True), p)


@_glyph("ring.case")
def ring_case(p):
    return _mark(_ring_shape(p, True), p)


@_glyph("breve.case")
def breve_case(p):
    return _mark(_breve_shape(p, True), p)


@_glyph("hungarumlaut.case")
def hungarumlaut_case(p):
    return _hungarumlaut(p, True)


# ---------------------------------------------------------------------------
# Composites

COMPOSITES = [
    # name, code point, base, mark
    ("Agrave", 0x00C0, "A", "grave.case"),
    ("Aacute", 0x00C1, "A", "acute.case"),
    ("Acircumflex", 0x00C2, "A", "circumflex.case"),
    ("Atilde", 0x00C3, "A", "tilde.case"),
    ("Adieresis", 0x00C4, "A", "dieresis.case"),
    ("Aring", 0x00C5, "A", "ring.case"),
    ("Ccedilla", 0x00C7, "C", "cedilla"),
    ("Egrave", 0x00C8, "E", "grave.case"),
    ("Eacute", 0x00C9, "E", "acute.case"),
    ("Ecircumflex", 0x00CA, "E", "circumflex.case"),
    ("Edieresis", 0x00CB, "E", "dieresis.case"),
    ("Igrave", 0x00CC, "I", "grave.case"),
    ("Iacute", 0x00CD, "I", "acute.case"),
    ("Icircumflex", 0x00CE, "I", "circumflex.case"),
    ("Idieresis", 0x00CF, "I", "dieresis.case"),
    ("Ntilde", 0x00D1, "N", "tilde.case"),
    ("Ograve", 0x00D2, "O", "grave.case"),
    ("Oacute", 0x00D3, "O", "acute.case"),
    ("Ocircumflex", 0x00D4, "O", "circumflex.case"),
    ("Otilde", 0x00D5, "O", "tilde.case"),
    ("Odieresis", 0x00D6, "O", "dieresis.case"),
    ("Ugrave", 0x00D9, "U", "grave.case"),
    ("Uacute", 0x00DA, "U", "acute.case"),
    ("Ucircumflex", 0x00DB, "U", "circumflex.case"),
    ("Udieresis", 0x00DC, "U", "dieresis.case"),
    ("Yacute", 0x00DD, "Y", "acute.case"),
    ("agrave", 0x00E0, "a", "grave"),
    ("aacute", 0x00E1, "a", "acute"),
    ("acircumflex", 0x00E2, "a", "circumflex"),
    ("atilde", 0x00E3, "a", "tilde"),
    ("adieresis", 0x00E4, "a", "dieresis"),
    ("aring", 0x00E5, "a", "ring"),
    ("ccedilla", 0x00E7, "c", "cedilla"),
    ("egrave", 0x00E8, "e", "grave"),
    ("eacute", 0x00E9, "e", "acute"),
    ("ecircumflex", 0x00EA, "e", "circumflex"),
    ("edieresis", 0x00EB, "e", "dieresis"),
    ("igrave", 0x00EC, "dotlessi", "grave"),
    ("iacute", 0x00ED, "dotlessi", "acute"),
    ("icircumflex", 0x00EE, "dotlessi", "circumflex"),
    ("idieresis", 0x00EF, "dotlessi", "dieresis.narrow"),
    ("ntilde", 0x00F1, "n", "tilde"),
    ("ograve", 0x00F2, "o", "grave"),
    ("oacute", 0x00F3, "o", "acute"),
    ("ocircumflex", 0x00F4, "o", "circumflex"),
    ("otilde", 0x00F5, "o", "tilde"),
    ("odieresis", 0x00F6, "o", "dieresis"),
    ("ugrave", 0x00F9, "u", "grave"),
    ("uacute", 0x00FA, "u", "acute"),
    ("ucircumflex", 0x00FB, "u", "circumflex"),
    ("udieresis", 0x00FC, "u", "dieresis"),
    ("yacute", 0x00FD, "y", "acute"),
    ("ydieresis", 0x00FF, "y", "dieresis"),
    ("Scaron", 0x0160, "S", "caron.case"),
    ("scaron", 0x0161, "s", "caron"),
    ("Zcaron", 0x017D, "Z", "caron.case"),
    ("zcaron", 0x017E, "z", "caron"),
    ("Ydieresis", 0x0178, "Y", "dieresis.case"),
]


# Stylistic-set forms of the accented letters, so ss01 (single-storey a) and
# ss02 (serifed I) also reach them. Unencoded: features.py adds `name.ssNN`
# to set NN because `name` exists.
SS_COMPOSITES = [
    ("agrave.ss01", None, "a.ss01", "grave"),
    ("aacute.ss01", None, "a.ss01", "acute"),
    ("acircumflex.ss01", None, "a.ss01", "circumflex"),
    ("atilde.ss01", None, "a.ss01", "tilde"),
    ("adieresis.ss01", None, "a.ss01", "dieresis"),
    ("aring.ss01", None, "a.ss01", "ring"),
    ("Igrave.ss02", None, "I.ss02", "grave.case"),
    ("Iacute.ss02", None, "I.ss02", "acute.case"),
    ("Icircumflex.ss02", None, "I.ss02", "circumflex.case"),
    ("Idieresis.ss02", None, "I.ss02", "dieresis.case"),
]


# Bases whose accents centre on the outline rather than on the base's own
# "top" anchor: a.ss01's anchor sits over the left of its bowl (about 80
# units left of the counter's centre at ExtraBold), while its counter is
# centred in the outline like o's.
_CENTRED = {"a.ss01"}


def _register_composite(name, cp, base, mark):
    def fn(p):
        if base in _CENTRED:
            b = ref(base).shape.bounds()
            return Compose(base, [mark], anchors={"top": (b[0] + b[2]) / 2})
        return Compose(base, [mark])

    fn.__name__ = fn.__qualname__ = name
    _glyph(name, *([] if cp is None else [cp]))(fn)


for _name, _cp, _base, _mk in COMPOSITES + SS_COMPOSITES:
    _register_composite(_name, _cp, _base, _mk)


__all__ = ["COMPOSITES", "SS_COMPOSITES", "Shape"]
