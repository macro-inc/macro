"""Figures and the symbols set with them: lining tabular 0-9 (plus a slashed
zero), superiors and vulgar fractions, percent and per-mille, currency signs,
math operators, degree, mu and the ordinals.

Figures sit on the cap height (720) with the capital overshoot `P.COS`, use
`p.fstem` / `p.fhair` and the capital squircle exponents, and share one
tabular advance (`_fw`): each is drawn from x = 0 and centred in it by `_fit`.
Math operators share that advance and centre on `P.AXIS`.
"""

import math

import pathops

from .. import params as P
from ..geom import (
    Shape,
    above,
    below,
    chamfer,
    diag,
    dot,
    left_of,
    poly,
    rect,
    right_of,
    ring,
    squircle,
    stem_trap,
    stroke,
    trap,
)
from . import G, glyph
from .parts import arch, outer_x

PROOF_TEXT = [
    "H0H1H2H3H4H5H6H7H8H9H",
    "0123456789 1234567890 00 n0n1n2n3n4n5n",
    "$1,250.00 ±3% 98.6° €42 £7 ¥300 ¢ ¤ ƒ",
    "2+2=4 5×3≠14 ½ ¼ ¾ 7÷2 1⁄2 x² m³ ¹",
    "a<b>c ≤ ≥ ≈ ~ ^ ¬ # % ‰ ∞ µm ª º",
    "HOH 1984 2025 0815 H#H H$H H£H n%n n°n",
]


# ---------------------------------------------------------------------------
# Shared helpers


def _n(p):
    return p.sq * 0.92


def _ni(p):
    return p.sq_in * 0.95


def _fh(p):
    """Figure horizontal stroke: thins a little with weight, like the capital
    hairline, so counters stay open in ExtraBold."""
    return p.fhair * (1.0 - 0.07 * max(0.0, p.grow) / 70)


def _fw(p):
    """The shared tabular advance."""
    return round(p.w(600, 0.9))


def _ox(box, n, y, side):
    """x where the squircle filling box (x0, y0, x1, y1) crosses height y."""
    return outer_x(box[0], box[2], box[1], box[3], n, y, side)


def _oy(box, n, x, side="top"):
    """y where the squircle filling box crosses x."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    t = min(1.0, abs(x - cx) / rx)
    dy = ry * (1 - t**n) ** (1 / n)
    return cy + dy if side == "top" else cy - dy


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


def _handles(p0, t0, p3, t3, k0, k3):
    """Cubic handles for a curve leaving p0 along unit tangent t0 and arriving
    at p3 along t3; each handle runs k0 / k3 of the way to where the tangent
    lines meet (a squircle quadrant uses k = superness)."""
    (x0, y0), (x3, y3) = p0, p3
    det = t0[0] * (-t3[1]) - t0[1] * (-t3[0])
    dx, dy = x3 - x0, y3 - y0
    a = (dx * (-t3[1]) - dy * (-t3[0])) / det
    b = (t0[0] * dy - t0[1] * dx) / det  # corner = p3 + b * t3 (b < 0)
    return (x0 + k0 * a * t0[0], y0 + k0 * a * t0[1]), (x3 + k3 * b * t3[0], y3 + k3 * b * t3[1])


def _unit(a_deg):
    a = math.radians(a_deg)
    return (math.cos(a), math.sin(a))


def _line_cross_sq(p0, d, box, n, lo=0.0, hi=2000.0):
    """First point along p0 + t*d (t in lo..hi) that lies inside the squircle
    filling box; used to find where a straight stroke edge meets a bowl."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2

    def inside(t):
        x, y = p0[0] + d[0] * t, p0[1] + d[1] * t
        return (abs(x - cx) / rx) ** n + (abs(y - cy) / ry) ** n <= 1

    steps = 400
    prev = lo
    for i in range(1, steps + 1):
        t = lo + (hi - lo) * i / steps
        if inside(t):
            a, b = prev, t
            for _ in range(40):
                m = (a + b) / 2
                if inside(m):
                    b = m
                else:
                    a = m
            return (p0[0] + d[0] * b, p0[1] + d[1] * b)
        prev = t
    return None


def _crotch(x, y, a1, a2, depth):
    """Ink trap at a crotch (x, y) whose two edges leave it into the white at
    angles a1 and a2 (degrees): the wedge points into the black, opposite
    the bisector of the white angle."""
    if depth < 1:
        return Shape()
    u1, u2 = _unit(a1), _unit(a2)
    bx, by = u1[0] + u2[0], u1[1] + u2[1]
    m = math.hypot(bx, by)
    bx, by = bx / m, by / m
    e = depth * 0.5

    def mouth(u):
        # A point on the edge, pushed a little into the white.
        nx, ny = -u[1], u[0]
        if nx * bx + ny * by < 0:
            nx, ny = -nx, -ny
        return (x + u[0] * e + nx * 2, y + u[1] * e + ny * 2)

    tip = (x - bx * depth, y - by * depth)
    return poly([mouth(u1), tip, mouth(u2), (x + bx * e, y + by * e)])


def _sq_pts(box, n, per=180):
    """Points along the cubic squircle exactly as `geom.squircle` draws it."""
    from ..geom import superness

    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    k = superness(n)
    segs = [
        ((cx + rx, cy), (cx + rx, cy + k * ry), (cx + k * rx, cy + ry), (cx, cy + ry)),
        ((cx, cy + ry), (cx - k * rx, cy + ry), (cx - rx, cy + k * ry), (cx - rx, cy)),
        ((cx - rx, cy), (cx - rx, cy - k * ry), (cx - k * rx, cy - ry), (cx, cy - ry)),
        ((cx, cy - ry), (cx + k * rx, cy - ry), (cx + rx, cy - k * ry), (cx + rx, cy)),
    ]
    pts = []
    for a, b, c, d in segs:
        for i in range(per):
            t = i / per
            m = 1 - t
            w0, w1, w2, w3 = m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t
            pts.append((w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0], w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1]))
    return pts


