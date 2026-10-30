"""Round and bowled capitals: B C D G J P Q R S U, plus Eth, Oslash, OE and
Thorn.

Bowls of B D P R Thorn and the round half of OE are the right half of a
squircle whose top and bottom run straight into the stem (`_Bowl`). C G J S U
and the O-derived letters use the capital squircle (`p.sq * 0.92` outside,
`p.sq_in * 0.95` inside) with overshoot `P.COS`, like O in core.py.

Where a straight stroke continues a squircle quadrant (bowl tops, U and J
stems, G's right side, the S spine) the outline is drawn as one path with
`_quad` arcs instead of unioning a rectangle onto a ring: shapes that only
touch at a tangent point give different contours per weight and break the
variable font.
"""

import math

import pathops

from .. import params as P
from ..geom import Shape, band, chamfer, diag, notch, poly, rect, right_of, superness
from . import G, glyph, ref
from .parts import open_bowl, outer_x

PROOF_TEXT = [
    "HBHCHDHGHJHPHQHRHSHUH",
    "OBOCODOGOJOPOQOROSOUO",
    "HÐHÞHØHŒH OÐOÞOØOŒO",
    "SUBGROUP DROPS CURBS JOBS",
    "SCRUB HOGS CROUP BURGH QUOD",
    "ÞORP BØRS SŒUR GUÐ",
]


def _n(p):
    return p.sq * 0.92


def _ni(p):
    return p.sq_in * 0.95


# ---------------------------------------------------------------------------
# Path helpers


def _path(start, segs):
    """Closed outline from `start` through segments: a point (line) or a
    (c1, c2, end) triple (cubic)."""
    path = pathops.Path()
    pen = path.getPen()
    pen.moveTo(start)
    for s in segs:
        if len(s) == 3 and isinstance(s[0], tuple):
            pen.curveTo(*s)
        else:
            pen.lineTo(s)
    pen.closePath()
    path.simplify(fix_winding=True)
    return Shape(path)


