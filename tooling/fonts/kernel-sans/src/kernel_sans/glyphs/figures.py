"""Figures and the symbols set with them: lining tabular 0-9 (plus a slashed
zero), superiors and vulgar fractions, percent and per-mille, currency signs,
math operators, degree, mu and the ordinals.

Figures sit on the cap height (720) with the capital overshoot `P.COS`, use
`p.fstem` / `p.fhair` and the capital squircle exponents. The tabular `.tf`
forms share one advance (`_fw`): each is drawn from x = 0 and centred in it
by `_fit`. The default figures are those outlines respaced with their own
sidebearings (`PROP_SB`); only the 1 differs, as the tabular one has a base.
6 and 9 have straight tails (DIN-like) blended into the bowl. Widths follow
DESIGN.md's rule and grow slowly with weight: k = 0.6 for the rounds 0 6 8 9,
about 0.7 for the other figures, and 0.5 for the tabular advance, so heavy
figures gain colour rather than width and tighten slightly in their cells.
Math operators share the tabular advance and centre on `P.AXIS`;
their `.case` forms sit on `P.CASE_AXIS`. Superiors, fraction parts and the
ordinals are the full shapes drawn 150 weight units heavier and scaled by
`SUP`.

Ink traps follow DESIGN.md: where a straight stroke leaves a stem (the flag of
1, the diagonal of 4 at its stem) `geom.stem_trap` runs along the stem edge,
like n; the vertices between two strokes (2, the 4's bar join, 6, 9 and the
yen) take the flat-floored `geom.crotch_trap` at depth `p.trap`.
"""

import math

import pathops

from .. import params as P
from ..geom import (
    Shape,
    above,
    below,
    chamfer,
    crotch_trap,
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
)
from . import G, glyph, ref
from .parts import arch, outer_x

PROOF_TEXT = [
    "H0H1H2H3H4H5H6H7H8H9H",
    "0123456789 1234567890 n0n1n2n3n4n5n6n7n8n9n",
    "$1,250.00 ±3% 98.6° €42 £7 ¥300 99¢ ¤ ƒ(x)",
    "2+2=4 5×3≠14 ½ ¼ ¾ 7÷2 1⁄2 x² m³ ¹",
    "a<b>c x≤y≥z π≈3 ~n^2 ¬p #1 50% 3‰ ∞ 5µm 1ª 2º",
    "HOH 1984 2025 0815 H#H H$H H£H n%n n°n H€H",
]


# ---------------------------------------------------------------------------
# Shared helpers


def _n(p):
    return p.sq * 0.92


def _ni(p):
    return p.sq_in * 0.95


def _fh(p):
    """Figure horizontal stroke: thins with weight like the capital hairline
    (0.78 of the stem at ExtraBold), so counters stay open."""
    return p.fhair * (1.0 - 0.12 * max(0.0, p.grow) / 70)


def _fw(p):
    """The shared tabular advance (grows more slowly than the figures, so
    their sidebearings shrink a little with weight, as in Inter)."""
    return round(p.w(600, 0.5))


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
    return (x0 + k0 * a * t0[0], y0 + k0 * a * t0[1]), (
        x3 + k3 * b * t3[0],
        y3 + k3 * b * t3[1],
    )


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
            pts.append(
                (
                    w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0],
                    w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1],
                )
            )
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


def _ray_hit_sq(p0, d, box, n):
    """Where the ray p0 + t*d (t > 0) first crosses the squircle exactly as
    drawn (its cubic outline), and the outline's direction there (degrees,
    taken left to right)."""
    pts = _sq_pts(box, n, per=400)
    best = None
    m = len(pts)
    for i in range(m):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % m]
        ex, ey = bx - ax, by - ay
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        t = ((ax - p0[0]) * ey - (ay - p0[1]) * ex) / den
        u = ((ax - p0[0]) * d[1] - (ay - p0[1]) * d[0]) / den
        if t > 0 and 0 <= u <= 1 and (best is None or t < best[0]):
            if ex < 0:
                ex, ey = -ex, -ey
            best = (
                t,
                (p0[0] + d[0] * t, p0[1] + d[1] * t),
                math.degrees(math.atan2(ey, ex)),
            )
    return (best[1], best[2]) if best else (None, None)


def _fit(p, shape, dx=0.0, width=None):
    """Centre the outline in the tabular advance (or `width`)."""
    w = _fw(p) if width is None else width
    b = shape.bounds()
    off = (w - (b[0] + b[2])) / 2 + dx
    return G(shape.move(off, 0), width=w)


# ---------------------------------------------------------------------------
# Figures. Each returns its outline drawn from about x = 0.


def _zero_box(p):
    w = p.w(468, 0.6)
    ws = p.fstem * 1.04
    h = _fh(p)
    return (0, -P.COS, w, P.CAP + P.COS), ws, h


def _zero(p):
    box, ws, h = _zero_box(p)
    x0, y0, x1, y1 = box
    return ring(x0, y0, x1, y1, ws, h, n=_n(p), n_in=_ni(p))