def _tangent(q, box, n, pick):
    """The two points where lines from q touch the squircle filling box;
    `pick` chooses one: "left" / "right" (smaller / larger x) or "low" /
    "high" (smaller / larger y)."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    vx, vy = cx - q[0], cy - q[1]
    best_hi = best_lo = None
    for x, y in _sq_pts(box, n):
        ux, uy = x - q[0], y - q[1]
        ang = math.atan2(vx * uy - vy * ux, vx * ux + vy * uy)
        if best_hi is None or ang > best_hi[0]:
            best_hi = (ang, (x, y))
        if best_lo is None or ang < best_lo[0]:
            best_lo = (ang, (x, y))
    a, b = best_hi[1], best_lo[1]
    i = {"left": 0, "right": 0, "low": 1, "high": 1}[pick]
    if (a[i] > b[i]) == (pick in ("left", "low")):
        a, b = b, a
    return a


def _inward(pt, box, d=1.5):
    """Nudge a point on a squircle d units towards its centre, so a line
    through it crosses the outline cleanly instead of grazing it."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    vx, vy = cx - pt[0], cy - pt[1]
    m = math.hypot(vx, vy)
    return (pt[0] + vx / m * d, pt[1] + vy / m * d)


def _fit(p, shape, dx=0.0, width=None):
    """Centre the outline in the tabular advance (or `width`)."""
    w = _fw(p) if width is None else width
    b = shape.bounds()
    off = (w - (b[0] + b[2])) / 2 + dx
    return G(shape.move(off, 0), width=w)


# ---------------------------------------------------------------------------
# Figures. Each returns its outline drawn from about x = 0.


def _zero_box(p):
    w = p.w(468, 1.2)
    ws = p.fstem * 1.04
    h = _fh(p)
    return (0, -P.COS, w, P.CAP + P.COS), ws, h


def _zero(p):
    box, ws, h = _zero_box(p)
    x0, y0, x1, y1 = box
    return ring(x0, y0, x1, y1, ws, h, n=_n(p), n_in=_ni(p))


def _zero_slash(p):
    """Short slash floating in the zero's counter: flat ends (like every
    diagonal), steep fixed angle, length set so the ends clear the counter
    by a gap at every weight."""
    box, ws, h = _zero_box(p)
    x0, y0, x1, y1 = box
    ibox = (x0 + ws, y0 + h, x1 - ws, y1 - h)
    ni = _ni(p)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    t = p.fhair * 0.8
    th = math.radians(63)
    hw = t / (2 * math.sin(th))
    gap = 18 + 0.25 * t
    ry_in = (ibox[3] - ibox[1]) / 2

    def fits(L):
        a = L / math.tan(th)
        return cx + a + hw <= _ox(ibox, ni, cy + L, "right") - gap

    lo, hi = 0.0, ry_in * 0.6
    for _ in range(40):
        m = (lo + hi) / 2
        if fits(m):
            lo = m
        else:
            hi = m
    L = lo
    a = L / math.tan(th)
    return diag(cx - a, cy - L, cx + a, cy + L, t)


def _one(p):
    s = p.fstem
    t = _fh(p) * 1.04
    a = math.radians(35)
    reach = p.w(192, 0.45)  # flag reach left of the stem, along its top edge
    d = (-math.cos(a), -math.sin(a))
    nrm = (math.sin(a), -math.cos(a))  # across the flag, towards the stem foot
    L = reach / math.cos(a)
    e_top = (d[0] * L, P.CAP + d[1] * L)
    e_bot = (e_top[0] + nrm[0] * t, e_top[1] + nrm[1] * t)
    i_top = (s, P.CAP + s * math.tan(a))
    i_bot = (i_top[0] + nrm[0] * t, i_top[1] + nrm[1] * t)
    flag = poly([e_top, i_top, i_bot, e_bot]) & below(P.CAP) & left_of(s * 0.5)
    stem = rect(0, 0, s, P.CAP)
    crotch = P.CAP - t / math.cos(a)
    return stem + flag - _crotch(0, crotch, 270, 180 + math.degrees(a), p.trap)


def _two(p):
    n, ni = _n(p), _ni(p)
    w = p.w(452, 1.1)
    ws = p.fstem * 1.0
    h = _fh(p)
    hb = h * 1.02
    y1 = P.CAP + P.COS
    yl = P.CAP * 0.25
    cy = (yl + y1) / 2
    box = (0, yl, w, y1)
    ibox = (ws, yl + h, w - ws, y1 - h)
    cx = w / 2
    yt = P.CAP * 0.665
    up = (squircle(*box, n=n) - squircle(*ibox, n=ni)) & above(cy - 1)
    up = up - (left_of(cx) & below(yt))
    up = up - chamfer(_ox(box, n, yt, "left"), yt, p.ccut, "sw")
    # Spine: the right side turns into a straight diagonal that lands on the
    # top-left corner of the base.
    td = p.fstem * 0.98
    th = math.radians(39)
    d = (math.cos(th), math.sin(th))
    nrm = (math.sin(th), -math.cos(th))
    bi = (0.0, hb)
    ym = P.CAP * 0.33
    mi = (bi[0] + d[0] * (ym - hb) / d[1], ym)
    mo = (mi[0] + nrm[0] * td, mi[1] + nrm[1] * td)
    yb = hb * 0.4
    lo_b = (mo[0] - d[0] * (mo[1] - yb) / d[1], yb)
    down, upv = (0.0, -1.0), (0.0, 1.0)
    i1, i2 = _handles((w - ws, cy), down, mi, (-d[0], -d[1]), 0.78, 0.5)
    o1, o2 = _handles(mo, d, (w, cy), upv, 0.5, 0.78)
    e = 2.0
    spine = _path(
        (w, cy + e),
        [
            (w - ws, cy + e),
            (w - ws, cy),
            (i1, i2, mi),
            bi,
            (bi[0] + 4, yb),
            lo_b,
            mo,
            (o1, o2, (w, cy)),
        ],
    )
    base = rect(0, 0, w + p.w(6, 0.1), hb)
    crotch_x = mo[0] - d[0] * (mo[1] - hb) / d[1]
    shape = up + spine + base
    return shape - _crotch(crotch_x, hb, 0, math.degrees(th), p.trap)