def _ext(box, side):
    """Extreme point of the squircle filling box: side is r, t, l or b."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return {"r": (x1, cy), "t": (cx, y1), "l": (x0, cy), "b": (cx, y0)}[side]


def _quad(box, n, a, b):
    """One quadrant of the squircle filling box, from extreme a to extreme b,
    as a (c1, c2, end) cubic with the same handles as geom.squircle."""
    k = superness(n)
    pa, pb = _ext(box, a), _ext(box, b)
    corner = (pa[0] if a in "lr" else pb[0], pa[1] if a in "tb" else pb[1])
    c1 = (pa[0] + k * (corner[0] - pa[0]), pa[1] + k * (corner[1] - pa[1]))
    c2 = (pb[0] + k * (corner[0] - pb[0]), pb[1] + k * (corner[1] - pb[1]))
    return c1, c2, pb


def _half_sq(cx, y0, xe, y1, n, x_flat):
    """Half a squircle (centre cx, round extreme at xe, either side) whose
    top and bottom continue straight to x_flat on the other side: a D-shaped
    region from y0 to y1."""
    box = (min(xe, 2 * cx - xe), y0, max(xe, 2 * cx - xe), y1)
    e = "r" if xe > cx else "l"
    return _path((x_flat, y0), [(cx, y0), _quad(box, n, "b", e), _quad(box, n, e, "t"), (x_flat, y1)])


def _handles(p0, t0, p3, t3, k0, k3):
    """Cubic handles for a curve leaving p0 along unit tangent t0 and arriving
    at p3 along t3. Each handle runs a fraction (k0 at the start, k3 at the
    end) of the way to the corner where the two tangent lines meet, which is
    how a squircle quadrant is drawn (k = superness)."""
    (x0, y0), (x3, y3) = p0, p3
    # Corner K = p0 + a * t0 = p3 - b * t3.
    det = t0[0] * t3[1] - t3[0] * t0[1]
    dx, dy = x3 - x0, y3 - y0
    a = (dx * t3[1] - t3[0] * dy) / det
    kx, ky = x0 + a * t0[0], y0 + a * t0[1]
    return (x0 + k0 * (kx - x0), y0 + k0 * (ky - y0)), (x3 + k3 * (kx - x3), y3 + k3 * (ky - y3))


# ---------------------------------------------------------------------------
# Bowls of B D P R Thorn OE


class _Bowl:
    """Right-hand bowl: straight top and bottom strokes leave the stem and
    run to cx, where the right half of a squircle (outer extreme xr) takes
    over. `frac` is the share of xs..xr (stem edge to extreme) that is
    curved. `outer` runs left to x_out (default: the glyph's left edge 0, so
    it covers the stem too); `counter` is the white inside, starting at the
    stem edge xs. A glyph is (outer + stem below the bowl ...) - counter."""

    def __init__(self, p, xs, y0, y1, xr, wt, wb, ws, frac, x_out=0.0):
        n, ni = _n(p), _ni(p)
        rx = (xr - xs) * frac
        cx = xr - rx
        self.cx, self.n, self.y0, self.y1 = cx, n, y0, y1
        self.box = (cx - rx, y0, xr, y1)
        self.outer = _half_sq(cx, y0, xr, y1, n, x_out)
        self.counter = _half_sq(cx, y0 + wb, xr - ws, y1 - wt, ni, xs)
        self.counter_mid = (y0 + wb + y1 - wt) / 2

    def lower_quad(self):
        """Control points of the outer contour's lower right quadrant, from
        the bottom (cx, y0) to the right extreme, as drawn by _quad."""
        p0 = _ext(self.box, "b")
        return (p0,) + _quad(self.box, self.n, "b", "r")


def _bez(q, t):
    m = 1 - t
    return tuple(m**3 * q[0][i] + 3 * m * m * t * q[1][i] + 3 * m * t * t * q[2][i] + t**3 * q[3][i] for i in (0, 1))


def _bez_d(q, t):
    m = 1 - t
    return tuple(3 * m * m * (q[1][i] - q[0][i]) + 6 * m * t * (q[2][i] - q[1][i]) + 3 * t * t * (q[3][i] - q[2][i]) for i in (0, 1))


def _mid_stroke(p):
    """Thickness of B's middle stroke and Eth's bar: a little lighter than the
    other horizontals, and relatively lighter still at heavy weights so the
    counters stay open (as in Inter)."""
    return p.chair * (0.95 - 0.0019 * max(0.0, p.grow))


def _d_shape(p):
    s = p.cstem
    bowl = _Bowl(p, s, 0, P.CAP, p.w(568, 1.0), p.chair, p.chair, s * 1.03, 0.71)
    return bowl.outer - bowl.counter


@glyph("B", 0x0042)
def B(p):
    s = p.cstem
    w = p.w(506, 0.9)
    wu = w - p.w(28, 0.15)  # the upper bowl is a little narrower
    ym = P.CAP * 0.51  # centre of the middle stroke
    hb = _mid_stroke(p) / 2
    up = _Bowl(p, s, ym - hb, P.CAP, wu, p.chair, 2 * hb, s * 1.0, 0.575)
    lo = _Bowl(p, s, 0, ym + hb, w, 2 * hb, p.chair * 1.03, s * 1.02, 0.585)
    shape = (up.outer + lo.outer) - up.counter - lo.counter
    return G(shape, l=p.csb, r=p.csbr * 0.93)


@glyph("D", 0x0044)
def D(p):
    return G(_d_shape(p), l=p.csb, r=p.csbr)


@glyph("Eth", 0x00D0)
def Eth(p):
    s = p.cstem
    yc = P.CAP * 0.5
    hb = _mid_stroke(p) * 0.47
    ext = p.w(88, 0.35)  # bar overhang left of the stem
    bar = rect(-ext, yc - hb, s + p.w(175, 0.2), yc + hb)
    return G(_d_shape(p) + bar, l=p.csb * 0.15, r=p.csbr)


@glyph("P", 0x0050)
def P_(p):
    s = p.cstem
    yb = P.CAP * (0.361 - 0.00025 * max(0.0, p.grow))
    bowl = _Bowl(p, s, yb, P.CAP, p.w(492, 0.85), p.chair, p.chair, s * 1.02, 0.61)
    shape = (bowl.outer + rect(0, 0, s, yb + 2)) - bowl.counter
    return G(shape, l=p.csb, r=p.csbr * 0.9)


@glyph("Thorn", 0x00DE)
def Thorn(p):
    s = p.cstem
    bowl = _Bowl(p, s, P.CAP * 0.218, P.CAP * 0.794, p.w(469, 0.85), p.chair, p.chair, s * 1.02, 0.635, x_out=s - 2)
    shape = (rect(0, 0, s, P.CAP, nw=p.ccut) + bowl.outer) - bowl.counter
    return G(shape, l=p.csb, r=p.csbr * 1.15)


@glyph("R", 0x0052)
def R(p):
    s = p.cstem
    w = p.w(492, 0.85)
    yb = P.CAP * (0.3875 - 0.0006 * max(0.0, p.grow))
    bowl = _Bowl(p, s, yb, P.CAP, w, p.chair, p.chair, s * 1.02, 0.615)
    # Straight leg from the bowl's lower stroke to the baseline. Its left
    # edge leaves the underside of the stroke just before the curve begins
    # (always on the flat part, so the contour is the same at every weight);
    # its top runs up into the counter and is trimmed by it.
    wl = p.cstem * 0.97
    x_br = w + p.w(26, 0.1)  # right edge of the foot
    xa = bowl.cx - 8 - 0.9 * max(0.0, p.grow)  # left edge at the stroke's underside, on its flat part
    hw = wl
    for _ in range(12):
        hw = wl * math.hypot(xa - (x_br - hw), yb) / yb
    x_bl = x_br - hw
    slope = (xa - x_bl) / yb  # dx per unit of height along the leg
    yt = bowl.counter_mid
    xl_t = x_bl + slope * yt
    leg = poly([(x_bl, 0), (x_br, 0), (xl_t + hw, yt), (xl_t, yt)])
    shape = (bowl.outer + rect(0, 0, s, yb + 2) + leg) - bowl.counter
    # Crotch between the leg's right edge and the bowl: where the edge line
    # x = x_br + slope * y crosses the bowl's lower right quadrant (the leg
    # always leaves the flat underside, so the crossing is on the curve).
    q = bowl.lower_quad()
    lo_, hi_ = 0.0, 1.0
    for _ in range(60):
        mid = (lo_ + hi_) / 2
        x, y = _bez(q, mid)
        if x < x_br + slope * y:
            lo_ = mid
        else:
            hi_ = mid
    cx_, cy_ = _bez(q, hi_)
    # The trap is cut the way stem_trap cuts n: it runs up the leg's right
    # edge into the black and opens towards the bowl.
    ul = math.hypot(slope, 1.0)
    u = (slope / ul, 1.0 / ul)  # up along the leg edge
    nr = (u[1], -u[0])  # out of the leg, into the white crotch
    d2 = _bez_d(q, hi_)  # along the bowl, away from the leg
    cos_w = -(u[0] * d2[0] + u[1] * d2[1]) / math.hypot(*d2)
    wedge = math.degrees(math.acos(max(-1.0, min(1.0, cos_w))))
    # The leg is wider at heavy weights, so it meets the bowl higher up the
    # curve and the crotch opens; scale the trap by how acute the white angle
    # is so it never notches an open join.
    d = p.trap * 1.05 * min(1.0, max(0.3, (110 - wedge) / 40))

    def at(ku, kn):
        return (cx_ + (u[0] * ku + nr[0] * kn) * d, cy_ + (u[1] * ku + nr[1] * kn) * d)

    # tip in the leg above the crotch, a in the white below it (the a-tip side
    # crosses the leg edge, not the bowl), b inside the bowl.
    tip, a, b = at(1.0, -0.22), at(-1.33, 0.1), at(1.0, 0.85)
    shape = shape - notch(tip, a, b)
    return G(shape, l=p.csb, r=p.csbr * 0.5, anchors={"top": w / 2})


# ---------------------------------------------------------------------------
# C G


@glyph("C", 0x0043)
def C(p):
    w = p.w(610, 1.0)
    shape = open_bowl(
        p, 0, w, -P.COS, P.CAP + P.COS, p.cstem * 1.03, p.chair * 1.04, p.chair * 1.04,
        cut_top=P.CAP * 0.686, cut_bottom=P.CAP * 0.314, n=_n(p), n_in=_ni(p), chamfer_leg=p.ccut,
    )
    return G(shape, l=p.csbr, r=p.csbr * 0.88)


@glyph("G", 0x0047)
def G_(p):
    w = p.w(618, 1.05)
    n, ni = _n(p), _ni(p)
    ws = p.cstem * 1.03
    wt = wb = p.chair * 1.04
    y0, y1 = -P.COS, P.CAP + P.COS
    cx, cy = w / 2, (y0 + y1) / 2
    bar_w = p.chair
    ys = cy - bar_w - 1  # the right side runs straight from the bar down to here
    ct = P.CAP * 0.686
    # Upper and left curves from the main squircle; the lower right quadrant
    # is a tighter squircle centred at ys, so the right side is straight from
    # the bar (top at cy) to ys and then turns into the bottom.
    mo, mi = (0, y0, w, y1), (ws, y0 + wb, w - ws, y1 - wt)
    lo, li = (0, y0, w, 2 * ys - y0), (ws, y0 + wb, w - ws, 2 * ys - y0 - wb)
    outer = _path((w, cy), [_quad(mo, n, "r", "t"), _quad(mo, n, "t", "l"), _quad(mo, n, "l", "b"), _quad(lo, n, "b", "r")])
    inner = _path((w - ws, cy), [_quad(mi, ni, "r", "t"), _quad(mi, ni, "t", "l"), _quad(mi, ni, "l", "b"), _quad(li, ni, "b", "r")])
    shape = (outer - inner) - (right_of(cx) & band(cy, ct))
    shape = shape + rect(w * 0.55, cy - bar_w, w - 1, cy)
    shape = shape - chamfer(outer_x(0, w, y0, y1, n, ct, "right"), ct, p.ccut, "se")
    return G(shape, l=p.csbr, r=p.csbr * 1.05)


# ---------------------------------------------------------------------------
# J U


@glyph("J", 0x004A)
def J(p):
    s = p.cstem
    w = p.w(430, 0.6)
    n, ni = _n(p), _ni(p)
    c = p.ccut
    yc = P.CAP * (0.287 - 0.0002 * max(0.0, p.grow))  # where the hook turns straight
    yt = yc + c * 1.25  # terminal face, high enough for its chamfer
    y0, y1 = -P.COS, 2 * yc + P.COS
    ws = s * 1.0
    wb = p.chair * 1.04
    ob, ib = (0, y0, w, y1), (ws, y0 + wb, w - s, y1 - wb)
    shape = _path(
        (w, P.CAP - c),
        [
            (w, yc), _quad(ob, n, "r", "b"), _quad(ob, n, "b", "l"),
            (0, yt - c), (c, yt), (ws, yt),
            (ws, yc), _quad(ib, ni, "l", "b"), _quad(ib, ni, "b", "r"),
            (w - s, P.CAP), (w - c, P.CAP),
        ],
    )
    return G(shape, l=p.csbr * 0.8, r=p.csb, anchors={"top": w - s / 2})


@glyph("U", 0x0055)
def U(p):
    s = p.cstem
    w = p.w(562, 1.0)
    n, ni = _n(p), _ni(p)
    c = p.ccut
    yc = P.CAP * 0.345
    y0, y1 = -P.COS, 2 * yc + P.COS
    wb = p.chair * 1.06
    ob, ib = (0, y0, w, y1), (s, y0 + wb, w - s, y1 - wb)
    shape = _path(
        (0, P.CAP - c),
        [
            (0, yc), _quad(ob, n, "l", "b"), _quad(ob, n, "b", "r"),
            (w, P.CAP - c), (w - c, P.CAP), (w - s, P.CAP),
            (w - s, yc), _quad(ib, ni, "r", "b"), _quad(ib, ni, "b", "l"),
            (s, P.CAP), (c, P.CAP),
        ],
    )
    return G(shape, l=p.csb, r=p.csb)


# ---------------------------------------------------------------------------
# S


@glyph("S", 0x0053)
def S(p):
    n, ni = _n(p), _ni(p)
    w = p.w(523, 0.9)
    ws = p.cstem * 1.0
    wt = p.chair * 1.03
    wb = p.chair * 1.06
    ytop, ybot = P.CAP + P.COS, -P.COS
    # Upper bowl (narrower, a touch right) and lower bowl: squircles centred on
    # the heights of their vertical extremes, where the terminals are cut
    # horizontally.
    xul, xur = w * 0.038, w * 0.981
    ycu = P.CAP * (0.735 - 0.0003 * max(0.0, p.grow))
    ycl = P.CAP * (0.27 + 0.0002 * max(0.0, p.grow))
    uo = (xul, 2 * ycu - ytop, xur, ytop)
    ui = (xul + ws, uo[1] + wt, xur - ws, ytop - wt)
    lo = (0, ybot, w, 2 * ycl - ybot)
    li = (ws, ybot + wb, w - ws, lo[3] - wb)
    # Spine: edges leave the bowls' vertical extremes and meet a straight
    # middle at a shallow angle th with perpendicular thickness t.
    th = math.radians(15.5)
    t = p.chair * 1.09
    seg = w * 0.16  # length of the straight middle
    xc, yc = w * 0.507, P.CAP * 0.508
    d = (math.cos(th), -math.sin(th))
    nrm = (math.sin(th), math.cos(th))
    mb = (xc - nrm[0] * t / 2, yc - nrm[1] * t / 2)
    mt = (xc + nrm[0] * t / 2, yc + nrm[1] * t / 2)
    mb0, mb1 = (mb[0] - d[0] * seg / 2, mb[1] - d[1] * seg / 2), (mb[0] + d[0] * seg / 2, mb[1] + d[1] * seg / 2)
    mt0, mt1 = (mt[0] - d[0] * seg / 2, mt[1] - d[1] * seg / 2), (mt[0] + d[0] * seg / 2, mt[1] + d[1] * seg / 2)
    down, up = (0.0, -1.0), (0.0, 1.0)
    neg_d = (-d[0], -d[1])
    b0, b3 = _ext(uo, "l"), _ext(li, "r")
    t0, t3 = _ext(ui, "l"), _ext(lo, "r")
    b1a, b2a = _handles(b0, down, mb0, d, 0.72, 0.66)  # outer left into the spine
    b1b, b2b = _handles(mb1, d, b3, down, 0.56, 0.9)  # spine into the lower counter
    t1a, t2a = _handles(t3, up, mt1, neg_d, 0.92, 0.45)  # outer right up into the spine
    t1b, t2b = _handles(mt0, neg_d, t0, up, 0.45, 0.92)  # spine up into the upper counter
    shape = _path(
        _ext(uo, "r"),
        [
            _quad(uo, n, "r", "t"), _quad(uo, n, "t", "l"),
            (b1a, b2a, mb0), mb1, (b1b, b2b, b3),
            _quad(li, ni, "r", "b"), _quad(li, ni, "b", "l"),
            _ext(lo, "l"),
            _quad(lo, n, "l", "b"), _quad(lo, n, "b", "r"),
            (t1a, t2a, mt1), mt0, (t1b, t2b, t0),
            _quad(ui, ni, "l", "t"), _quad(ui, ni, "t", "r"),
        ],
    )
    shape = shape - chamfer(xur, ycu, p.ccut, "se") - chamfer(0, ycl, p.ccut, "nw")
    return G(shape, l=p.csbr * 0.93, r=p.csbr * 0.93)


# ---------------------------------------------------------------------------
# O-derived: Q Oslash OE


@glyph("Q", 0x0051)
def Q(p):
    o = ref("O")
    x0, _, x1, _ = o.shape.bounds()
    w = x1 - x0
    # Straight tail crossing the bowl's lower right; both ends cut flat.
    wt = p.cstem * 0.9 - 0.25 * max(0.0, p.grow)
    tail = diag(x0 + w * 0.873, -P.CAP * 0.094, x0 + w * 0.529, P.CAP * 0.3125, wt)
    return G(o.shape + tail, width=o.width)


@glyph("Oslash", 0x00D8)
def Oslash(p):
    o = ref("O")
    x0, _, x1, _ = o.shape.bounds()
    w = x1 - x0
    # The slash stays light at heavy weights so the counters stay open.
    wsl = p.cstem * 0.85 - 0.6 * max(0.0, p.grow)
    slash = diag(x0 + w * 0.11, -P.CAP * 0.03, x0 + w * 0.89, P.CAP * 1.03, wsl)
    return G(o.shape + slash, width=o.width)


@glyph("OE", 0x0152)
def OE(p):
    s = p.cstem
    xs = p.w(428, 0.7)  # left edge of the shared stem
    # Left: a mirrored D bowl whose straight strokes run into the E stem.
    rx = xs * 0.755
    outer = _half_sq(rx, 0, 0, P.CAP, _n(p), xs + s)
    counter = _half_sq(rx, p.chair, s * 1.03, P.CAP - p.chair, _ni(p), xs)
    # Arms as in E (upper_straight): same lengths from the stem's left edge,
    # middle arm centred on the H bar height.
    xe = xs + s - 2
    ym = P.CAP * 0.51
    arms = (
        rect(xe, P.CAP - p.chair, xs + p.w(466, 0.6), P.CAP)
        + rect(xe, ym - p.chair / 2, xs + p.w(440, 0.55), ym + p.chair / 2)
        + rect(xe, 0, xs + p.w(470, 0.65), p.chair)
    )
    return G((outer - counter) + arms, l=p.csbr, r=p.csb * 0.45)
