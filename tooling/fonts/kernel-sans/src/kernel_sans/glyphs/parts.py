"""Reusable letter parts shared by the glyph modules.

Each helper returns a `Shape` in drawn coordinates. They encode the house
construction (squircle curves, flat arch tops, asymmetric grotesque joins), so
use them instead of re-deriving the geometry in each glyph.
"""

import math

import pathops

from .. import params as P
from ..geom import (
    Shape,
    above,
    band,
    below,
    left_of,
    poly,
    rect,
    right_of,
    squircle,
    superness,
)


def solve_cx(x_extreme, xp, yp, yc, ry, n, side="right"):
    """Centre x of a superellipse whose right (or left) extreme is at
    x_extreme, whose vertical centre/radius are yc/ry, and which passes
    through (xp, yp)."""
    t = min(0.999, abs(yp - yc) / ry)
    q = (1 - t**n) ** (1 / n)
    if side == "right":
        return (xp + q * x_extreme) / (1 + q)
    return (xp + q * x_extreme) / (1 + q)


def arch(xl, xr, top, yc, w_side, w_top, join_out, join_in, n=None, n_in=None, p=None):
    """The shoulder of n, h, m: a squircle arch rising off a stem whose RIGHT
    edge is at xl and coming down into a right stem whose right edge is xr.

    top:      outer top of the arch (x-height + overshoot)
    yc:       height where the right side turns straight; below it add a stem
    w_side:   thickness of the right side (the right stem)
    w_top:    thickness at the top of the arch
    join_out: height where the outer contour meets the stem edge xl
    join_in:  height of the crotch, where the counter meets xl

    Returns the arch only (clipped to x >= xl - 1), without stems."""
    n = n or (p.sq if p else 3.0)
    n_in = n_in or (p.sq_in if p else 2.7)
    ry_o = top - yc
    cx_o = solve_cx(xr, xl, join_out, yc, ry_o, n)
    rx_o = xr - cx_o
    outer = squircle(cx_o - rx_o, yc - ry_o, xr, top, n)
    ry_i = top - w_top - yc
    xri = xr - w_side
    cx_i = solve_cx(xri, xl, join_in, yc, ry_i, n_in)
    rx_i = xri - cx_i
    inner = squircle(cx_i - rx_i, yc - ry_i, xri, top - w_top, n_in)
    return ((outer - inner) & above(yc)) & right_of(xl - 1)


def n_shape(p, x0, counter, top=None, height=None):
    """The complete lowercase n: left stem at x0 with a free top, arch, right
    stem. Returns (shape, xr) where xr is the right edge of the right stem.
    `height` is the stem height (x-height); `top` the arch top."""
    s = p.stem
    h = P.XH if height is None else height
    top = h + P.OS * 0.8 if top is None else top
    xl = x0 + s
    xr = xl + counter + s
    yc = h * 0.42
    a = arch(
        xl,
        xr,
        top,
        yc,
        s,
        p.hair,
        join_out=h - p.hair * 0.1,
        join_in=h - p.hair - h * 0.17,
        p=p,
    )
    stem_l = rect(x0, 0, xl, h)
    # Share the edge exactly: an overlap at a curve's vertical extreme can
    # make pathops resolve the union differently per weight.
    stem_r = rect(xr - s, 0, xr, yc)
    join_out = h - p.hair * 0.1
    cx_o = solve_cx(xr, xl, join_out, yc, top - yc, p.sq)
    obox = (2 * cx_o - xr, 2 * yc - top, xr, top)
    fill = flush_end(xl, h, join_out, obox, p.sq)
    return stem_l + a + stem_r + fill, xr


def bowl(p, x0, x1, y0=None, y1=None, w_side=None, w_top=None, n=None, n_in=None):
    """A closed squircle bowl (as in o, b, d, p, q) filling x0..x1 between
    baseline and x-height with overshoot."""
    y0 = -P.OS if y0 is None else y0
    y1 = P.XH + P.OS if y1 is None else y1
    ws = p.stem * 1.03 if w_side is None else w_side
    wt = p.hair if w_top is None else w_top
    outer = squircle(x0, y0, x1, y1, n or p.sq)
    inner = squircle(x0 + ws, y0 + wt, x1 - ws, y1 - wt, n_in or p.sq_in)
    return outer - inner