def _three(p):
    n, ni = _n(p), _ni(p)
    ws = p.fstem * 1.0
    h = _fh(p)
    wl = p.w(462, 1.1)
    wu = p.w(420, 1.0)
    xr_u = wl - p.w(16, 0.1)
    xu0 = xr_u - wu
    ym = P.CAP * 0.555
    hm = h * 0.96
    ub = (xu0, ym - hm / 2, xr_u, P.CAP + P.COS)
    ui = (xu0 + ws * 0.97, ub[1] + hm, xr_u - ws * 0.97, ub[3] - h)
    lb = (0, -P.COS, wl, ym + hm / 2)
    li = (ws * 1.02, lb[1] + h, wl - ws * 1.02, lb[3] - hm)
    cxu, cxl = (ub[0] + ub[2]) / 2, (lb[0] + lb[2]) / 2
    cyu, cyl = (ub[1] + ub[3]) / 2, (lb[1] + lb[3]) / 2
    ytu = cyu + 0.36 * (ub[3] - ub[1]) / 2
    ytl = cyl - 0.36 * (lb[3] - lb[1]) / 2
    up = squircle(*ub, n=n) - squircle(*ui, n=ni)
    up = up - (left_of(cxu) & below(ytu))
    up = up - chamfer(_ox(ub, n, ytu, "left"), ytu, p.ccut, "sw")
    lo = squircle(*lb, n=n) - squircle(*li, n=ni)
    lo = lo - (left_of(cxl) & above(ytl))
    lo = lo - chamfer(_ox(lb, n, ytl, "left"), ytl, p.ccut, "nw")
    xbar = wl * 0.30
    bar = rect(xbar, ym - hm / 2, max(cxu, cxl), ym + hm / 2)
    return up + lo + bar


def _four(p):
    s = p.fstem
    w = p.w(506, 1.1)
    t = p.fstem * 0.9
    hb = _fh(p)
    yb = P.CAP * 0.235
    xs = w - p.w(84, 0.25) - s
    xr = w
    stem = rect(xs, 0, xs + s, P.CAP, ne=p.ccut)
    bar = rect(0, yb, xr, yb + hb)
    # Diagonal: outer edge from the bar's top-left corner to the stem's
    # top-left corner, inner edge parallel at perpendicular thickness t.
    ox0, oy0 = 0.0, yb + hb
    dx, dy = xs - ox0, P.CAP - oy0
    hw = t * math.hypot(dx, dy) / dy
    dg = poly([(0, yb), (ox0, oy0), (xs, P.CAP), (xs + hw, P.CAP), (hw - hb * dx / dy, yb)])
    dg = dg & left_of(xs + s * 0.5)
    shape = stem + bar + dg
    ang = math.degrees(math.atan2(dx, dy))  # diagonal's lean from vertical
    # Crotch where the inner edge meets the stem.
    yc = oy0 + (xs - hw) * dy / dx
    shape = shape - _crotch(xs, yc, -90, 180 + 90 - ang, p.trap)
    # Crotch where the inner edge meets the bar.
    shape = shape - _crotch(hw, oy0, 0, 90 - ang, p.trap)
    return shape


def _five(p):
    n, ni = _n(p), _ni(p)
    s = p.fstem
    ws = s * 1.02
    h = _fh(p)
    w = p.w(458, 1.1)
    xs = p.w(18, 0.15)
    xl = xs + s
    top = P.CAP * 0.615
    yc = (top - P.COS) / 2
    join_out = top - h * 0.12
    join_in = top - h - (top - yc) * 0.2
    shoulder = arch(xl, w, top, yc, ws, h, join_out, join_in, n=n, n_in=ni)
    lb = (0, -P.COS, w, 2 * yc + P.COS)
    li = (ws, lb[1] + h, w - ws, lb[3] - h)
    cxl = w / 2
    ytl = yc - 0.36 * (yc + P.COS)
    lo = (squircle(*lb, n=n) - squircle(*li, n=ni)) & below(yc)
    lo = lo - (left_of(cxl) & above(ytl))
    lo = lo - chamfer(_ox(lb, n, ytl, "left"), ytl, p.ccut, "nw")
    # The stem stops where the shoulder's counter leaves it, so the bowl
    # opens to the left with no tooth; its free foot gets the sw chamfer.
    ysb = join_in - 2
    stem = rect(xs, ysb, xl, P.CAP, sw=p.ccut)
    bar = rect(xs, P.CAP - h, w - p.w(28, 0.2), P.CAP)
    return shoulder + lo + stem + bar


def _six(p):
    n, ni = _n(p), _ni(p)
    ws = p.fstem * 1.03
    h = _fh(p)
    w = p.w(472, 1.2)
    yt = P.CAP * 0.65
    box = (0, -P.COS, w, yt)
    ibox = (ws, -P.COS + h, w - ws, yt - h)
    cx, cy = w / 2, (box[1] + box[3]) / 2
    # Straight tail. Its direction is that of the tangent from the tail's top
    # to the bowl; the outer edge sits a little outside that tangent and a
    # curve blends it into the bowl's left side, so bowl and tail read as
    # one stroke.
    t = p.fstem * 1.0
    a_l0 = (w * 0.555, P.CAP)
    tp = _tangent(a_l0, box, n, "left")
    dx, dy = a_l0[0] - tp[0], a_l0[1] - tp[1]
    m = math.hypot(dx, dy)
    d = (dx / m, dy / m)
    nrm = (-d[1], d[0])  # left of the tail, away from the bowl
    off = w * 0.045
    a_l = (a_l0[0] + nrm[0] * off - d[0] * (nrm[1] * off) / d[1], P.CAP)
    hw = t / d[1]
    a_r = (a_l[0] + hw, P.CAP)
    # Blend: from the bowl's left extreme up into the tail's outer edge.
    x_at = lambda y: a_l[0] - (P.CAP - y) * d[0] / d[1]
    ym = tp[1] + (P.CAP - tp[1]) * 0.22
    mo = (x_at(ym), ym)
    o1, o2 = _handles((0.0, cy), (0.0, 1.0), mo, d, 0.62, 0.5)
    r = (x_at(cy) + hw, cy)
    e = 2.0
    tail = _path((0.0, cy - e), [(0.0, cy), (o1, o2, mo), a_l, a_r, r, (cx, cy - e)])
    shape = (squircle(*box, n=n) + tail) - squircle(*ibox, n=ni)
    crotch = _line_cross_sq(a_r, (-d[0], -d[1]), box, n)
    if crotch is not None:
        x2 = crotch[0] + 2
        a_curve = math.degrees(math.atan2(_oy(box, n, x2) - crotch[1], 2))
        shape = shape - _crotch(crotch[0], crotch[1], math.degrees(math.atan2(d[1], d[0])), a_curve, p.trap)
    return shape


def _nine(p):
    six = _six(p)
    b = six.bounds()
    return six.rotate180((b[0] + b[2]) / 2, P.CAP / 2)


def _seven(p):
    w = p.w(456, 1.0)
    h = _fh(p)
    t = p.fstem * 0.95
    xb = w * 0.30
    xt = w
    for _ in range(6):
        hw = t * math.hypot(xt - xb, P.CAP) / P.CAP / 2
        xt = w - hw
    bar = rect(0, P.CAP - h, w, P.CAP)
    return bar + diag(xb, 0, xt, P.CAP, t)


