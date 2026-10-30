"""Straight-sided capitals: A E F I K L M N T V W X Y Z and AE.

Built like `H` in core.py: capital stems `p.cstem`, arms and bars `p.chair`,
the house 45-degree chamfer (`p.ccut`) only on free stem tops, square corners
where a stem turns into an arm, flat-cut diagonal ends and vertices, and ink
traps at the inner vertices of diagonals (`geom.crotch_trap`, depth `p.trap`).

Open right sides (E F L T Z) take a real sidebearing, a fraction of `p.csb`,
so they shrink with weight like the straight ones.

Diagonals are slanted strokes between the baseline and the cap height (or two
other heights) placed by one of their edges; joins are found by intersecting
those edges, so every weight uses the same construction.
"""

import math

from .. import params as P
from ..geom import crotch_trap, poly, rect
from . import G, glyph

CAP = P.CAP

PROOF_TEXT = [
    "HAHEHFHIHKHLHMHNHTHVHWHXHYHZHÆH",
    "OAOEOFOIOKOLOMONOTOVOWOXOYOZOÆO",
    "HHAHHOAOO HHVHHOVOO HHWHHOWOO",
    "FLAT MINT KLAXON ZENITH",
    "WAVY TAXI KNELT MAZE ÆTHELWIN",
    "TEXT FIZZ LATTE NEW WAVE MIX",
]


# ---------------------------------------------------------------------------
# Private helpers


def _meet(a0, a1, b0, b1):
    """Intersection of the infinite lines a0-a1 and b0-b1."""
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = a0, a1, b0, b1
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    return x1 + t * (x2 - x1), y1 + t * (y2 - y1)


_EDGE = {"l": 0.0, "c": 0.5, "r": 1.0}  # offset of an edge name across a stroke


class _Slant:
    """A straight stroke between heights yb and yt with horizontal ends.

    Placed by one edge (or the centre line) at each end: `bside` / `tside` say
    whether xb / xt is the left edge ("l"), centre ("c") or right edge ("r").
    `w` is the perpendicular thickness; `hw` the resulting horizontal width."""

    def __init__(self, xb, xt, w, bside="l", tside="l", yb=0.0, yt=CAP):
        self.yb, self.yt = yb, yt
        hw = w
        for _ in range(12):
            lb = xb - _EDGE[bside] * hw
            lt = xt - _EDGE[tside] * hw
            hw = w * math.hypot(lt - lb, yt - yb) / (yt - yb)
        self.lb = xb - _EDGE[bside] * hw
        self.lt = xt - _EDGE[tside] * hw
        self.hw = hw

    def xl(self, y):
        return self.lb + (self.lt - self.lb) * (y - self.yb) / (self.yt - self.yb)

    def xr(self, y):
        return self.xl(y) + self.hw

    def xc(self, y):
        return self.xl(y) + self.hw / 2

    def left(self):
        """Left edge as two points (bottom, top)."""
        return (self.lb, self.yb), (self.lt, self.yt)

    def right(self):
        return (self.lb + self.hw, self.yb), (self.lt + self.hw, self.yt)

    def y_at(self, edge, x):
        """Height where `edge` ("l", "r" or "c") crosses the vertical x."""
        off = _EDGE[edge] * self.hw
        return self.yb + (x - self.lb - off) * (self.yt - self.yb) / (self.lt - self.lb)

    def shape(self):
        y0, y1 = self.yb, self.yt
        return poly([(self.xl(y0), y0), (self.xr(y0), y0), (self.xr(y1), y1), (self.xl(y1), y1)])


MOUTH = 0.6  # crotch_trap's default mouth, as a fraction of the depth
MAX_LEN = 1.9  # longest vertex trap, mouth to tip, in p.trap: about n's shoulder trap


def _vtrap(p, v, d1, d2, k=1.0):
    """Ink trap at the inner vertex v of two straight edges leaving v along
    d1 and d2: geom.crotch_trap at depth k * p.trap. The more acute the
    crotch, the further along the edges crotch_trap must reach to open its
    mouth, so below about 37 degrees (the stem joins of M, N and AE, about
    22-30 degrees) the depth shrinks until the notch is no longer than n's
    shoulder trap instead of becoming a slit. A V Y K and the M vertex keep
    the full depth."""
    a1 = math.atan2(d1[1], d1[0])
    a2 = math.atan2(d2[1], d2[0])
    half = abs(math.remainder(a1 - a2, math.tau)) / 2
    length = 1 + (MOUTH / 2) / math.tan(half)  # mouth-to-tip length per unit depth
    return crotch_trap(v, d1, d2, k * p.trap * min(1.0, MAX_LEN / length), MOUTH)