def outer_x(x0, x1, y0, y1, n, y, side="right"):
    """x where a superellipse filling (x0, y0)-(x1, y1) crosses height y."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    t = min(1.0, abs(y - cy) / ry)
    dx = rx * (1 - t**n) ** (1 / n)
    return cx + dx if side == "right" else cx - dx


def flush_end(xl, y_end, y_join, box, n, side="right"):
    """Ink that runs a stem's flat end (top or bottom at y_end) straight on
    until it meets a curve leaving the stem edge xl at y_join, just inside
    that end (an arch or bowl that overshoots the stem). Without it the
    outline dips down the stem edge and back up the curve, a small V-notch
    next to the stem end. box, n: the curve's squircle; side: which side of
    the stem the curve lies on. Add the result to the glyph.

    The fill runs from inside the stem to the curve's crown (the box's
    centre line) and reaches 6 units into the ink below the join: the drawn
    cubic sits a unit or two off the analytic superellipse, so stopping at
    the exact crossing would leave slivers. Where the flat end meets the
    overshooting curve (at 12-14 degrees) a fillet rounds the corner off, so
    the end flows into the curve without a step."""
    x0, _, x1, _ = box
    xm = (x0 + x1) / 2
    lo, hi = sorted((y_end, y_join + (6 if y_join > y_end else -6)))
    if side == "right":
        fill = rect(xl - 1, lo, xm, hi)
    else:
        fill = rect(xm, lo, xl + 1, hi)
    return fill + _flush_fillet(xl, y_end, y_join, box, n, side)


def _flush_fillet(xl, y_end, y_join, box, n, side):
    """The fillet for flush_end. Works in a local frame where the stem edge
    is u = 0 with the curve at u > 0, the stem end is v = 0 and the curve
    overshoots it at v > 0. The quadrant of the drawn cubic (geom.squircle)
    facing the stem is followed from its crown (t = 0) down to its side
    (t = 1)."""
    sx = 1 if side == "right" else -1
    sy = 1 if y_join < y_end else -1
    bx0, by0, bx1, by1 = box
    us = sorted((sx * (bx0 - xl), sx * (bx1 - xl)))
    vs = sorted((sy * (by0 - y_end), sy * (by1 - y_end)))
    cu, ru = (us[0] + us[1]) / 2, (us[1] - us[0]) / 2
    cv, rv = (vs[0] + vs[1]) / 2, (vs[1] - vs[0]) / 2
    k = superness(n)
    q = [(cu, cv + rv), (cu - k * ru, cv + rv), (cu - ru, cv + k * rv), (cu - ru, cv)]

    def pt(t):
        m = 1 - t
        w = (m**3, 3 * m * m * t, 3 * m * t * t, t**3)
        return (
            sum(wi * c[0] for wi, c in zip(w, q)),
            sum(wi * c[1] for wi, c in zip(w, q)),
        )

    def slope(t):
        m = 1 - t
        w = (-3 * m * m, 3 * m * m - 6 * m * t, 6 * m * t - 3 * t * t, 3 * t * t)
        du = sum(wi * c[0] for wi, c in zip(w, q))
        dv = sum(wi * c[1] for wi, c in zip(w, q))
        return dv / du

    def solve(f, target):
        lo, hi = 0.0, 1.0  # f rises with t
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if f(mid) < target else (lo, mid)
        return (lo + hi) / 2

    if pt(0)[1] <= 0 or pt(1)[1] >= 0:
        return Shape()  # the curve does not overshoot the end here
    t_c = solve(lambda t: -pt(t)[1], 0.0)  # where the curve crosses v = 0
    t_b = solve(slope, math.tan(math.atan(slope(t_c)) / 2))
    ub, vb = pt(t_b)
    mb = slope(t_b)
    ut = ub - vb / mb  # the tangent at B meets the stem end's line
    ua = ut - math.hypot(ub - ut, vb)
    pts = [
        (ua, 0.0),
        (ua + 2 / 3 * (ut - ua), 0.0),
        (ub + 2 / 3 * (ut - ub), vb + 2 / 3 * (0.0 - vb)),
        (ub, vb),
        (ub, -6.0),
        (ua, -6.0),
    ]
    w = [(xl + sx * u, y_end + sy * v) for u, v in pts]
    path = pathops.Path()
    pen = path.getPen()
    pen.moveTo(w[0])
    pen.curveTo(w[1], w[2], w[3])
    pen.lineTo(w[4])
    pen.lineTo(w[5])
    pen.closePath()
    path.simplify(fix_winding=True)
    return Shape(path)


def open_bowl(
    p,
    x0,
    x1,
    y0,
    y1,
    ws,
    wt,
    wb,
    cut_top,
    cut_bottom,
    n=None,
    n_in=None,
    side="right",
):
    """A squircle ring opened on one side with HORIZONTAL terminal cuts, as in
    c, C and the curves of e, s, G, 2, 3, 5, 6, 9.

    cut_top / cut_bottom: heights of the terminal faces (None leaves that
    half closed).
    side: which side opens ("right" for c)."""
    n = n or p.sq
    n_in = n_in or p.sq_in
    shape = squircle(x0, y0, x1, y1, n) - squircle(
        x0 + ws, y0 + wb, x1 - ws, y1 - wt, n_in
    )
    cx = (x0 + x1) / 2
    gap = right_of(cx) if side == "right" else left_of(cx)
    lo = y0 - 10 if cut_bottom is None else cut_bottom
    hi = y1 + 10 if cut_top is None else cut_top
    return shape - (gap & band(lo, hi))


__all__ = [
    "above",
    "arch",
    "band",
    "below",
    "bowl",
    "flush_end",
    "left_of",
    "n_shape",
    "open_bowl",
    "outer_x",
    "poly",
    "rect",
    "right_of",
    "solve_cx",
    "squircle",
]
