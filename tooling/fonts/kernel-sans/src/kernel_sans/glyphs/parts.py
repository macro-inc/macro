"""Reusable letter parts shared by the glyph modules.

Each helper returns a `Shape` in drawn coordinates. They encode the house
construction (squircle curves, flat arch tops, asymmetric grotesque joins), so
use them instead of re-deriving the geometry in each glyph.
"""

from .. import params as P
from ..geom import above, band, below, chamfer, poly, rect, right_of, left_of, squircle, stem_trap, trap


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


def n_shape(p, x0, counter, top=None, height=None, cut=True, trap_ink=True):
    """The complete lowercase n: left stem at x0 with a free top, arch, right
    stem. Returns (shape, xr) where xr is the right edge of the right stem.
    `height` is the stem height (x-height); `top` the arch top."""
    s = p.stem
    h = P.XH if height is None else height
    top = h + P.OS * 0.8 if top is None else top
    xl = x0 + s
    xr = xl + counter + s
    yc = h * 0.42
    a = arch(xl, xr, top, yc, s, p.hair, join_out=h - p.hair * 0.1, join_in=h - p.hair - h * 0.17, p=p)
    stem_l = rect(x0, 0, xl, h, nw=p.cut if cut else 0)
    # Share the edge exactly: an overlap at a curve's vertical extreme can
    # make pathops resolve the union differently per weight.
    stem_r = rect(xr - s, 0, xr, yc)
    shape = stem_l + a + stem_r
    if trap_ink:
        crotch_y = h - p.hair - h * 0.17
        shape = shape - stem_trap(xl, crotch_y, p.trap * 1.3)
    return shape, xr


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


def open_bowl(p, x0, x1, y0, y1, ws, wt, wb, cut_top, cut_bottom, n=None, n_in=None, chamfer_leg=None, side="right"):
    """A squircle ring opened on one side with HORIZONTAL terminal cuts, as in
    c, C and the curves of e, s, G, 2, 3, 5, 6, 9.

    cut_top / cut_bottom: heights of the terminal faces (None leaves that
    half closed). The outer corner of each terminal gets the house 45° chamfer
    (leg defaults to p.cut). side: which side opens ("right" for c)."""
    n = n or p.sq
    n_in = n_in or p.sq_in
    shape = squircle(x0, y0, x1, y1, n) - squircle(x0 + ws, y0 + wb, x1 - ws, y1 - wt, n_in)
    cx = (x0 + x1) / 2
    gap = right_of(cx) if side == "right" else left_of(cx)
    lo = y0 - 10 if cut_bottom is None else cut_bottom
    hi = y1 + 10 if cut_top is None else cut_top
    shape = shape - (gap & band(lo, hi))
    leg = p.cut if chamfer_leg is None else chamfer_leg
    if leg > 0:
        if cut_top is not None:
            xt = outer_x(x0, x1, y0, y1, n, cut_top, side)
            shape = shape - chamfer(xt, cut_top, leg, "se" if side == "right" else "sw")
        if cut_bottom is not None:
            xb = outer_x(x0, x1, y0, y1, n, cut_bottom, side)
            shape = shape - chamfer(xb, cut_bottom, leg, "ne" if side == "right" else "nw")
    return shape


__all__ = ["solve_cx", "arch", "n_shape", "bowl", "outer_x", "open_bowl", "band", "chamfer", "above", "below", "poly", "rect", "right_of", "left_of", "squircle", "trap"]