def _eight(p):
    n, ni = _n(p), _ni(p)
    ws = p.fstem * 1.0
    h = _fh(p)
    wl = p.w(480, 1.2)
    wu = p.w(436, 1.05)
    ym = P.CAP * 0.56
    hm = h * 0.94
    lb = (0, -P.COS, wl, ym + hm / 2)
    li = (ws * 1.03, lb[1] + h, wl - ws * 1.03, lb[3] - hm)
    xu0 = (wl - wu) / 2
    ub = (xu0, ym - hm / 2, xu0 + wu, P.CAP + P.COS)
    ui = (xu0 + ws * 0.97, ub[1] + hm, ub[2] - ws * 0.97, ub[3] - h)
    return (squircle(*lb, n=n) + squircle(*ub, n=n)) - squircle(*li, n=ni) - squircle(*ui, n=ni)


FIGS = {
    "zero": _zero,
    "one": _one,
    "two": _two,
    "three": _three,
    "four": _four,
    "five": _five,
    "six": _six,
    "seven": _seven,
    "eight": _eight,
    "nine": _nine,
}

# Optical nudges inside the tabular advance (units at Regular).
NUDGE = {"one": 28, "four": -6, "seven": 6}


@glyph("zero", 0x0030)
def zero(p):
    return _fit(p, _zero(p))


@glyph("zero.zero")
def zero_zero(p):
    return _fit(p, _zero(p) + _zero_slash(p))


@glyph("one", 0x0031)
def one(p):
    return _fit(p, _one(p), NUDGE["one"])


@glyph("two", 0x0032)
def two(p):
    return _fit(p, _two(p))


@glyph("three", 0x0033)
def three(p):
    return _fit(p, _three(p))


@glyph("four", 0x0034)
def four(p):
    return _fit(p, _four(p), NUDGE["four"])


@glyph("five", 0x0035)
def five(p):
    return _fit(p, _five(p))


@glyph("six", 0x0036)
def six(p):
    return _fit(p, _six(p))


@glyph("seven", 0x0037)
def seven(p):
    return _fit(p, _seven(p), NUDGE["seven"])


@glyph("eight", 0x0038)
def eight(p):
    return _fit(p, _eight(p))


@glyph("nine", 0x0039)
def nine(p):
    return _fit(p, _nine(p))


# ---------------------------------------------------------------------------
# Superiors and fractions. Small figures are the full figures drawn at a
# heavier weight and scaled, so their strokes keep the colour of the text.

SUP = 0.6  # superior / inferior scale


def _sup_params(p):
    return P.params(min(800, p.wght + 150))


def _small(p, name, where="sup"):
    """A figure scaled to superior size: its top on the cap height ("sup")
    or its foot on the baseline ("inf")."""
    sh = FIGS[name](_sup_params(p)).scale(SUP)
    return sh.move(0, P.CAP * (1 - SUP)) if where == "sup" else sh


def _slash_t(p):
    """Thickness of the fraction slash: the superior figures' stem."""
    return _sup_params(p).fstem * SUP * 0.95


SLASH_ANGLE = 60


def _slash(p, x_mid, y0=0.0, y1=P.CAP, t=None):
    t = _slash_t(p) if t is None else t
    run = (y1 - y0) / math.tan(math.radians(SLASH_ANGLE))
    return diag(x_mid - run / 2, y0, x_mid + run / 2, y1, t)


def _over(p, num, den, gap=None, t=None, y0=0.0, y1=P.CAP):
    """Set `num` (high) and `den` (low) either side of a fraction slash
    running from y0 to y1, each clear of the slash by `gap`. Returns the
    combined outline with its left edge at 0."""
    t = _slash_t(p) if t is None else t
    gap = p.w(34, 0.1) if gap is None else gap
    run = (y1 - y0) / math.tan(math.radians(SLASH_ANGLE))
    hw = t / (2 * math.sin(math.radians(SLASH_ANGLE)))

    def xc(y):  # slash centre at height y, slash centred on x = 0
        return -run / 2 + run * (y - y0) / (y1 - y0)

    nb, db = num.bounds(), den.bounds()
    num = num.move(xc(nb[1]) - hw - gap - nb[2], 0)
    den = den.move(xc(db[3]) + hw + gap - db[0], 0)
    shape = num + den + _slash(p, 0.0, y0, y1, t)
    b = shape.bounds()
    return shape.move(-b[0], 0)


def _sup_glyph(p, name):
    return _fit(p, _small(p, name), width=round(p.w(400, 0.6)))


@glyph("onesuperior", 0x00B9)
def onesuperior(p):
    g = _sup_glyph(p, "one")
    return G(g.shape.move(NUDGE["one"] * SUP, 0), width=g.width)


@glyph("twosuperior", 0x00B2)
def twosuperior(p):
    return _sup_glyph(p, "two")


@glyph("threesuperior", 0x00B3)
def threesuperior(p):
    return _sup_glyph(p, "three")


def _vulgar(p, a, b):
    return _fit(p, _over(p, _small(p, a), _small(p, b, "inf")), width=round(p.w(900, 1.5)))


@glyph("onequarter", 0x00BC)
def onequarter(p):
    return _vulgar(p, "one", "four")


@glyph("onehalf", 0x00BD)
def onehalf(p):
    return _vulgar(p, "one", "two")


@glyph("threequarters", 0x00BE)
def threequarters(p):
    return _vulgar(p, "three", "four")


@glyph("fraction", 0x2044)
def fraction(p):
    # Meant to sit between superior/inferior figures, so it tucks under
    # its neighbours a little.
    sh = _slash(p, 0.0)
    return G(sh, l=-p.w(36, 0.0), r=-p.w(36, 0.0))


# ---------------------------------------------------------------------------
# Percent and per mille: small squircle rings either side of a slash.


def _pct_ring(p):
    rw, rh = p.w(252, 0.6), P.CAP * 0.47
    ws, h = p.fstem * (0.84 - 0.18 * max(0.0, p.grow) / 70), _fh(p) * (0.8 - 0.14 * max(0.0, p.grow) / 70)
    os_ = P.COS * 0.7
    sh = ring(0, -os_, rw, rh + os_, ws, h, n=_n(p), n_in=_ni(p))
    return sh


def _pct_rings(p, k):
    r = _pct_ring(p)
    if k == 1:
        return r
    rw = r.bounds()[2] - r.bounds()[0]
    return r + r.move(rw + p.w(40, 0.2), 0)