def _down(edge):
    """Direction pointing down along an edge given as (bottom, top)."""
    (x0, y0), (x1, y1) = edge
    return x0 - x1, y0 - y1


def _up(edge):
    (x0, y0), (x1, y1) = edge
    return x1 - x0, y1 - y0


def _e_arms(p, x0, top, mid, bot, mid_y):
    """The three arms of E (and AE) starting inside a stem at x0."""
    h = p.chair
    return (
        rect(x0, CAP - h, top, CAP)
        + rect(x0, mid_y - h / 2, mid, mid_y + h / 2)
        + rect(x0, 0, bot, h)
    )


MID_Y = CAP * 0.51  # centre of E/F middle arms, matching the H bar


# ---------------------------------------------------------------------------
# Glyphs


@glyph("I", 0x0049)
def I(p):
    s = p.cstem
    return G(rect(0, 0, s, CAP, nw=p.ccut), l=p.csb, r=p.csb)


@glyph("I.ss02")
def I_ss02(p):
    """I with short square bars at top and bottom (ss02), so it can't be read
    as l or 1. The bars are arms, so their ends stay square."""
    s = p.cstem
    h = p.chair
    x0, x1 = s / 2 - 1.3 * s, s / 2 + 1.3 * s  # about 2.6 stems, centred
    shape = rect(0, 0, s, CAP) + rect(x0, CAP - h, x1, CAP) + rect(x0, 0, x1, h)
    return G(shape, l=p.csb * 0.7, r=p.csb * 0.7)


@glyph("L", 0x004C)
def L(p):
    s = p.cstem
    w = p.w(430, 0.55)
    shape = rect(0, 0, s, CAP, nw=p.ccut) + rect(s * 0.5, 0, w, p.chair)
    return G(shape, l=p.csb, r=p.csb * 0.55)


@glyph("E", 0x0045)
def E(p):
    s = p.cstem
    w = p.w(470, 0.65)
    shape = rect(0, 0, s, CAP) + _e_arms(p, s * 0.5, w - p.w(4, 0.05), w - p.w(30, 0.1), w, MID_Y)
    return G(shape, l=p.csb, r=p.csb * 0.75)


@glyph("F", 0x0046)
def F(p):
    s = p.cstem
    w = p.w(455, 0.6)
    h = p.chair
    mid_y = CAP * 0.49
    shape = rect(0, 0, s, CAP) + rect(s * 0.5, CAP - h, w, CAP) + rect(s * 0.5, mid_y - h / 2, w - p.w(36, 0.1), mid_y + h / 2)
    return G(shape, l=p.csb, r=p.csb * 0.7)


@glyph("T", 0x0054)
def T(p):
    s = p.cstem
    w = p.w(570, 0.6)
    h = p.chair
    cx = w / 2
    shape = rect(0, CAP - h, w, CAP) + rect(cx - s / 2, 0, cx + s / 2, CAP - h / 2)
    return G(shape, l=p.csb * 0.52, r=p.csb * 0.52)


@glyph("A", 0x0041)
def A(p):
    s = p.cstem
    w = p.w(650, 1.2)
    fa = s * 0.95  # flat apex about stem-wide
    cx = w / 2
    left = _Slant(0, cx - fa / 2, s * 0.88, "l", "l")  # thin up-stroke
    right = _Slant(w, cx + fa / 2, s * 0.96, "r", "r")  # thick down-stroke
    crotch = _meet(*left.right(), *right.left())
    bar_y = CAP * 0.30  # low, grotesque crossbar
    h = p.chair
    shape = poly([
        (0, 0), (left.hw, 0), crotch, (w - right.hw, 0), (w, 0),
        (right.lt + right.hw, CAP), (left.lt, CAP),
    ])
    shape = shape + rect(left.xc(bar_y), bar_y - h / 2, right.xc(bar_y), bar_y + h / 2)
    shape = shape - _vtrap(p, crotch, _down(left.right()), _down(right.left()))
    return G(shape, l=p.csbr * 0.3, r=p.csbr * 0.3)


@glyph("V", 0x0056)
def V(p):
    s = p.cstem
    w = p.w(650, 1.2)
    fb = s * 0.95  # flat-cut vertex
    cx = w / 2
    left = _Slant(cx - fb / 2, 0, s * 0.96, "l", "l")  # thick down-stroke
    right = _Slant(cx + fb / 2, w, s * 0.88, "r", "r")  # thin up-stroke
    crotch = _meet(*left.right(), *right.left())
    shape = poly([
        (cx - fb / 2, 0), (cx + fb / 2, 0), (w, CAP), (right.lt, CAP), crotch,
        (left.hw, CAP), (0, CAP),
    ])
    shape = shape - _vtrap(p, crotch, _up(left.right()), _up(right.left()))
    return G(shape, l=p.csbr * 0.3, r=p.csbr * 0.3)