def _zero_slash(p):
    """Short slash floating in the zero's counter: flat ends (like every
    diagonal), length set so the ends clear the counter by a gap at every
    weight. The heavy zero's counter is narrow, so there the slash gets
    steeper and relatively thinner to keep its length."""
    box, ws, h = _zero_box(p)
    x0, y0, x1, y1 = box
    ibox = (x0 + ws, y0 + h, x1 - ws, y1 - h)
    ni = _ni(p)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    g = max(0.0, p.grow) / 70
    t = p.fhair * (0.8 - 0.3 * g)
    th = math.radians(68 + 8 * g)
    hw = t / (2 * math.sin(th))
    gap = 12 + 0.15 * t
    ry_in = (ibox[3] - ibox[1]) / 2

    def fits(L):
        a = L / math.tan(th)
        return cx + a + hw <= _ox(ibox, ni, cy + L, "right") - gap

    lo, hi = 0.0, ry_in * 0.42
    for _ in range(40):
        m = (lo + hi) / 2
        if fits(m):
            lo = m
        else:
            hi = m
    L = lo
    a = L / math.tan(th)
    return diag(cx - a, cy - L, cx + a, cy + L, t)


def _one(p, longer=0.0):
    """1 without a base: a stem and a flag at 35 degrees. `longer` extends
    the flag (the tabular form, which has more room)."""
    s = p.fstem
    t = _fh(p) * 1.04
    a = math.radians(35)
    reach = p.w(192, 0.45) + longer  # flag reach left of the stem, along its top
    d = (-math.cos(a), -math.sin(a))
    nrm = (math.sin(a), -math.cos(a))  # across the flag, towards the stem foot
    L = reach / math.cos(a)
    e_top = (d[0] * L, P.CAP + d[1] * L)
    e_bot = (e_top[0] + nrm[0] * t, e_top[1] + nrm[1] * t)
    i_top = (s, P.CAP + s * math.tan(a))
    i_bot = (i_top[0] + nrm[0] * t, i_top[1] + nrm[1] * t)
    flag = poly([e_top, i_top, i_bot, e_bot]) & below(P.CAP) & left_of(s * 0.5)
    # The flag covers the stem's top-left corner, so only the free top-right
    # corner takes the house chamfer.
    stem = rect(0, 0, s, P.CAP, ne=p.ccut)
    # Trap where the flag's lower edge leaves the stem: along the stem edge,
    # opening into the white below the flag (DESIGN.md, like n).
    crotch = P.CAP - t / math.cos(a)
    return stem + flag - stem_trap(0, crotch, p.trap, side="left")


def _one_tf(p):
    """Tabular 1: the flag 40 units longer (at Regular) and a base, so a column of figures
    keeps an even colour (its ink is about 0.78 of the mean tabular figure,
    like Inter's; the baseless 1 is under 0.65). An exception to DESIGN.md's
    "1 without a base" for the tabular form only; the default 1, the
    superiors and fractions keep the baseless form. The base is the free end
    of a bar, so its ends stay square, and its join with the stem is a right
    angle, so it takes no trap."""
    s = p.fstem
    base = rect(-p.w(150, -0.2), 0, s + p.w(130, -0.2), _fh(p))
    return _one(p, p.w(40, -0.3)) + base