@glyph("percent", 0x0025)
def percent(p):
    num = _pct_rings(p, 1).move(0, P.CAP * 0.5)
    den = _pct_rings(p, 1)
    sh = _over(p, num, den, gap=p.w(30, 0.1), t=p.fstem * 0.8)
    return G(sh, l=p.csbr * 0.75, r=p.csbr * 0.75)


@glyph("perthousand", 0x2030)
def perthousand(p):
    num = _pct_rings(p, 1).move(0, P.CAP * 0.5)
    den = _pct_rings(p, 2)
    sh = _over(p, num, den, gap=p.w(30, 0.1), t=p.fstem * 0.8)
    return G(sh, l=p.csbr * 0.75, r=p.csbr * 0.75)


# ---------------------------------------------------------------------------
# Number sign


@glyph("numbersign", 0x0023)
def numbersign(p):
    w = _fw(p)
    t = _fh(p) * 1.0
    lean = math.radians(9)
    y0, y1 = 0.0, P.CAP * 0.96
    run = (y1 - y0) * math.tan(lean)
    span = p.w(206, 0.35)  # distance between the two verticals' centres
    cx = w / 2
    sh = Shape()
    for xm in (cx - span / 2, cx + span / 2):
        sh = sh + diag(xm - run / 2, y0, xm + run / 2, y1, p.fstem * 0.9)
    bar_l, bar_r = cx - p.w(230, 0.5), cx + p.w(230, 0.5)
    ym = (y0 + y1) / 2
    gapc = p.w(116, 0.3)  # half the distance between the bars' centres
    for yb in (ym - gapc, ym + gapc):
        sh = sh + rect(bar_l, yb - t / 2, bar_r, yb + t / 2)
    return _fit(p, sh)


# ---------------------------------------------------------------------------
# Currency


def _s_shape(p, w, y0, y1, ws, wt, wb, cut_t, cut_b):
    """S-like double curve (for the dollar): two squircle bowls joined by a
    straight spine; same construction as the capital S, sized for figures."""
    n, ni = _n(p), _ni(p)
    h = y1 - y0
    xul, xur = w * 0.04, w * 0.98
    xll, xlr = 0.0, w
    ycu = y0 + h * 0.735
    ycl = y0 + h * 0.27
    ub = (xul, 2 * ycu - y1, xur, y1)
    ui = (xul + ws, ub[1] + wt, xur - ws, y1 - wt)
    lb = (xll, y0, xlr, 2 * ycl - y0)
    li = (xll + ws, y0 + wb, xlr - ws, lb[3] - wb)
    cxu, cxl = (xul + xur) / 2, (xll + xlr) / 2
    ct = y0 + h * cut_t
    cb = y0 + h * cut_b
    up = squircle(*ub, n=n) - squircle(*ui, n=ni)
    up = up & (above(ycu - 1) + (right_of(cxu) & above(ct)))
    up = up - (right_of(cxu) & below(ct))
    up = up - chamfer(_ox(ub, n, ct, "right"), ct, p.ccut, "se")
    lo = squircle(*lb, n=n) - squircle(*li, n=ni)
    lo = lo & (below(ycl + 1) + (left_of(cxl) & below(cb)))
    lo = lo - (left_of(cxl) & above(cb))
    lo = lo - chamfer(_ox(lb, n, cb, "left"), cb, p.ccut, "nw")
    th = math.radians(17)
    t = (wt + wb) / 2 * 1.04
    seg = w * 0.16
    xc = w * 0.505
    yc = y0 + h * 0.505
    d = (math.cos(th), -math.sin(th))
    nrm = (math.sin(th), math.cos(th))
    mb = (xc - nrm[0] * t / 2, yc - nrm[1] * t / 2)
    mt = (xc + nrm[0] * t / 2, yc + nrm[1] * t / 2)
    mb0, mb1 = (mb[0] - d[0] * seg / 2, mb[1] - d[1] * seg / 2), (mb[0] + d[0] * seg / 2, mb[1] + d[1] * seg / 2)
    mt0, mt1 = (mt[0] - d[0] * seg / 2, mt[1] - d[1] * seg / 2), (mt[0] + d[0] * seg / 2, mt[1] + d[1] * seg / 2)
    down = (0.0, -1.0)
    b0, b3 = (xul, ycu), (xlr - ws, ycl)
    t0, t3 = (xul + ws, ycu), (xlr, ycl)
    b1a, b2a = _handles(b0, down, mb0, d, 0.72, 0.62)  # outer left
    b1b, b2b = _handles(mb1, d, b3, down, 0.62, 0.8)  # lower counter
    t1a, t2a = _handles(t0, down, mt0, d, 0.8, 0.62)  # upper counter
    t1b, t2b = _handles(mt1, d, t3, down, 0.62, 0.72)  # outer right
    e = 2.0
    spine = _path(
        (xul, ycu + e),
        [
            (xul + ws, ycu + e),
            t0,
            (t1a, t2a, mt0),
            mt1,
            (t1b, t2b, t3),
            (xlr, ycl - e),
            (xlr - ws, ycl - e),
            b3,
            (b2b, b1b, mb1),
            mb0,
            (b2a, b1a, b0),
        ],
    )
    return up + spine + lo


@glyph("dollar", 0x0024)
def dollar(p):
    w = p.w(452, 1.0)
    ws = p.fstem * 0.98
    h = _fh(p) * 0.98
    s_ = _s_shape(p, w, -P.COS, P.CAP + P.COS, ws, h, h * 1.02, 0.745, 0.262)
    bt = p.fstem * 0.82
    cx = w * 0.505
    ext = p.w(92, 0.2)
    bar = rect(cx - bt / 2, P.CAP - h, cx + bt / 2, P.CAP + ext) + rect(cx - bt / 2, -ext, cx + bt / 2, h)
    return _fit(p, s_ + bar)


@glyph("cent", 0x00A2)
def cent(p):
    n, ni = _n(p), _ni(p)
    w = p.w(408, 0.9)
    ws = p.fstem * 1.02
    h = _fh(p)
    top = P.CAP * 0.8
    box = (0, -P.COS, w, top + P.COS)
    from .parts import open_bowl

    c_ = open_bowl(p, box[0], box[2], box[1], box[3], ws, h, h, cut_top=box[1] + (box[3] - box[1]) * 0.69,
                   cut_bottom=box[1] + (box[3] - box[1]) * 0.31, n=n, n_in=ni, chamfer_leg=p.ccut)
    bt = p.fstem * 0.82
    cx = w * 0.53
    ext = p.w(96, 0.2)
    bar = rect(cx - bt / 2, top - h, cx + bt / 2, top + P.COS + ext) + rect(cx - bt / 2, -P.COS - ext, cx + bt / 2, h - P.COS)
    return _fit(p, c_ + bar, dx=-p.w(10, 0.0))