@glyph("W", 0x0057)
def W(p):
    s = p.cstem
    w = p.w(910, 2.2)
    t_dn, t_up = s * 0.95, s * 0.9  # down-strokes heavier, as in V
    fb = s * 0.8  # flat bottom vertices
    fa = s * 0.8  # flat middle apex, at the cap height
    c1 = w * 0.255
    b1l, b1r = c1 - fb / 2, c1 + fb / 2
    b2l, b2r = w - c1 - fb / 2, w - c1 + fb / 2
    al, ar = w / 2 - fa / 2, w / 2 + fa / 2
    s1 = _Slant(b1l, 0, t_dn, "l", "l")
    s2 = _Slant(b1r, al, t_up, "r", "l")
    s3 = _Slant(b2l, ar, t_dn, "l", "r")
    s4 = _Slant(b2r, w, t_up, "r", "r")
    v1 = _meet(*s1.right(), *s2.left())
    ap = _meet(*s2.right(), *s3.left())
    v2 = _meet(*s3.right(), *s4.left())
    shape = poly([
        (0, CAP), (b1l, 0), (b1r, 0), ap, (b2l, 0), (b2r, 0), (w, CAP), (s4.lt, CAP),
        v2, (ar, CAP), (al, CAP), v1, (s1.hw, CAP),
    ])
    shape = shape - _vtrap(p, v1, _up(s1.right()), _up(s2.left()))
    shape = shape - _vtrap(p, v2, _up(s3.right()), _up(s4.left()))
    shape = shape - _vtrap(p, ap, _down(s2.right()), _down(s3.left()))
    return G(shape, l=p.csbr * 0.3, r=p.csbr * 0.3)


@glyph("M", 0x004D)
def M(p):
    s = p.cstem
    w = p.w(710, 1.8)
    sm = s * 0.92  # vertical sides
    td = s * 0.93  # diagonals
    fv = s * 0.8  # flat vertex on the baseline
    e = sm * 0.3  # diagonals start inside the stem tops
    cx = w / 2
    ld = _Slant(cx - fv / 2, e, td, "l", "l")
    rd = _Slant(cx + fv / 2, w - e, td, "r", "r")
    yl = ld.y_at("l", sm)
    yr = rd.y_at("r", w - sm)
    v = _meet(*ld.right(), *rd.left())
    shape = poly([
        (0, 0), (sm, 0), (sm, yl), (cx - fv / 2, 0), (cx + fv / 2, 0), (w - sm, yr),
        (w - sm, 0), (w, 0), (w, CAP), (rd.lt, CAP), v, (ld.lt + ld.hw, CAP), (0, CAP),
    ])
    shape = shape - _vtrap(p, (sm, yl), (0, -1), _down(ld.left()))
    shape = shape - _vtrap(p, (w - sm, yr), (0, -1), _down(rd.right()))
    shape = shape - _vtrap(p, v, _up(ld.right()), _up(rd.left()))
    return G(shape, l=p.csb, r=p.csb)


@glyph("N", 0x004E)
def N(p):
    s = p.cstem
    w = p.w(580, 1.2)
    sn = s * 0.92  # thin stems
    td = s * 0.97  # heavier diagonal
    e = sn * 0.3
    c = p.ccut
    dg = _Slant(w - e, e, td, "r", "l")
    yl = dg.y_at("l", sn)
    yr = dg.y_at("r", w - sn)
    shape = poly([
        (0, 0), (sn, 0), (sn, yl), (dg.lb, 0), (w, 0), (w, CAP - c), (w - c, CAP),
        (w - sn, CAP), (w - sn, yr), (dg.lt + dg.hw, CAP), (0, CAP),
    ])
    shape = shape - _vtrap(p, (sn, yl), (0, -1), _down(dg.left()))
    shape = shape - _vtrap(p, (w - sn, yr), (0, 1), _up(dg.right()))
    return G(shape, l=p.csb, r=p.csb)


@glyph("X", 0x0058)
def X(p):
    s = p.cstem
    w = p.w(620, 1.2)
    dt = p.w(16, 0.15)  # top slightly narrower than the bottom
    thick = _Slant(w, dt, s * 0.95, "r", "l")
    thin = _Slant(0, w - dt, s * 0.88, "l", "r")
    shape = thick.shape() + thin.shape()
    return G(shape, l=p.csbr * 0.3, r=p.csbr * 0.3)