def _two(p):
    n, ni = _n(p), _ni(p)
    w = p.w(452, 0.7)
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
    # The bowl and the spine meet edge to edge at the bowl's vertical
    # extreme (cy), so the union leaves no sliver segments there.
    up = (squircle(*box, n=n) - squircle(*ibox, n=ni)) & above(cy)
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
    spine = _path(
        (w, cy),
        [
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
    # One-sided crotch (the base runs on past it): half depth, as in 4.
    return shape - crotch_trap((crotch_x, hb), 0, d, p.trap * 0.5)


def _waist(p, k):
    """Centre and thickness of the waist of 3 and 8. The centre stays put at
    every weight and the waist thins a little faster than the other
    horizontals, so the upper counter keeps at least 0.8 of the lower one's
    height in ExtraBold (Inter keeps about 0.9)."""
    g = max(0.0, p.grow) / 70
    return P.CAP * 0.525, _fh(p) * (k - 0.06 * g)


def _three(p):
    n, ni = _n(p), _ni(p)
    ws = p.fstem * 1.0
    h = _fh(p)
    wl = p.w(462, 0.7)
    wu = p.w(420, 0.65)
    xr_u = wl - p.w(16, 0.1)
    xu0 = xr_u - wu
    ym, hm = _waist(p, 0.96)
    ub = (xu0, ym - hm / 2, xr_u, P.CAP + P.COS)
    ui = (xu0 + ws * 0.97, ub[1] + hm, xr_u - ws * 0.97, ub[3] - h)
    lb = (0, -P.COS, wl, ym + hm / 2)
    li = (ws * 1.02, lb[1] + h, wl - ws * 1.02, lb[3] - hm)
    cxu, cxl = (ub[0] + ub[2]) / 2, (lb[0] + lb[2]) / 2
    cyu, cyl = (ub[1] + ub[3]) / 2, (lb[1] + lb[3]) / 2
    ytu = cyu + 0.5 * (ui[3] - cyu)
    ytl = cyl - 0.5 * (cyl - li[1])
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
    w = p.w(506, 0.75)
    # The diagonal thins above Regular (0.78 of the stem at ExtraBold), or
    # the counter closes to a sliver.
    t = p.fstem * (0.9 - 0.12 * max(0.0, p.grow) / 80)
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
    dg = poly(
        [(0, yb), (ox0, oy0), (xs, P.CAP), (xs + hw, P.CAP), (hw - hb * dx / dy, yb)]
    )
    dg = dg & left_of(xs + s * 0.5)
    shape = stem + bar + dg
    # Where the diagonal's inner edge leaves the stem: a trap along the stem
    # edge, opening into the counter below (DESIGN.md, like n).
    yc = oy0 + (xs - hw) * dy / dx
    shape = shape - stem_trap(xs, yc, p.trap, side="left")
    # Crotch where the inner edge meets the bar. It is one-sided (the bar
    # runs on past it), so at full depth it reads as a slit along the bar;
    # half depth just blunts it.
    shape = shape - crotch_trap((hw, oy0), 0, (dx, dy), p.trap * 0.5)
    return shape


def _five(p):
    n, ni = _n(p), _ni(p)
    s = p.fstem
    ws = s * 1.02
    h = _fh(p)
    w = p.w(458, 0.7)
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
    # The shoulder is clipped at the stem edge (arch() reaches 1 unit into
    # it, where its counter has already dropped), and the foot stops a fixed
    # 3 units below where the drawn counter meets that edge, so the join has
    # the same corners at every weight.
    shoulder = shoulder & right_of(xl)
    y_in = (shoulder & left_of(xl + 0.5)).bounds()[1]
    ysb = y_in - 3
    stem = rect(xs, ysb, xl, P.CAP, sw=p.ccut)
    bar = rect(xs, P.CAP - h, w - p.w(28, 0.2), P.CAP)
    return shoulder + lo + stem + bar


def _six(p):
    n, ni = _n(p), _ni(p)
    ws = p.fstem * 1.03
    h = _fh(p)
    w = p.w(472, 0.6)
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
    def x_at(y):
        return a_l[0] - (P.CAP - y) * d[0] / d[1]

    ym = tp[1] + (P.CAP - tp[1]) * 0.3
    mo = (x_at(ym), ym)
    # The blend leaves the bowl's left extreme leaning out by a few degrees,
    # so it crosses the squircle cleanly instead of grazing it.
    lean = (-0.035, 1.0)
    o1, o2 = _handles((0.0, cy), lean, mo, d, 0.56, 0.72)
    r = (x_at(tp[1]) + hw, tp[1])  # inner edge, level with the tangent point
    tail = _path((0.0, cy), [(o1, o2, mo), a_l, a_r, r, (cx, cy - 0.1 * (cy - box[1]))])
    shape = (squircle(*box, n=n) + tail) - squircle(*ibox, n=ni)
    crotch, a_curve = _ray_hit_sq(a_r, (-d[0], -d[1]), box, n)
    if crotch is not None:
        # The bowl edge is convex, so its tangent stays in the white and the
        # trap opens cleanly on that side too.
        shape = shape - crotch_trap(crotch, d, a_curve, p.trap)
    return shape


def _nine(p):
    six = _six(p)
    b = six.bounds()
    return six.rotate180((b[0] + b[2]) / 2, P.CAP / 2)


def _seven(p):
    w = p.w(456, 0.7)
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
    """Two stacked bowls. Four round corners meet at the waist, so the 8 is
    the darkest figure: its sides and waist are a little thinner than the
    other figures' strokes (ink about 1.25 of the mean tabular figure, like
    Inter's 1.15-1.23)."""
    n, ni = _n(p), _ni(p)
    ws = p.fstem * 0.96
    h = _fh(p)
    wl = p.w(480, 0.6)
    wu = p.w(436, 0.55)
    ym, hm = _waist(p, 0.9)
    lb = (0, -P.COS, wl, ym + hm / 2)
    li = (ws * 1.03, lb[1] + h, wl - ws * 1.03, lb[3] - hm)
    xu0 = (wl - wu) / 2
    ub = (xu0, ym - hm / 2, xu0 + wu, P.CAP + P.COS)
    ui = (xu0 + ws * 0.97, ub[1] + hm, ub[2] - ws * 0.97, ub[3] - h)
    return (
        (squircle(*lb, n=n) + squircle(*ub, n=n))
        - squircle(*li, n=ni)
        - squircle(*ui, n=ni)
    )


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

# Optical nudges inside the tabular advance (units at Regular). "one" now
# applies only to the superior 1; the tabular 1 has a base and is centred.
NUDGE = {"one": 28, "four": -6, "seven": 6}


@glyph("zero.tf")
def zero(p):
    return _fit(p, _zero(p))


@glyph("zero.tf.zero")
def zero_zero(p):
    return _fit(p, _zero(p) + _zero_slash(p))


@glyph("one.tf")
def one(p):
    return _fit(p, _one_tf(p))


@glyph("two.tf")
def two(p):
    return _fit(p, _two(p))


@glyph("three.tf")
def three(p):
    return _fit(p, _three(p))


@glyph("four.tf")
def four(p):
    return _fit(p, _four(p), NUDGE["four"])


@glyph("five.tf")
def five(p):
    return _fit(p, _five(p))


@glyph("six.tf")
def six(p):
    return _fit(p, _six(p))


@glyph("seven.tf")
def seven(p):
    return _fit(p, _seven(p), NUDGE["seven"])


@glyph("eight.tf")
def eight(p):
    return _fit(p, _eight(p))


@glyph("nine.tf")
def nine(p):
    return _fit(p, _nine(p))


# ---------------------------------------------------------------------------
# Proportional figures, the default: the tabular outlines above respaced with
# their own sidebearings (multiples of p.csbr), so "1" doesn't leave a hole in
# running text (the 1 is drawn baseless from `_one`). The tabular forms stay
# available through tnum (.tf).

PROP_SB = {
    "zero": (1.0, 1.0),
    "one": (0.8, 1.35),
    "two": (1.15, 1.1),
    "three": (1.0, 1.0),
    "four": (0.95, 0.95),
    "five": (1.1, 0.95),
    "six": (1.0, 0.9),
    "seven": (0.85, 0.65),
    "eight": (0.95, 0.95),
    "nine": (0.9, 1.0),
}


def _prop(p, name, tabular=None):
    g = ref(tabular or name + ".tf")
    lk, rk = PROP_SB[name]
    return G(g.shape, l=lk * p.csbr, r=rk * p.csbr)


@glyph("zero", 0x0030)
def zero_prop(p):
    return _prop(p, "zero")


@glyph("zero.zero")
def zero_zero_prop(p):
    return _prop(p, "zero", "zero.tf.zero")


@glyph("one", 0x0031)
def one_prop(p):
    # Drawn from the baseless 1, not the tabular one.
    lk, rk = PROP_SB["one"]
    return G(_one(p), l=lk * p.csbr, r=rk * p.csbr)


@glyph("two", 0x0032)
def two_prop(p):
    return _prop(p, "two")


@glyph("three", 0x0033)
def three_prop(p):
    return _prop(p, "three")


@glyph("four", 0x0034)
def four_prop(p):
    return _prop(p, "four")


@glyph("five", 0x0035)
def five_prop(p):
    return _prop(p, "five")


@glyph("six", 0x0036)
def six_prop(p):
    return _prop(p, "six")


@glyph("seven", 0x0037)
def seven_prop(p):
    return _prop(p, "seven")


@glyph("eight", 0x0038)
def eight_prop(p):
    return _prop(p, "eight")


@glyph("nine", 0x0039)
def nine_prop(p):
    return _prop(p, "nine")


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
    return _fit(p, _small(p, name), width=round(p.w(400, 0.3)))


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
    return _fit(
        p, _over(p, _small(p, a), _small(p, b, "inf")), width=round(p.w(900, 1.5))
    )


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
# Percent and per mille: small squircle rings either side of a slash. The
# sign has a set width, p.w(800, 0.8), and the rings are sized to fill it: each
# sits as close to the slash as a perpendicular gap allows, so they reach in
# over the slash's run instead of the width adding up ring + slash + ring.

PCT_RH = P.CAP * 0.46  # ring height without overshoot
PCT_OS = P.COS * 0.7


def _pct_t(p):
    return p.fstem * 0.8


def _pct_gap(p):
    """Perpendicular gap between a ring and the slash."""
    return p.w(36, 0.1)


def _pct_ring(p, rw):
    g = max(0.0, p.grow) / 70
    ws, h = p.fstem * (0.84 - 0.22 * g), _fh(p) * (0.8 - 0.18 * g)
    return ring(0, -PCT_OS, rw, PCT_RH + PCT_OS, ws, h, n=_n(p), n_in=_ni(p))


def _pct_x(p, rw, y0, side):
    """Left edge for a ring rw wide whose box starts at y0 (without
    overshoot), so it clears the slash (centred on x = 0, rising at
    SLASH_ANGLE through (0, CAP / 2)) by the gap: side "num" above-left of
    it, "den" below-right."""
    a = math.radians(SLASH_ANGLE)
    nrm = (-math.sin(a), math.cos(a))  # away from the slash, up and left
    box = (0, y0 - PCT_OS, rw, y0 + PCT_RH + PCT_OS)
    ds = [x * nrm[0] + (y - P.CAP / 2) * nrm[1] for x, y in _sq_pts(box, _n(p), 60)]
    need = _pct_t(p) / 2 + _pct_gap(p)
    if side == "num":
        return (min(ds) - need) / math.sin(a)
    return (max(ds) + need) / math.sin(a)


def _pct_rw(p):
    """Ring width that makes the percent sign p.w(800, 0.8) wide."""
    ink = p.w(800, 0.8) - 1.5 * p.csbr
    lo, hi = 100.0, 600.0
    for _ in range(40):
        rw = (lo + hi) / 2
        width = _pct_x(p, rw, 0, "den") + rw - _pct_x(p, rw, P.CAP / 2, "num")
        lo, hi = (rw, hi) if width < ink else (lo, rw)
    return lo


def _pct(p, den_rings):
    rw = _pct_rw(p)
    num = _pct_ring(p, rw)
    sh = num.move(_pct_x(p, rw, P.CAP / 2, "num"), P.CAP / 2)
    # Per mille: the pair below is a little narrower, so the sign stays
    # compact.
    rd = rw if den_rings == 1 else rw * 0.9
    den = _pct_ring(p, rd)
    x = _pct_x(p, rd, 0, "den")
    for _ in range(den_rings):
        sh = sh + den.move(x, 0)
        x += rd + p.w(36, 0.2)
    sh = sh + _slash(p, 0.0, t=_pct_t(p))
    return G(sh, l=p.csbr * 0.75, r=p.csbr * 0.75)


@glyph("percent", 0x0025)
def percent(p):
    return _pct(p, 1)


@glyph("perthousand", 0x2030)
def perthousand(p):
    return _pct(p, 2)


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
    # Bowls and spine meet edge to edge at the bowls' vertical extremes.
    up = up & (above(ycu) + (right_of(cxu) & above(ct)))
    up = up - (right_of(cxu) & below(ct))
    up = up - chamfer(_ox(ub, n, ct, "right"), ct, p.ccut, "se")
    lo = squircle(*lb, n=n) - squircle(*li, n=ni)
    lo = lo & (below(ycl) + (left_of(cxl) & below(cb)))
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
    mb0, mb1 = (
        (mb[0] - d[0] * seg / 2, mb[1] - d[1] * seg / 2),
        (mb[0] + d[0] * seg / 2, mb[1] + d[1] * seg / 2),
    )
    mt0, mt1 = (
        (mt[0] - d[0] * seg / 2, mt[1] - d[1] * seg / 2),
        (mt[0] + d[0] * seg / 2, mt[1] + d[1] * seg / 2),
    )
    down = (0.0, -1.0)
    b0, b3 = (xul, ycu), (xlr - ws, ycl)
    t0, t3 = (xul + ws, ycu), (xlr, ycl)
    b1a, b2a = _handles(b0, down, mb0, d, 0.72, 0.62)  # outer left
    b1b, b2b = _handles(mb1, d, b3, down, 0.62, 0.8)  # lower counter
    t1a, t2a = _handles(t0, down, mt0, d, 0.8, 0.62)  # upper counter
    t1b, t2b = _handles(mt1, d, t3, down, 0.62, 0.72)  # outer right
    spine = _path(
        b0,
        [
            t0,
            (t1a, t2a, mt0),
            mt1,
            (t1b, t2b, t3),
            b3,
            (b2b, b1b, mb1),
            mb0,
            (b2a, b1a, b0),
        ],
    )
    return up + spine + lo


@glyph("dollar", 0x0024)
def dollar(p):
    w = p.w(452, 0.7)
    ws = p.fstem * 0.98
    h = _fh(p) * 0.98
    s_ = _s_shape(p, w, -P.COS, P.CAP + P.COS, ws, h, h * 1.02, 0.745, 0.262)
    bt = p.fstem * 0.82
    cx = w * 0.505
    ext = p.w(92, 0.2)
    bar = rect(cx - bt / 2, P.CAP + P.COS - h * 0.5, cx + bt / 2, P.CAP + ext) + rect(
        cx - bt / 2, -ext, cx + bt / 2, -P.COS + h * 0.5
    )
    return _fit(p, s_ + bar)


@glyph("cent", 0x00A2)
def cent(p):
    n, ni = _n(p), _ni(p)
    w = p.w(408, 0.6)
    ws = p.fstem * 1.02
    h = _fh(p)
    top = P.CAP * 0.8
    box = (0, -P.COS, w, top + P.COS)
    from .parts import open_bowl

    c_ = open_bowl(
        p,
        box[0],
        box[2],
        box[1],
        box[3],
        ws,
        h,
        h,
        cut_top=box[1] + (box[3] - box[1]) * 0.69,
        cut_bottom=box[1] + (box[3] - box[1]) * 0.31,
        n=n,
        n_in=ni,
        chamfer_leg=p.ccut,
    )
    bt = p.fstem * 0.82
    cx = w * 0.53
    ext = p.w(96, 0.2)
    bar = rect(
        cx - bt / 2, top + P.COS - h * 0.5, cx + bt / 2, top + P.COS + ext
    ) + rect(cx - bt / 2, -P.COS - ext, cx + bt / 2, -P.COS + h * 0.5)
    return _fit(p, c_ + bar, dx=-p.w(10, 0.0))


@glyph("sterling", 0x00A3)
def sterling(p):
    n, ni = _n(p), _ni(p)
    s = p.fstem
    h = _fh(p)
    w = p.w(470, 0.7)
    xs = p.w(78, 0.3)  # stem left edge
    hook_r = w - p.w(6, 0.0)
    ytop = P.CAP + P.COS
    g = max(0.0, p.grow) / 70
    hb = P.CAP * 0.56 - 56 * g  # hook box bottom
    ht = h * (1 - 0.08 * g)
    box = (xs, hb, hook_r, ytop)
    ibox = (xs + s, hb + ht, hook_r - s * 0.98, ytop - ht)
    cy = (hb + ytop) / 2
    cxh = (xs + hook_r) / 2
    yt = cy - (ytop - cy) * 0.12  # terminal just below the bowl's widest point
    hook = (squircle(*box, n=n) - squircle(*ibox, n=ni)) & above(min(cy, yt) - 1)
    hook = hook - (right_of(cxh) & below(yt))
    hook = hook - chamfer(_ox(box, n, yt, "right"), yt, p.ccut, "se")
    # Hook and stem meet edge to edge at the hook's vertical extreme (cy).
    hook = hook & (above(cy) + right_of(cxh))
    stem = rect(xs, h - 1, xs + s, cy)
    base = rect(0, 0, w, h)
    bar_y = P.CAP * 0.42
    bt = h * (0.9 - 0.08 * g)
    bar = rect(
        xs - p.w(70, 0.1), bar_y - bt / 2, xs + s + p.w(146, 0.3), bar_y + bt / 2
    )
    return _fit(p, hook + stem + base + bar)


@glyph("yen", 0x00A5)
def yen(p):
    w = p.w(520, 0.75)
    s = p.fstem
    t = p.fstem * 0.92
    h = _fh(p) * 0.92
    cx = w / 2
    yj = P.CAP * 0.44  # where the arms meet the stem
    hw_top = (
        t / 2 / math.cos(math.atan2(cx, P.CAP - yj))
    )  # half-width of the arms' horizontal cut
    arm_l = diag(cx, yj - 60, hw_top, P.CAP, t) & above(yj - 60)
    arm_r = diag(cx, yj - 60, w - hw_top, P.CAP, t) & above(yj - 60)
    stem = rect(cx - s / 2, 0, cx + s / 2, yj)
    sh = arm_l + arm_r + stem
    # Crotch between the arms: their inner edges meet on the centre line,
    # half the arm thickness (measured vertically) above the centrelines.
    dxa = cx - hw_top
    k = (P.CAP - (yj - 60)) / dxa
    y_cr = (yj - 60) + (t / 2) / math.cos(math.atan(k))
    sh = sh - crotch_trap((cx, y_cr), (-1.0, k), (1.0, k), p.trap)
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
    w = p.w(462, 0.6)
    ws = p.fstem * 1.02
    h = _fh(p)
    c_ = open_bowl(
        p,
        0,
        w,
        -P.COS,
        P.CAP + P.COS,
        ws,
        h,
        h,
        cut_top=P.CAP * 0.69,
        cut_bottom=P.CAP * 0.31,
        n=n,
        n_in=ni,
        chamfer_leg=p.ccut,
    )
    c_ = c_.move(p.w(92, -0.15), 0)
    bt = h * 0.8
    off = bt / 2 + p.w(34, 0.25)
    sh = c_
    for yb in (P.CAP / 2 + off, P.CAP / 2 - off):
        sh = sh + rect(0, yb - bt / 2, p.w(350, 0.6), yb + bt / 2)
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
    # The stem meets both hooks edge to edge at their cuts. Its ends come
    # from the hooks' own (float32) bounds: computed in float64, the lower
    # end missed the rotated cut by 2e-5 and pathops kept the hook as a
    # separate contour at some weights.
    stem = rect(xs, lower.bounds()[3], xs + s, upper.bounds()[1])
    bar_y = P.XH - h / 2
    bar = rect(xs - p.w(118, 0.3), bar_y - h / 2, xs + s + p.w(118, 0.3), bar_y + h / 2)
    # Stem first: unioning the two disjoint hooks first made pathops drop
    # most of the stem at some weights.
    sh = (stem + bar + upper + lower).skew(11, cy=(top + bot) / 2)
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
    return rect(cx - a, cy - t / 2, cx + a, cy + t / 2) + rect(
        cx - t / 2, cy - a, cx + t / 2, cy + a
    )


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
    return poly(
        [
            (xo + f, cy + f * ta),
            (xe, cy + (xe - xo) * ta),
            (xe, cy + (xe - xi) * ta),
            (xi, cy),
            (xe, cy - (xe - xi) * ta),
            (xe, cy - (xe - xo) * ta),
            (xo + f, cy - f * ta),
        ]
    )


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
    # The middle runs steeply, so crest and trough stay round. At heavy
    # weights the stroke is thick for the amplitude and the inner crest
    # drops below the middle's tangent, which folds the inner edge into a
    # cusp; steepen the middle until the chord from the middle to the inner
    # crest is 6 degrees steeper than its tangent.
    phi = math.radians(47)
    for _ in range(8):
        nm = (math.sin(phi), math.cos(phi))
        mx, my = cx - nm[0] * wm / 2, cy - nm[1] * wm / 2
        chord = math.atan2(cy + amp - wy / 2 - my, cx - half_w * 0.44 - mx)
        need = math.pi - chord + math.radians(6)
        if phi >= need - 1e-9:
            break
        phi = need
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
    for a, ta, b, tb in (
        (o0, de, o1, rt),
        (o1, rt, o2, dm),
        (o2, dm, o3, rt),
        (o3, rt, o4, de),
    ):
        h1, h2 = _handles(a, ta, b, tb, k, k)
        segs.append((h1, h2, b))
    segs.append(i4)
    for a, ta, b, tb in (
        (i4, mde, i3, lf),
        (i3, lf, i2, mdm),
        (i2, mdm, i1, lf),
        (i1, lf, i0, mde),
    ):
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
    sh = stroke((cx - a, cy - a), (cx + a, cy + a), t) + stroke(
        (cx - a, cy + a), (cx + a, cy - a), t
    )
    return _math(p, sh)


@glyph("divide", 0x00F7)
def divide(p):
    cx, cy = _cx(p), P.AXIS
    ds = p.dot * 0.95
    off = _mt(p) / 2 + p.w(48, 0.1) + ds / 2
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


def _chev_ext(hw, hh, t):
    """Ink of `_chevron(p, cx, cy, hw, hh, t)` relative to (cx, cy): left and
    right edge offsets and the half height."""
    al = math.atan2(hh, 2 * hw)
    left = -hw - (t / 2) / math.sin(al) + 0.3 * t / math.tan(al)
    return left, hw, hh + t / (2 * math.cos(al))


# The point side of < carries less ink near its edge, so the sign sits a
# little left of centre (Inter: 7-17 units).
LT_SHIFT = 12


def _lt_dims(p):
    return _arm(p) * 0.92, _arm(p) * 0.86


def _lt(p, cy=P.AXIS):
    hw, hh = _lt_dims(p)
    left, right, _ = _chev_ext(hw, hh, _mt(p))
    return _chevron(p, _cx(p) - LT_SHIFT - (left + right) / 2, cy, hw, hh)


@glyph("less", 0x003C)
def less(p):
    return _math(p, _lt(p))


@glyph("greater", 0x003E)
def greater(p):
    return _math(p, _lt(p).flip_x(_cx(p)))


def _lte(p, cy=P.AXIS):
    """< over a bar, centred on cy: chevron, gap and bar together are exactly
    as tall as <, and chevron and bar as wide as it, so the sign keeps the
    height of < at every weight. The chevron flattens to make room."""
    t = _mt(p)
    hw, hh = _lt_dims(p)
    left, right, H = _chev_ext(hw, hh, t)
    W = right - left
    gap = p.w(48, -0.1)
    hc = (2 * H - t - gap) / 2  # the chevron's half height
    al = math.atan2(hh, 2 * hw)
    for _ in range(60):
        hh2 = hc - t / (2 * math.cos(al))
        hw2 = (W - t / (2 * math.sin(al)) + 0.3 * t / math.tan(al)) / 2
        al = math.atan2(hh2, 2 * hw2)
    l2, r2, _ = _chev_ext(hw2, hh2, t)
    cx = _cx(p)
    chev = _chevron(p, cx - (l2 + r2) / 2, cy + H - hc, hw2, hh2)
    bar = rect(cx - W / 2, cy - H, cx + W / 2, cy - H + t)
    return chev + bar


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
    L = off + p.w(150, 0.15)
    run = 2 * L / math.tan(math.radians(62))
    sh = (
        _minus(p, cx, cy + off)
        + _minus(p, cx, cy - off)
        + diag(cx - run / 2, cy - L, cx + run / 2, cy + L, _mt(p))
    )
    return _math(p, sh)


def _tilde(p, cy, scale=1.0):
    # The ends grow outward with the stroke, so the length barely widens.
    return _wave(p, _cx(p), cy, p.w(216, 0.1) * scale, p.w(58, 0.3) * scale)


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
    # The tick is the free end of a bar, so it stays square.
    sh = rect(cx - a, y - t / 2, cx + a, y + t / 2) + rect(
        cx + a - t * 1.04, y - drop, cx + a, y
    )
    return _math(p, sh)


@glyph("asciicircum", 0x005E)
def asciicircum(p):
    w = _fw(p)
    hw = p.w(196, 0.0)  # the stroke widens it already
    depth = P.CAP * 0.42
    sh = _chevron(p, 0.0, 0.0, depth / 2, hw, t=_mt(p))
    # Rotate the chevron so it points up, tip on the cap height.
    sh = sh.rotate(-90, 0.0, 0.0)
    b = sh.bounds()
    sh = sh.move(w / 2 - (b[0] + b[2]) / 2, P.CAP - b[3])
    return G(sh, width=w)


# Case forms: the same operators centred on P.CASE_AXIS, for use with
# capitals and figures (features.py maps them in `case`).
CASE_OPERATORS = [
    "plus",
    "minus",
    "multiply",
    "divide",
    "equal",
    "plusminus",
    "less",
    "greater",
    "lessequal",
    "greaterequal",
    "notequal",
    "asciitilde",
    "approxequal",
    "logicalnot",
]


def _case_form(base):
    def draw(p):
        g = base(p)
        return G(g.shape.move(0, P.CASE_AXIS - P.AXIS), width=g.width)

    draw.__name__ = base.__name__ + "_case"
    return draw


for _name in CASE_OPERATORS:
    glyph(_name + ".case")(_case_form(globals()[_name]))


# ---------------------------------------------------------------------------
# Degree, mu, ordinals, infinity


@glyph("degree", 0x00B0)
def degree(p):
    n, ni = _n(p), _ni(p)
    g = max(0.0, p.grow) / 70
    d = p.w(268, 0.6)
    ws = p.fstem * (0.74 - 0.16 * g)
    h = _fh(p) * (0.68 - 0.12 * g)
    top = P.CAP + P.COS * 0.6
    sh = ring(0, top - d, d * 0.94, top, ws, h, n=n, n_in=ni)
    return G(sh, l=p.csbr * 0.9, r=p.csbr * 0.9)


@glyph("mu", 0x00B5)
def mu(p):
    from .parts import n_shape

    s = p.stem
    sh, xr = n_shape(p, 0, p.w(300, -1.0), cut=False)
    sh = sh.rotate180(xr / 2, P.XH / 2)
    # The turned n brings its square-topped right stem to the left, so the
    # left stem's nw chamfer is cut after the union.
    sh = sh + rect(0, P.DESC, s, P.XH, sw=p.cut)
    sh = sh - chamfer(0, P.XH, p.cut, "nw") - chamfer(xr, P.XH, p.cut, "ne")
    return G(sh, l=p.sb, r=p.sb * 0.92)


def _small_a(q):
    """A compact double-storey a (lowercase proportions) for the ordinal.
    The bowl's outer contour and its counter meet the stem at heights solved
    for, so the joins have the same shape at every weight."""
    from .parts import solve_cx

    n, ni = q.sq, q.sq_in
    s = q.stem
    h = q.hair
    w = q.w(452, 1.3)
    xh = P.XH
    xs = w - s  # stem's left edge
    # Hook over the top, ending on the left with a horizontal cut.
    ytop = xh + P.OS
    hb = xh * 0.36
    box = (0, hb, w, ytop)
    ibox = (s * 0.98, hb + h, w - s, ytop - h)
    cy = (hb + ytop) / 2
    yt = cy + 0.5 * (ibox[3] - cy)
    hook = (squircle(*box, n=n) - squircle(*ibox, n=ni)) & above(cy)
    hook = hook - (left_of(w / 2) & below(yt))
    hook = hook - chamfer(_ox(box, n, yt, "left"), yt, q.cut, "sw")
    stem = rect(xs, 0, w, cy)  # edge to edge with the hook's extreme
    # Bowl: outer contour leaves the stem edge at y_o (and mirrored at the
    # top); the counter is a squircle clipped by the stem edge.
    y0, bt = -P.OS, xh * 0.57
    byc, bry = (y0 + bt) / 2, (bt - y0) / 2
    y_o = y0 + bry * 0.32
    bcx = solve_cx(0, xs, y_o, byc, bry, n)
    outer = squircle(0, y0, 2 * bcx, bt, n=n)
    iy0, iy1 = y0 + h * 0.98, bt - h * 0.92
    icy, iry = (iy0 + iy1) / 2, (iy1 - iy0) / 2
    icx = solve_cx(s * 1.02, xs, iy0 + iry * 0.45, icy, iry, ni)
    counter = squircle(s * 1.02, iy0, 2 * icx - s * 1.02, iy1, n=ni) & left_of(xs)
    sh = (hook + stem + (outer & left_of(xs + s * 0.5))) - counter
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


def _loop(v_top, v_bot, th, x_end, y_top, y_bot, n, blend=0.45):
    """Segments (for `_path`) of one loop of the infinity, from its upper
    vertex `v_top` round its far end to its lower vertex `v_bot`. The loop
    leaves each vertex as a straight diagonal at `th` degrees from the
    horizontal, blends into a flat top / bottom, and turns round a squircle
    end whose extreme is at x = x_end. Drawn for the left loop (x_end left of
    the vertices); mirror it for the right one."""
    from ..geom import superness

    k = superness(n)
    c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
    cy, ry = (y_top + y_bot) / 2, (y_top - y_bot) / 2
    segs = []
    # Corner where the diagonal from v_top would meet the top line; the blend
    # starts `r` before it on both lines.
    xc_t = v_top[0] - (y_top - v_top[1]) / s * c
    xc_b = v_bot[0] - (v_bot[1] - y_bot) / s * c
    r = blend * (min(xc_t, xc_b) - x_end)
    xt = min(xc_t, xc_b) - r
    rx = xt - x_end
    up, dn = (-c, s), (-c, -s)  # away from the vertices, along the diagonals
    pt = (xc_t + r * c, y_top - r * s)
    pb = (xc_b + r * c, y_bot + r * s)
    kb = 0.68  # a 42-degree turn: a little fuller than a circular arc (0.64)
    segs.append(pt)
    h1, h2 = _handles(pt, up, (xt, y_top), (-1.0, 0.0), kb, kb)
    segs.append((h1, h2, (xt, y_top)))
    segs.append(((xt - k * rx, y_top), (x_end, cy + k * ry), (x_end, cy)))
    segs.append(((x_end, cy - k * ry), (xt - k * rx, y_bot), (xt, y_bot)))
    h1, h2 = _handles((xt, y_bot), (1.0, 0.0), pb, (-dn[0], -dn[1]), kb, kb)
    segs.append((h1, h2, pb))
    segs.append(v_bot)
    return segs


def _mirror_segs(start, segs):
    """The same run of segments mirrored about x = 0 and walked backwards:
    returns (new_start, new_segs)."""

    def m(q):
        return (-q[0], q[1])

    pts = [start] + [sg if not isinstance(sg[0], tuple) else sg[2] for sg in segs]
    out = []
    for i in range(len(segs), 0, -1):
        sg = segs[i - 1]
        if isinstance(sg[0], tuple):
            out.append((m(sg[1]), m(sg[0]), m(pts[i - 1])))
        else:
            out.append(m(pts[i - 1]))
    return m(pts[-1]), out


@glyph("infinity", 0x221E)
def infinity(p):
    """Two squircle loops whose inner strokes cross as an X at the centre, so
    it reads as one crossing stroke rather than two fused rings. The centre
    column of ink is the crossing's height, td / cos(th): about 1.3 x fhair
    at Regular."""
    n, ni = _n(p), _ni(p)
    t = _mt(p)
    g = max(0.0, p.grow) / 70
    ws = t * (1.0 - 0.1 * g)  # far ends of the loops
    h = t * (0.9 - 0.15 * g)  # tops and bottoms
    td = (ws + h) / 2 * 0.98  # the crossing diagonals
    th = 42.0
    c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
    half = p.w(300, 0.5)
    hh = p.w(150, 0.5)
    cy = P.AXIS
    # Outer silhouette: one contour that pinches to a V above and below the
    # crossing.
    vt, vb = (0.0, cy + td / (2 * c)), (0.0, cy - td / (2 * c))
    left = _loop(vt, vb, th, -half, cy + hh, cy - hh, n)
    _, right = _mirror_segs(vt, left)
    outer = _path(vt, left + right)
    # Counters: teardrops pointing at the crossing.
    vi = (-td / (2 * s), cy)
    counter = _path(
        vi, _loop(vi, vi, th, -half + ws, cy + hh - h, cy - hh + h, ni)[:-1]
    )
    sh = outer - counter - counter.flip_x(0.0)
    return G(sh, l=p.csbr * 0.8, r=p.csbr * 0.8)