@glyph("sterling", 0x00A3)
def sterling(p):
    n, ni = _n(p), _ni(p)
    s = p.fstem
    h = _fh(p)
    w = p.w(470, 1.0)
    xs = p.w(78, 0.3)  # stem left edge
    hook_r = w - p.w(6, 0.0)
    ytop = P.CAP + P.COS
    hb = P.CAP * 0.56  # hook box bottom
    box = (xs, hb, hook_r, ytop)
    ibox = (xs + s, hb + h, hook_r - s * 0.98, ytop - h)
    cy = (hb + ytop) / 2
    cxh = (xs + hook_r) / 2
    yt = cy - (ytop - cy) * 0.12  # terminal just below the bowl's widest point
    hook = (squircle(*box, n=n) - squircle(*ibox, n=ni)) & above(min(cy, yt) - 1)
    hook = hook - (right_of(cxh) & below(yt))
    hook = hook - chamfer(_ox(box, n, yt, "right"), yt, p.ccut, "se")
    hook = hook & (above(cy - 1) + right_of(cxh))
    stem = rect(xs, h - 1, xs + s, cy + 1)
    base = rect(0, 0, w, h)
    bar_y = P.CAP * 0.42
    bar = rect(xs - p.w(70, 0.1), bar_y - h * 0.9 / 2, xs + s + p.w(150, 0.3), bar_y + h * 0.9 / 2)
    return _fit(p, hook + stem + base + bar)


@glyph("yen", 0x00A5)
def yen(p):
    w = p.w(520, 1.1)
    s = p.fstem
    t = p.fstem * 0.92
    h = _fh(p) * 0.92
    cx = w / 2
    yj = P.CAP * 0.44  # where the arms meet the stem
    hw_top = t / 2 / math.cos(math.atan2(cx, P.CAP - yj))  # half-width of the arms' horizontal cut
    arm_l = diag(cx, yj - 60, hw_top, P.CAP, t) & above(yj - 60)
    arm_r = diag(cx, yj - 60, w - hw_top, P.CAP, t) & above(yj - 60)
    stem = rect(cx - s / 2, 0, cx + s / 2, yj)
    sh = arm_l + arm_r + stem
    # Crotch between the arms.
    dxa = cx - hw_top
    k = (P.CAP - (yj - 60)) / dxa
    y_cr = (yj - 60) + k * (hw_top * 0 + (t / 2) / math.sin(math.atan(k)))
    ang = math.degrees(math.atan(k))
    sh = sh - _crotch(cx, y_cr, ang, 180 - ang, p.trap)
    bl, br = cx - p.w(196, 0.4), cx + p.w(196, 0.4)
    h = h * 0.88
    ym = P.CAP * 0.275
    off = h / 2 + p.w(34, 0.25)
    for yb in (ym + off, ym - off):
        sh = sh + rect(bl, yb - h / 2, br, yb + h / 2)
    return _fit(p, sh)


@glyph("Euro", 0x20AC)
def Euro(p):
    from .parts import open_bowl

    n, ni = _n(p), _ni(p)
    w = p.w(462, 1.0)
    ws = p.fstem * 1.02
    h = _fh(p)
    c_ = open_bowl(p, 0, w, -P.COS, P.CAP + P.COS, ws, h, h, cut_top=P.CAP * 0.69, cut_bottom=P.CAP * 0.31,
                   n=n, n_in=ni, chamfer_leg=p.ccut)
    c_ = c_.move(p.w(64, 0.2), 0)
    bt = h * 0.8
    off = bt / 2 + p.w(34, 0.25)
    sh = c_
    for yb in (P.CAP / 2 + off, P.CAP / 2 - off):
        sh = sh + rect(0, yb - bt / 2, p.w(330, 0.6), yb + bt / 2)
    return _fit(p, sh)


@glyph("currency", 0x00A4)
def currency(p):
    n, ni = _n(p), _ni(p)
    r = p.w(316, 1.1)
    t = _fh(p) * 0.86
    cx, cy = 0.0, P.AXIS
    sh = ring(cx - r / 2, cy - r / 2, cx + r / 2, cy + r / 2, t * 1.06, t, n=n, n_in=ni)
    spoke = p.w(84, 0.3)
    v = (r / 2) * 2 ** (-1 / n)  # the squircle's 45-degree point
    c45 = math.sqrt(0.5)
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = (cx + sx * (v - t * 0.4 * c45), cy + sy * (v - t * 0.4 * c45))
            b = (cx + sx * (v + spoke * c45), cy + sy * (v + spoke * c45))
            sh = sh + stroke(a, b, t)
    return _fit(p, sh)


@glyph("florin", 0x0192)
def florin(p):
    n, ni = _n(p), _ni(p)
    s = p.fstem * 0.96
    h = _fh(p) * 0.95
    top, bot = P.CAP + P.COS, -170 - P.COS
    hw = p.w(150, 0.8)  # half the hook box width
    xs = 0.0
    # Upper hook: the stem turns right over the top and ends cut vertically.
    ub = (xs, top - p.w(196, 0.6), xs + hw * 2, top)
    ui = (xs + s, ub[1] + h, ub[2] - s, top - h)
    ucx, ucy = (ub[0] + ub[2]) / 2, (ub[1] + ub[3]) / 2
    xt = ucx + 0.62 * (ui[2] - ucx)
    upper = (squircle(*ub, n=n) - squircle(*ui, n=ni)) & above(ucy) & left_of(xt)
    upper = upper - chamfer(xt, _oy(ub, n, xt), p.ccut, "ne")
    # Lower hook: the same turned half a turn.
    lower = upper.rotate180(xs + s / 2, (top + bot) / 2)
    lcy = top + bot - ucy
    stem = rect(xs, lcy - 1, xs + s, ucy + 1)
    bar_y = P.XH - h / 2
    bar = rect(xs - p.w(118, 0.3), bar_y - h / 2, xs + s + p.w(118, 0.3), bar_y + h / 2)
    sh = (upper + lower + stem + bar).skew(11, cy=(top + bot) / 2)
    return _fit(p, sh)


# ---------------------------------------------------------------------------
# Math operators: one advance with the figures, centred on P.AXIS.


def _mt(p):
    """Math stroke: the hyphen's thickness."""
    return p.hair * 1.05