@glyph("Y", 0x0059)
def Y(p):
    s = p.cstem
    w = p.w(620, 1.1)
    cx = w / 2
    yj = CAP * 0.42  # arm centre lines meet the stem axis here
    # Arms: placed by their outer top edge and their centre line at (cx, yj).
    la = _Slant(cx, 0, s * 0.95, "c", "l", yb=yj)
    ra = _Slant(cx, w, s * 0.88, "c", "r", yb=yj)
    xl, xr = cx - s / 2, cx + s / 2
    pl = (xl, la.y_at("l", xl))  # outer join, left
    pr = (xr, ra.y_at("r", xr))
    crotch = _meet(*la.right(), *ra.left())
    shape = poly([
        (xl, 0), (xr, 0), pr, (w, CAP), (ra.lt, CAP), crotch,
        (la.lt + la.hw, CAP), (0, CAP), pl,
    ])
    shape = shape - _vtrap(p, crotch, _up(la.right()), _up(ra.left()))
    return G(shape, l=p.csbr * 0.3, r=p.csbr * 0.3)


@glyph("K", 0x004B)
def K(p):
    s = p.cstem
    w = p.w(560, 1.0)  # right edge of the arm at the cap height
    wl = w + p.w(14, 0.2)  # the leg reaches a little further
    ta, tl = s * 0.9, s * 0.97
    y_arm = CAP * 0.36  # the arm's centre line meets the stem's right edge
    arm = _Slant(s, w, ta, "c", "r", yb=y_arm)
    # The leg branches from the arm's centre line, near the stem.
    jx = s + (arm.lt + arm.hw / 2 - s) * 0.35
    jy = arm.y_at("c", jx)
    leg = _Slant(wl, jx, tl, "r", "c", yb=0, yt=jy)
    p1 = (s, arm.y_at("r", s))  # arm meets the stem below...
    p2 = (s, arm.y_at("l", s))  # ...and above
    j = _meet(*arm.right(), *leg.left())
    q = _meet(*arm.right(), *leg.right())
    c = p.ccut
    shape = poly([
        (0, 0), (s, 0), p1, j, (leg.lb, 0), (leg.lb + leg.hw, 0), q,
        (arm.lt + arm.hw, CAP), (arm.lt, CAP), p2, (s, CAP), (c, CAP), (0, CAP - c),
    ])
    # Arm against stem: a short notch at the vertex, not a crack into the
    # stem. Arm against leg: nearly square, so a shallower one.
    shape = shape - _vtrap(p, p2, (0, 1), _up(arm.left()))
    shape = shape - _vtrap(p, q, _down(leg.right()), _up(arm.right()), k=0.8)
    return G(shape, l=p.csb, r=p.csbr * 0.3)


@glyph("Z", 0x005A)
def Z(p):
    s = p.cstem
    h = p.chair
    w = p.w(550, 0.9)
    xt0, xt1 = p.w(12, 0.1), w - p.w(10, 0.1)
    dg = _Slant(0, xt1, s * 0.95, "l", "r", yb=h, yt=CAP - h)
    shape = poly([
        (0, 0), (w, 0), (w, h), (dg.lb + dg.hw, h), (xt1, CAP - h), (xt1, CAP),
        (xt0, CAP), (xt0, CAP - h), (dg.lt, CAP - h), (0, h),
    ])
    return G(shape, l=p.csb * 0.65, r=p.csb * 0.65)


@glyph("AE", 0x00C6)
def AE(p):
    s = p.cstem
    h = p.chair
    xs = p.w(380, 1.4)  # left edge of the E stem
    # The A's thin up-stroke runs from the baseline at x = 0 into the E stem,
    # crossing the stem's left edge clearly below the top arm (an apex crotch
    # like A's); the top arm caps it like A's flat apex.
    dg = _Slant(0, xs + s * 0.55, s * 0.88, "l", "r")
    ew = p.w(420, 0.55)  # E arms, measured from the stem
    # One bar serves as A crossbar and E middle arm: lower than E's so the A
    # counter above it stays open.
    mid_y = CAP * 0.44
    shape = (
        dg.shape()
        + rect(xs, 0, xs + s, CAP)
        + rect(dg.lt + 1, CAP - h, xs + ew - p.w(4, 0.05), CAP)  # +1: no shared corner
        + rect(dg.xc(mid_y), mid_y - h / 2, xs + ew - p.w(30, 0.1), mid_y + h / 2)
        + rect(xs + s * 0.5, 0, xs + ew, h)
    )
    yc = dg.y_at("r", xs)
    shape = shape - _vtrap(p, (xs, yc), (0, -1), _down(dg.right()))
    return G(shape, l=p.csbr * 0.3, r=p.csb * 0.75)