def _arm(p):
    """Half-length of the plus and minus arms."""
    return p.w(212, 0.4)


def _plus(p, cx, cy, a=None):
    a = _arm(p) if a is None else a
    t = _mt(p)
    return rect(cx - a, cy - t / 2, cx + a, cy + t / 2) + rect(cx - t / 2, cy - a, cx + t / 2, cy + a)


def _minus(p, cx, cy, a=None):
    a = _arm(p) if a is None else a
    t = _mt(p)
    return rect(cx - a, cy - t / 2, cx + a, cy + t / 2)


def _equal_off(p):
    return _mt(p) / 2 + p.w(56, 0.18)


def _chevron(p, cx, cy, half_w, half_h, t=None):
    """< pointing left: two arms of thickness t meet at a tip near
    (cx - half_w, cy); the open ends at x = cx + half_w are cut vertically
    and the sharp outer point is cut flat (a vertical face)."""
    t = _mt(p) if t is None else t
    xt, xe = cx - half_w, cx + half_w
    al = math.atan2(half_h, 2 * half_w)
    ta = math.tan(al)
    xo = xt - (t / 2) / math.sin(al)  # where the outer edges meet
    xi = xt + (t / 2) / math.sin(al)  # inner vertex
    f = t * 0.3 / ta  # the flat face is 0.6 t tall
    return poly([
        (xo + f, cy + f * ta),
        (xe, cy + (xe - xo) * ta),
        (xe, cy + (xe - xi) * ta),
        (xi, cy),
        (xe, cy - (xe - xi) * ta),
        (xe, cy - (xe - xo) * ta),
        (xo + f, cy - f * ta),
    ])


def _wave(p, cx, cy, half_w, amp, t=None):
    """Tilde: crest on the left, trough on the right, drawn as one outline
    with squircle-like handles. The ends leave the crest and trough at a
    steep angle and are cut horizontally, with the house chamfer on their
    outer corner."""
    t = _mt(p) if t is None else t
    wy = t * 0.84  # thickness at crest and trough
    we = t * 0.94  # across the ends
    wm = t * 0.98  # across the middle
    x0, x1 = cx - half_w, cx - half_w * 0.44
    x3, x2 = cx + half_w, cx + half_w * 0.44
    e0 = amp * 0.3  # the ends stop a little past the centre line
    ae = math.radians(62)
    de = (math.cos(ae), math.sin(ae))  # end direction, towards the crest
    he = we / (2 * math.sin(ae))
    phi = math.atan2(2.0 * amp, half_w * 0.88)
    dm = (math.cos(phi), -math.sin(phi))
    nm = (math.sin(phi), math.cos(phi))
    k = 0.64
    rt, lf = (1.0, 0.0), (-1.0, 0.0)
    mde = (-de[0], -de[1])
    o0 = (x0 - he, cy - e0)
    o1 = (x1, cy + amp + wy / 2)
    o2 = (cx + nm[0] * wm / 2, cy + nm[1] * wm / 2)
    o3 = (x2, cy - amp + wy / 2)
    o4 = (x3 - he, cy + e0)
    i4 = (x3 + he, cy + e0)
    i3 = (x2, cy - amp - wy / 2)
    i2 = (cx - nm[0] * wm / 2, cy - nm[1] * wm / 2)
    i1 = (x1, cy + amp - wy / 2)
    i0 = (x0 + he, cy - e0)
    mdm = (-dm[0], -dm[1])
    segs = []
    for a, ta, b, tb in ((o0, de, o1, rt), (o1, rt, o2, dm), (o2, dm, o3, rt), (o3, rt, o4, de)):
        h1, h2 = _handles(a, ta, b, tb, k, k)
        segs.append((h1, h2, b))
    segs.append(i4)
    for a, ta, b, tb in ((i4, mde, i3, lf), (i3, lf, i2, mdm), (i2, mdm, i1, lf), (i1, lf, i0, mde)):
        h1, h2 = _handles(a, ta, b, tb, k, k)
        segs.append((h1, h2, b))
    sh = _path(o0, segs)
    c = p.cut * 0.8
    return sh - chamfer(o0[0], o0[1], c, "sw") - chamfer(i4[0], i4[1], c, "ne")


def _math(p, sh):
    return G(sh, width=_fw(p))


def _cx(p):
    return _fw(p) / 2


@glyph("plus", 0x002B)
def plus(p):
    return _math(p, _plus(p, _cx(p), P.AXIS))


@glyph("minus", 0x2212)
def minus(p):
    return _math(p, _minus(p, _cx(p), P.AXIS))


@glyph("multiply", 0x00D7)
def multiply(p):
    a = _arm(p) * 0.74
    t = _mt(p)
    cx, cy = _cx(p), P.AXIS
    sh = stroke((cx - a, cy - a), (cx + a, cy + a), t) + stroke((cx - a, cy + a), (cx + a, cy - a), t)
    return _math(p, sh)


@glyph("divide", 0x00F7)
def divide(p):
    cx, cy = _cx(p), P.AXIS
    ds = p.dot * 0.95
    off = _arm(p) * 0.66
    sh = _minus(p, cx, cy) + dot(cx, cy + off, ds) + dot(cx, cy - off, ds)
    return _math(p, sh)


@glyph("equal", 0x003D)
def equal(p):
    cx, cy = _cx(p), P.AXIS
    off = _equal_off(p)
    return _math(p, _minus(p, cx, cy + off) + _minus(p, cx, cy - off))


@glyph("plusminus", 0x00B1)
def plusminus(p):
    cx = _cx(p)
    t = _mt(p)
    a = _arm(p) * 0.92
    gap = p.w(62, 0.2)
    y_bar = t / 2
    yc = t + gap + a
    return _math(p, _plus(p, cx, yc, a) + _minus(p, cx, y_bar, _arm(p)))


def _lt(p, cy=P.AXIS, scale=1.0):
    hw = _arm(p) * 0.92 * scale
    hh = _arm(p) * 0.86 * scale
    return _chevron(p, _cx(p), cy, hw, hh)


@glyph("less", 0x003C)
def less(p):
    return _math(p, _lt(p))


@glyph("greater", 0x003E)
def greater(p):
    return _math(p, _lt(p).flip_x(_cx(p)))


def _lte(p):
    t = _mt(p)
    gap = p.w(70, 0.2)
    hh = _arm(p) * 0.78
    bar_y = t / 2
    cy = t + gap + hh + t * 0.45
    return _lt(p, cy, 0.92) + _minus(p, _cx(p), bar_y, _arm(p) * 0.92)


@glyph("lessequal", 0x2264)
def lessequal(p):
    return _math(p, _lte(p))


@glyph("greaterequal", 0x2265)
def greaterequal(p):
    return _math(p, _lte(p).flip_x(_cx(p)))


@glyph("notequal", 0x2260)
def notequal(p):
    cx, cy = _cx(p), P.AXIS
    off = _equal_off(p)
    L = off + p.w(150, 0.3)
    run = 2 * L / math.tan(math.radians(62))
    sh = _minus(p, cx, cy + off) + _minus(p, cx, cy - off) + diag(cx - run / 2, cy - L, cx + run / 2, cy + L, _mt(p))
    return _math(p, sh)


def _tilde(p, cy, scale=1.0):
    return _wave(p, _cx(p), cy, p.w(216, 0.9) * scale, p.w(58, 0.3) * scale)


@glyph("asciitilde", 0x007E)
def asciitilde(p):
    return _math(p, _tilde(p, P.AXIS))


@glyph("approxequal", 0x2248)
def approxequal(p):
    off = p.w(96, 0.45)
    return _math(p, _tilde(p, P.AXIS + off, 0.9) + _tilde(p, P.AXIS - off, 0.9))


@glyph("logicalnot", 0x00AC)
def logicalnot(p):
    cx = _cx(p)
    a = _arm(p)
    t = _mt(p)
    y = P.AXIS + p.w(40, 0.2)
    drop = p.w(150, 0.3)
    sh = rect(cx - a, y - t / 2, cx + a, y + t / 2) + rect(cx + a - t * 1.04, y - drop, cx + a, y, se=p.cut)
    return _math(p, sh)


@glyph("asciicircum", 0x005E)
def asciicircum(p):
    w = _fw(p)
    hw = p.w(196, 0.4)
    depth = P.CAP * 0.42
    sh = _chevron(p, 0.0, 0.0, depth / 2, hw, t=_mt(p))
    # Rotate the chevron so it points up, tip on the cap height.
    sh = sh.rotate(-90, 0.0, 0.0)
    b = sh.bounds()
    sh = sh.move(w / 2 - (b[0] + b[2]) / 2, P.CAP - b[3])
    return G(sh, width=w)


# ---------------------------------------------------------------------------
# Degree, mu, ordinals, infinity


@glyph("degree", 0x00B0)
def degree(p):
    n, ni = _n(p), _ni(p)
    d = p.w(268, 0.5)
    ws = p.fstem * 0.74
    h = _fh(p) * 0.68
    top = P.CAP + P.COS * 0.6
    sh = ring(0, top - d, d * 0.94, top, ws, h, n=n, n_in=ni)
    return G(sh, l=p.csbr * 0.9, r=p.csbr * 0.9)


@glyph("mu", 0x00B5)
def mu(p):
    from .parts import n_shape

    s = p.stem
    sh, xr = n_shape(p, 0, p.w(300, -1.0), cut=False)
    sh = sh.rotate180(xr / 2, P.XH / 2)
    sh = sh + rect(0, P.DESC, s, P.XH, nw=p.cut, sw=p.cut)
    sh = sh - chamfer(xr, P.XH, p.cut, "ne")
    return G(sh, l=p.sb, r=p.sb * 0.92)


def _small_a(q):
    """A compact double-storey a (lowercase proportions) for the ordinal."""
    n, ni = q.sq, q.sq_in
    s = q.stem
    h = q.hair
    w = q.w(452, 0.9)
    xh = P.XH
    # Stem on the right, from the baseline to where the hook turns.
    ytop = xh + P.OS
    hb = xh * 0.36
    box = (0, hb, w, ytop)
    ibox = (s * 0.98, hb + h, w - s, ytop - h)
    cy = (hb + ytop) / 2
    yt = cy + (ytop - cy) * 0.36
    hook = (squircle(*box, n=n) - squircle(*ibox, n=ni)) & above(cy - 1)
    hook = hook - (left_of(w / 2) & below(yt))
    hook = hook - chamfer(_ox(box, n, yt, "left"), yt, q.cut, "sw")
    stem = rect(w - s, 0, w, cy + 1)
    bt = xh * 0.56  # bowl top
    bb = (0, -P.OS, w - s * 0.4, bt)
    bi = (s * 1.02, -P.OS + h, w - s, bt - h * 0.95)
    bowl = squircle(*bb, n=n) - squircle(*bi, n=ni)
    sh = hook + stem + (bowl & left_of(w - s * 0.5))
    return sh, w


@glyph("ordfeminine", 0x00AA)
def ordfeminine(p):
    q = _sup_params(p)
    a_, w = _small_a(q)
    sc = 0.62
    a_ = a_.scale(sc).move(0, P.CAP - P.XH * sc)
    t = _fh(p) * 0.7
    yb = P.CAP - P.XH * sc - p.w(70, 0.25)
    bar = rect(0, yb - t, w * sc, yb)
    return G(a_ + bar, l=p.sbr, r=p.sbr)


@glyph("ordmasculine", 0x00BA)
def ordmasculine(p):
    q = _sup_params(p)
    sc = 0.62
    w = q.w(486, 1.0)
    o_ = ring(0, -P.OS, w, P.XH + P.OS, q.stem * 1.04, q.hair, n=q.sq, n_in=q.sq_in)
    o_ = o_.scale(sc).move(0, P.CAP - P.XH * sc)
    t = _fh(p) * 0.7
    yb = P.CAP - P.XH * sc - p.w(70, 0.25)
    bar = rect(0, yb - t, w * sc, yb)
    return G(o_ + bar, l=p.sbr, r=p.sbr)


@glyph("infinity", 0x221E)
def infinity(p):
    n, ni = _n(p), _ni(p)
    t = _mt(p)
    ws = t * 1.0
    h = t * 0.92
    lw = p.w(330, 0.6)
    hh = p.w(150, 0.3)
    cy = P.AXIS
    a = (0, cy - hh, lw, cy + hh)
    b = (lw - ws, cy - hh, 2 * lw - ws, cy + hh)
    ai = (a[0] + ws, a[1] + h, a[2] - ws, a[3] - h)
    bi = (b[0] + ws, b[1] + h, b[2] - ws, b[3] - h)
    sh = (squircle(*a, n=n) + squircle(*b, n=n)) - squircle(*ai, n=ni) - squircle(*bi, n=ni)
    return G(sh, l=p.csbr * 0.8, r=p.csbr * 0.8)
