"""Straight and diagonal lowercase: f h i j k l m r t u v w x y z, the dotless
i and j, the f_i / f_l ligatures and the tailed l.ss02.

Shoulders (h m r u) reuse n's arch from `parts.arch` with the same joins and
ink traps (`geom.stem_trap`). Hooks (f t j l.ss02) share one construction,
`_hook`: a squircle quadrant turning a stem into a horizontal stroke that ends
in a vertical cut with its outer corner chamfered. Diagonals (k v w x y z) are
built from their edges so the flat vertices and flat-cut ends land exactly
where they should; the inner vertices of v w y take `geom.crotch_trap`, and
k's arm takes a trap along the stem edge (`_stroke_trap`).
"""

import math

from .. import params as P
from ..geom import (
    Shape,
    above,
    below,
    chamfer,
    crotch_trap,
    dot,
    half_plane,
    left_of,
    poly,
    rect,
    right_of,
    squircle,
    stem_trap,
    superness,
)
from . import G, glyph
from .parts import arch, solve_cx

PROOF_TEXT = [
    "nfnhninjnknlnmnrntnunvnwnxnynzn",
    "ofohoiojokolomorotouovowoxoyozo",
    "minimum filthy jiffy luxury",
    "fifth fluffy fiction nfjn ff fi fl",
    "witty kiwi lynx zinc unify",
    "HOH tritium vivify whizz knot",
]


# ---------------------------------------------------------------------------
# Helpers


def _sq_y(box, n, x, side="top"):
    """y where the superellipse filling `box` crosses x (top or bottom half)."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    t = min(1.0, abs(x - cx) / rx)
    dy = ry * (1 - t**n) ** (1 / n)
    return cy + dy if side == "top" else cy - dy


def _shoulder(p, xl, counter, top=None):
    """n's arch rising off a stem whose right edge is xl (same numbers as
    parts.n_shape). Returns (arch, xr, yc, crotch_y, outer_box, inner_box)."""
    s = p.stem
    h = P.XH
    top = h + P.OS * 0.8 if top is None else top
    xr = xl + counter + s
    yc = h * 0.42
    join_out = h - p.hair * 0.1
    crotch = h - p.hair - h * 0.17
    a = arch(xl, xr, top, yc, s, p.hair, join_out=join_out, join_in=crotch, p=p)
    ry_o = top - yc
    cx_o = solve_cx(xr, xl, join_out, yc, ry_o, p.sq)
    obox = (2 * cx_o - xr, yc - ry_o, xr, top)
    ry_i = top - p.hair - yc
    xri = xr - s
    cx_i = solve_cx(xri, xl, crotch, yc, ry_i, p.sq_in)
    ibox = (2 * cx_i - xri, yc - ry_i, xri, top - p.hair)
    return a, xr, yc, crotch, obox, ibox


def _arch_through(p, xl, xr, yc, out_pt, join_in, x_from):
    """parts.arch with the outer curve passing through out_pt instead of
    meeting the stem edge at a fixed height (the second shoulder of m),
    kept right of x_from. Returns (arch, outer_box)."""
    top = P.XH + P.OS * 0.8
    ry_o = top - yc
    cx_o = solve_cx(xr, out_pt[0], out_pt[1], yc, ry_o, p.sq)
    obox = (2 * cx_o - xr, yc - ry_o, xr, top)
    ry_i = top - p.hair - yc
    xri = xr - p.stem
    cx_i = solve_cx(xri, xl, join_in, yc, ry_i, p.sq_in)
    ibox = (2 * cx_i - xri, yc - ry_i, xri, top - p.hair)
    ring = (
        (squircle(*obox, n=p.sq) - squircle(*ibox, n=p.sq_in))
        & above(yc)
        & right_of(x_from)
    )
    return ring, obox


def _shoulder_trap(p, x, y, side="right", up=True):
    """n's ink trap where an arch leaves a stem edge x at the crotch height y."""
    return stem_trap(x, y, p.trap * 1.3, side=side, up=up)


def _stroke_trap(p, x, y, edge):
    """Ink trap where a straight stroke leaves the right edge x of a stem at
    height y, with the white in the acute wedge above it (k's arm). `edge` is
    the direction of the stroke's upper edge going away from the stem.

    It runs along the stem edge like geom.stem_trap (the same leaning cut
    into the stem and the same depth below the crotch), but its far wall
    climbs parallel to that cut until it meets the stroke's edge. A plain
    stem_trap's far corner lands deep inside the stroke here, because the
    stroke rises away from the crotch instead of curving off like n's arch,
    so it would leave a pocket behind a 10-unit neck; this way the floor is
    the trap's narrowest part and it opens straight into the white."""
    d = p.trap
    if d < 1:
        return Shape()
    a = (x + d * 0.05 + 0.3, y + d * 0.4 + 4)  # in the white, as in stem_trap
    tip = (x - d * 0.22, y - d)  # into the stem below the crotch
    floor = (tip[0] + d * 0.6, tip[1])  # flat floor, like crotch_trap's
    wall = (a[0] - tip[0], a[1] - tip[1])
    c = _isect(floor, wall, (x, y), edge)  # far wall meets the stroke's edge
    w = _unit(*wall)
    out = (c[0] + w[0] * 3, c[1] + w[1] * 3)  # just past it, in the white
    return poly([(a[0], a[1] + 6), tip, floor, out])


def _sq_tangent(box, n, deg):
    """Point on the upper-right quadrant of `squircle(*box, n)` (the drawn
    cubic, not the ideal curve) where the outline falls `deg` degrees below
    the horizontal, going right."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    k = superness(n)
    want = math.tan(math.radians(deg))
    lo, hi = 0.0, 1.0  # t = 0 at the right extreme, 1 at the top
    for _ in range(60):
        t = (lo + hi) / 2
        dx = 2 * (1 - t) * t * (1 - k) * rx + t * t * k * rx
        dy = (1 - t) ** 2 * k * ry + 2 * (1 - t) * t * (1 - k) * ry
        if dy > want * dx:
            lo = t
        else:
            hi = t
    t = (lo + hi) / 2
    pts = [(cx + rx, cy), (cx + rx, cy + k * ry), (cx + k * rx, cy + ry), (cx, cy + ry)]
    c = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t**3]
    return (
        sum(ci * q[0] for ci, q in zip(c, pts)),
        sum(ci * q[1] for ci, q in zip(c, pts)),
    )


def _hook(p, x0, y_end, rise, rx, ext, wb):
    """Foot of a stem turning right into a horizontal stroke, as in t.

    The stem (width p.stem, left edge x0) runs straight down to
    yc = y_end + rise, then a squircle quadrant of half-width `rx` carries it
    round to a horizontal stroke of thickness `wb` whose outer side sits at
    y_end. The stroke ends `ext` past the stem's right edge in a vertical cut
    whose outer (lower) corner is chamfered. Mirror it for j and flip it for
    f. Returns (shape below yc, yc, x_term)."""
    s = p.stem
    yc = y_end + rise
    cxo = x0 + rx
    obox = (x0, y_end, x0 + 2 * rx, y_end + 2 * rise)
    # The counter's quadrant ends (turns horizontal) a little after the outer
    # one, so the stroke swells slightly as it turns, like n's arch.
    rxi = rx - s * 0.62
    cxi = x0 + s + rxi
    ibox = (x0 + s, y_end + wb, x0 + s + 2 * rxi, y_end + 2 * rise - wb)
    ring = squircle(*obox, n=p.sq) - squircle(*ibox, n=p.sq_in)
    cut = max(cxo, cxi)
    x_term = x0 + s + ext
    shape = (ring & below(yc) & left_of(cut)) + rect(cxo, y_end, x_term, y_end + wb)
    shape = shape & left_of(x_term)
    shape = shape - chamfer(x_term, y_end, p.cut, "se")
    return shape, yc, x_term


def _isect(p1, d1, p2, d2):
    """Intersection of the lines p1 + t*d1 and p2 + u*d2."""
    den = d1[0] * d2[1] - d1[1] * d2[0]
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
    return (p1[0] + t * d1[0], p1[1] + t * d1[1])


def _unit(dx, dy):
    d = math.hypot(dx, dy)
    return (dx / d, dy / d)


def _edge_stroke(xb, yb, xt, yt, w, side="left"):
    """A straight stroke of perpendicular thickness w with flat (horizontal)
    ends at yb and yt, positioned by one edge running (xb, yb) -> (xt, yt).
    side says which edge that is."""
    hw = w * math.hypot(xt - xb, yt - yb) / abs(yt - yb)
    if side == "left":
        return poly([(xb, yb), (xb + hw, yb), (xt + hw, yt), (xt, yt)]), hw
    return poly([(xb - hw, yb), (xb, yb), (xt, yt), (xt - hw, yt)]), hw


def _hw_between(x_top, x_bot_other, w, other_offset, dy):
    """Horizontal width of a stroke whose one edge starts at x_top (top) and
    whose OTHER edge must end at x_bot_other (bottom). Solved by iteration;
    other_offset is +1 if the other edge is to the right of the first."""
    hw = w
    for _ in range(30):
        xb = x_bot_other - other_offset * hw
        hw = w * math.hypot(x_top - xb, dy) / dy
    return hw


def _i_stem(p, height=P.XH):
    return rect(0, 0, p.stem, height, nw=p.cut)


I_DOT_GAP = 60  # least white between the i/j dot and the stem (Inter ExtraBold)


def _i_dot(p, cx):
    # The dot's top stays at the ascender. At ExtraBold p.dot (174) would
    # leave only 46 units above the stem, so the dot stops at 160 there.
    side = min(p.dot, P.ASC - P.XH - I_DOT_GAP)
    return dot(cx, P.ASC - side / 2, side)


# ---------------------------------------------------------------------------
# Stems and shoulders


@glyph("l", 0x006C)
def l(p):
    return G(_i_stem(p, P.ASC), l=p.sb, r=p.sb)


@glyph("l.ss02")
def l_ss02(p):
    # Stylistic set 2 (distinct I, l and 1): l with a short tail turning
    # right at the baseline, drawn like t's foot but shorter.
    s = p.stem
    hook, yc, _ = _hook(
        p, 0, -P.OS, p.w(160, 0.2), p.w(124, 0.62), p.w(88, 0.25), p.hair * 1.04
    )
    shape = hook + rect(0, yc, s, P.ASC, nw=p.cut)
    return G(shape, l=p.sb, r=p.sbr * 0.3, anchors={"top": s / 2, "bottom": s / 2})


@glyph("dotlessi", 0x0131)
def dotlessi(p):
    return G(_i_stem(p), l=p.sb, r=p.sb)


@glyph("i", 0x0069)
def i(p):
    s = p.stem
    shape = rect(p.sb, 0, p.sb + s, P.XH, nw=p.cut) + _i_dot(p, p.sb + s / 2)
    return G(shape, width=2 * p.sb + s, anchors={"top": p.sb + s / 2})


def _j_body(p):
    """j without its dot, drawn with the stem's left edge at x = 0. The tail
    shortens as the stem grows, so it overhangs the origin by 25-30 units at
    every weight (under 0.2 stem at ExtraBold) and clears brackets."""
    s = p.stem
    hook, yc, _ = _hook(
        p,
        0,
        P.DESC - P.OS * 0.8,
        p.w(150, 0.3),
        p.w(118, 0.55),
        p.w(96, -0.15),
        p.hair * 1.02,
    )
    body = hook.flip_x(s / 2) + rect(0, yc, s, P.XH, nw=p.cut)
    return body


@glyph("uni0237", 0x0237)
def dotlessj(p):
    s = p.stem
    shape = _j_body(p).move(p.sb, 0)
    return G(shape, width=2 * p.sb + s, anchors={"top": p.sb + s / 2})


@glyph("j", 0x006A)
def j(p):
    s = p.stem
    shape = (_j_body(p) + _i_dot(p, s / 2)).move(p.sb, 0)
    return G(shape, width=2 * p.sb + s, anchors={"top": p.sb + s / 2})


@glyph("h", 0x0068)
def h(p):
    s = p.stem
    a, xr, yc, crotch, _, _ = _shoulder(p, s, p.w(300, -1.0))
    # Edge to edge at the arch's vertical extreme, as in n.
    shape = rect(0, 0, s, P.ASC, nw=p.cut) + a + rect(xr - s, 0, xr, yc)
    shape = shape - _shoulder_trap(p, s, crotch)
    return G(shape, l=p.sb, r=p.sb * 0.92)


@glyph("m", 0x006D)
def m(p):
    s = p.stem
    counter = p.w(300, -1.0) * 0.85
    a1, x1, yc, crotch, obox1, _ = _shoulder(p, s, counter)
    x2 = x1 + counter + s
    # The second shoulder springs from the middle stem with the same inner
    # join as the first; its outer curve is aimed at a point on the first
    # shoulder 0.62 stem left of the middle stem's right edge, so the two
    # meet in a shallow valley at the same place at every weight.
    # The valley (solid, so the middle stem's edge stays straight up to the
    # crotch) and the arch meet edge to edge at that edge: overlapping them
    # on the same curve left a 1-unit segment there.
    xv = x1 - s * 0.62
    a2, obox2 = _arch_through(p, x1, x2, yc, (xv, _sq_y(obox1, p.sq, xv)), crotch, x1)
    valley = squircle(*obox2, n=p.sq) & rect(x1 - s * 0.85, yc, x1, P.XH + 50)
    shape = (
        rect(0, 0, s, P.XH, nw=p.cut)
        + a1
        + rect(x1 - s, 0, x1, yc)
        + valley
        + a2
        + rect(x2 - s, 0, x2, yc)
    )
    shape = shape - _shoulder_trap(p, s, crotch) - _shoulder_trap(p, x1, crotch)
    return G(shape, l=p.sb, r=p.sb * 0.92)


@glyph("u", 0x0075)
def u(p):
    # n turned half round, then corrected so the free stem tops get the
    # house chamfers (left nw, right ne) and the right stem stands flat on
    # the baseline with its own full-height edge.
    s = p.stem
    a, xr, yc, crotch, _, _ = _shoulder(p, s, p.w(300, -1.0))
    bowl = (a + rect(xr - s, 0, xr, yc)).rotate180(xr / 2, P.XH / 2)
    bowl = bowl - chamfer(0, P.XH, p.cut, "nw")
    shape = bowl + rect(xr - s, 0, xr, P.XH, ne=p.cut)
    shape = shape - _shoulder_trap(p, xr - s, P.XH - crotch, side="left", up=False)
    # An ogonek hangs from the right stem.
    return G(shape, l=p.sb * 0.92, r=p.sb, anchors={"bottom": xr - s / 2})


R_FALL = 28  # steepest fall of r's underside at the terminal, in degrees


@glyph("r", 0x0072)
def r(p):
    s = p.stem
    a, _xr, _yc, crotch, obox, ibox = _shoulder(p, s, p.w(250, -0.3))
    # Cut the flag between the arch's crown and the counter's right side:
    # past the crown by more than the chamfer (so the chamfer never eats the
    # crown) and short of the counter's side (so the flag never catches the
    # arch's descending stroke), at every weight.
    cxo = (obox[0] + obox[2]) / 2
    lo, hi = cxo + p.cut, ibox[2]
    x_term = lo + (hi - lo) * 0.6
    flag = a & left_of(x_term)
    # The terminal is cut vertically, so its lower corner is 90 degrees less
    # the fall of the counter's curve there. The heavy counter is narrow and
    # already falls steeply under the cut (a blade). Past the point where it
    # falls R_FALL degrees, run the underside straight on along its tangent,
    # which keeps that corner at 90 - R_FALL at every weight.
    tx, ty = _sq_tangent(ibox, p.sq_in, R_FALL)
    slope = math.tan(math.radians(R_FALL))
    # Half a unit below the tangent, so the cut meets the curve cleanly.
    spur = half_plane((tx + 400, ty - 0.5 - 400 * slope), (tx, ty - 0.5)) & right_of(tx)
    flag = flag - spur
    flag = flag - chamfer(x_term, _sq_y(obox, p.sq, x_term), p.cut, "ne")
    shape = rect(0, 0, s, P.XH, nw=p.cut) + flag
    shape = shape - _shoulder_trap(p, s, crotch)
    return G(
        shape, l=p.sb, r=p.sbr * 0.45, anchors={"top": x_term * 0.47, "bottom": s / 2}
    )


# ---------------------------------------------------------------------------
# Hooks: t f and the f ligatures


def _t_parts(p):
    """t drawn with its bar's left end at x = 0. Returns (shape, stem left
    edge, hook terminal x)."""
    s = p.stem
    # Bar and hook shrink a little as the stem grows, so t gains colour,
    # not width (ink about 284/297/353 at 300/400/800, like Inter).
    el = p.w(85, -0.15)  # bar left of the stem
    x0 = el
    ext = p.w(130, -0.15)
    hook, yc, x_term = _hook(
        p, x0, -P.OS, p.w(170, 0.2), p.w(132, 0.62), ext, p.hair * 1.04
    )
    stem = rect(x0, yc, x0 + s, 650, nw=p.cut)
    bar = rect(0, P.XH - p.hair, x_term, P.XH)
    return hook + stem + bar, x0, x_term


@glyph("t", 0x0074)
def t(p):
    shape, x0, x_term = _t_parts(p)
    s = p.stem
    return G(
        shape,
        l=p.sbr * 0.36,
        r=p.sbr * 0.3,
        anchors={"top": x0 + s / 2, "bottom": (x0 + x_term) / 2},
    )


F_TOP = P.ASC + P.OS * 0.8


def _f_hook(p, x0, ext):
    """The f's top: stem (left edge x0) bending right into a horizontal
    stroke ending `ext` past the stem. Returns (shape above yc, yc, x_term)."""
    hook, yc, x_term = _hook(
        p, x0, -F_TOP, p.w(176, 0.15), p.w(128, 0.6), ext, p.hair * 1.02
    )
    return hook.flip_y(0), -yc, x_term


def _f_dims(p):
    """(bar left of the stem, hook reach past the stem, bar right of the
    stem). The bar stops at 0.7 of the hook's reach, so the white under the
    hook opens f|n, f|r and f|u at x-height. Both shrink a little as the
    stem grows: f gains colour, not width (advance about 363/372/411)."""
    ext = p.w(150, -0.2)
    return p.w(100, -0.2), ext, ext * 0.7


def _f_parts(p, ext=None):
    s = p.stem
    el, ext0, er = _f_dims(p)
    x0 = el
    ext = ext0 if ext is None else ext
    hook, yc, x_term = _f_hook(p, x0, ext)
    stem = rect(x0, 0, x0 + s, yc)
    bar_r = x0 + s + er
    bar = rect(0, P.XH - p.hair, bar_r, P.XH)
    return hook, stem, bar, x0, x_term


def _f_metrics(p):
    # The hook overhangs the next letter; kerning tightens f before round
    # letters and leaves it at this distance from stems.
    return p.sbr * 0.5, p.sbr * 0.25


@glyph("f", 0x0066)
def f(p):
    hook, stem, bar, x0, x_term = _f_parts(p)
    lsb, rsb = _f_metrics(p)
    return G(hook + stem + bar, l=lsb, r=rsb, anchors={"top": (x0 + x_term) / 2})


def _f_lig_layout(p):
    """Where the f sits in a ligature and where the next stem starts, so the
    ligature sets exactly like f followed by i or l."""
    *_, x_term = _f_parts(p)
    lsb, rsb = _f_metrics(p)
    f_adv = lsb + x_term + rsb  # the bar's left end and the hook are the extremes
    x_next = f_adv + p.sb
    return lsb, f_adv, x_next


@glyph("f_i", 0xFB01)
def f_i(p):
    # The f's hook runs on over the i and its chamfered terminal takes the
    # place of the dot; the i keeps its own stem top. (A hook joined into the
    # stem would make fi look like fl.)
    s = p.stem
    lsb, _f_adv, xi = _f_lig_layout(p)
    x0 = _f_dims(p)[0]
    ext = (xi - lsb) - x0
    hook, stem, bar, _, _ = _f_parts(p, ext=ext)
    f_shape = (hook + stem + bar).move(lsb, 0)
    shape = f_shape + rect(xi, 0, xi + s, P.XH, nw=p.cut)
    return G(shape, width=xi + s + p.sb)


@glyph("f_l", 0xFB02)
def f_l(p):
    # The f's hook runs flat into the top of the l; the l keeps its own
    # chamfered outer corner.
    s = p.stem
    lsb, _f_adv, xl = _f_lig_layout(p)
    x0 = _f_dims(p)[0]
    ext = (xl - lsb) - x0
    hook, stem, bar, _, _ = _f_parts(p, ext=ext)
    f_shape = (hook + stem + bar).move(lsb, 0)
    shape = f_shape + rect(xl, 0, xl + s, F_TOP, ne=p.cut)
    return G(shape, width=xl + s + p.sb)


# ---------------------------------------------------------------------------
# k


@glyph("k", 0x006B)
def k(p):
    s = p.stem
    # The arm's top-right corner is (W, XH). The body barely widens past the
    # stem's own growth, so k gains colour, not width.
    W = s + p.w(350, 0.1)
    wa = s * 0.94  # arm, perpendicular
    wl = s * 0.98  # leg, perpendicular
    # Arm: its lower edge leaves the stem's right edge at y_low and ends at
    # (W, XH); the upper edge is parallel, wa away.
    y_low = P.XH * 0.17
    ad = _unit(W - s, P.XH - y_low)
    nrm = (-ad[1], ad[0])
    up0 = (s + nrm[0] * wa, y_low + nrm[1] * wa)
    y_up = up0[1] + (s - up0[0]) * ad[1] / ad[0]  # upper edge meets the stem
    x_up_top = up0[0] + (P.XH - up0[1]) * ad[0] / ad[1]
    slope = ad[1] / ad[0]
    arm = poly(
        [(s - 1, y_low - slope), (W, P.XH), (x_up_top, P.XH), (s - 1, y_up - slope)]
    )
    # Leg: its right edge runs from the foot up into the arm's lower edge at
    # J; the left edge is parallel, so the leg branches off the arm.
    xr_leg = W + p.w(12, 0.2)
    fj = 0.42 + 0.0012 * p.grow  # heavier legs branch further out
    J = (s + fj * (W - s), y_low + fj * (P.XH - y_low))
    ld = _unit(J[0] - xr_leg, J[1])  # up and to the left
    hw_l = wl / ld[1]
    run = (J[1] + 160) / ld[1]
    leg = poly(
        [
            (xr_leg - hw_l, 0),
            (xr_leg, 0),
            (xr_leg + ld[0] * run, ld[1] * run),
            (xr_leg - hw_l + ld[0] * run, ld[1] * run),
        ]
    )
    # Bury the leg's top in the arm: keep it below the arm's centreline.
    c0 = (s + nrm[0] * wa / 2, y_low + nrm[1] * wa / 2)
    leg = leg - half_plane(c0, (c0[0] + ad[0], c0[1] + ad[1]))
    shape = rect(0, 0, s, P.ASC, nw=p.cut) + arm + leg
    # Ink trap where the arm leaves the stem (a 38 degree crotch): a straight
    # stroke leaving a stem takes a trap along the stem edge, like n's,
    # opening up into the white above the arm (_stroke_trap). The crotch
    # under the arm where the leg branches off is 70-77 degrees, too open
    # to need one.
    shape = shape - _stroke_trap(p, s, y_up, ad)
    return G(shape, l=p.sb, r=p.sbr * 0.3)


# ---------------------------------------------------------------------------
# Diagonals: v w x y z


def _outside(a, b, inset=2.0):
    """Region to the RIGHT of the directed line a -> b, moved `inset` units
    to its left. Subtract it from a stroke to trim whatever pokes out past
    another stroke's edge a -> b; the inset keeps the trimmed edge strictly
    inside that stroke, so the union never has to merge coincident edges."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = math.hypot(dx, dy)
    nx, ny = -dy / d * inset, dx / d * inset
    return half_plane((b[0] + nx, b[1] + ny), (a[0] + nx, a[1] + ny))


def _v_geom(p, W, vw, w):
    """Left stroke of a v of outer width W with a flat vertex vw wide, its
    foot trimmed to the vertex. Returns (left stroke, hw, vx0, crotch)."""
    vx0 = (W - vw) / 2
    left, hw = _edge_stroke(vx0, 0, 0, P.XH, w, side="left")
    # The foot is wider than the vertex; trim what pokes past the other
    # stroke's outer edge.
    left = left - _outside((W - vx0, 0), (W, P.XH))
    # Inner edges cross on the axis.
    yc = P.XH * (hw - vw / 2) / vx0
    return left, hw, vx0, (W / 2, yc)


def _v_width(p):
    return p.w(505, 0.9)


# Diagonal sides: wider than DESIGN.md's 0.35 * sbr, because the flat-cut
# stroke ends reach the sidebearing over their whole width.
V_SB = 0.48
W_SB = 0.52
X_SB = 0.5


@glyph("v", 0x0076)
def v(p):
    W = _v_width(p)
    vw = p.stem * 0.96
    w = p.stem * 0.95
    left, _hw, vx0, c = _v_geom(p, W, vw, w)
    shape = left + left.flip_x(W / 2)
    d1 = _unit(-vx0, P.XH)
    d2 = (-d1[0], d1[1])
    shape = shape - crotch_trap(c, d1, d2, p.trap)
    return G(shape, l=p.sbr * V_SB, r=p.sbr * V_SB)


@glyph("y", 0x0079)
def y(p):
    W = _v_width(p)
    vw = p.stem * 0.96
    w = p.stem * 0.95
    left, _hw, vx0, c = _v_geom(p, W, vw, w)
    # Right stroke: the v's right stroke run on straight to the descender,
    # cut flat there.
    xr_b = W - vx0  # right edge at the baseline
    slope = (W - xr_b) / P.XH
    xr_desc = xr_b + slope * P.DESC
    right, _ = _edge_stroke(xr_desc, P.DESC, W, P.XH, w, side="right")
    shape = left + right
    d1 = _unit(-vx0, P.XH)
    d2 = (-d1[0], d1[1])
    shape = shape - crotch_trap(c, d1, d2, p.trap)
    return G(shape, l=p.sbr * V_SB, r=p.sbr * V_SB, anchors={"top": W / 2})


@glyph("w", 0x0077)
def w(p):
    W = p.w(751, 1.5)
    wo = p.stem * 0.93  # outer strokes
    wi = p.stem * 0.84  # inner strokes
    vw = p.stem * 0.86  # bottom vertices
    aw = p.stem * 0.80  # middle apex
    xv = W * 0.255  # centre of the left bottom vertex
    vx0 = xv - vw / 2
    s1, hw1 = _edge_stroke(vx0, 0, 0, P.XH, wo, side="left")
    # Inner stroke: its right edge leaves the vertex's right corner, its left
    # edge reaches the apex's left corner.
    xt_l = W / 2 - aw / 2
    hw2 = _hw_between(xt_l, vx0 + vw, wi, 1, P.XH)
    xb_l = vx0 + vw - hw2
    s2, _ = _edge_stroke(xb_l, 0, xt_l, P.XH, wi, side="left")
    # Trim the feet and the apex to the flat vertices.
    s1 = s1 - _outside((vx0 + vw, 0), (xt_l + hw2, P.XH))
    s2 = s2 - _outside((0, P.XH), (vx0, 0))
    s2 = s2 - _outside((W - xb_l, 0), (W - xt_l, P.XH))
    half = s1 + s2
    shape = half + half.flip_x(W / 2)
    d_out = _unit(-vx0, P.XH)  # stroke 1 runs up-left from its foot
    d_in = _unit(xt_l - xb_l, P.XH)  # stroke 2 runs up-right
    # Bottom crotch: stroke 1's right edge meets stroke 2's left edge.
    c1 = _isect((vx0 + hw1, 0), d_out, (xb_l, 0), d_in)
    trap = crotch_trap(c1, d_out, d_in, p.trap)
    shape = shape - trap - trap.flip_x(W / 2)
    # Apex crotch: stroke 2's right edge meets stroke 3's left edge, below.
    c2 = (W / 2, _isect((vx0 + vw, 0), d_in, (W - vx0 - vw, 0), (-d_in[0], d_in[1]))[1])
    shape = shape - crotch_trap(c2, (-d_in[0], -d_in[1]), (d_in[0], -d_in[1]), p.trap)
    return G(shape, l=p.sbr * W_SB, r=p.sbr * W_SB)


@glyph("x", 0x0078)
def x(p):
    Wb = p.w(477, 0.95)  # bottom span
    Wt = Wb - p.w(30, 0.1)  # top span is a touch narrower
    wa = p.stem * 0.95  # falling stroke
    wb_ = p.stem * 0.88  # rising stroke
    inset = (Wb - Wt) / 2
    # Falling stroke: left edge from (inset, XH) to its foot whose right edge
    # is at Wb.
    hw_a = _hw_between(inset, Wb, wa, 1, P.XH)
    fall, _ = _edge_stroke(Wb - hw_a, 0, inset, P.XH, wa, side="left")
    hw_b = _hw_between(Wb - inset, 0, wb_, -1, P.XH)
    rise, _ = _edge_stroke(hw_b, 0, Wb - inset, P.XH, wb_, side="right")
    shape = fall + rise
    return G(shape, l=p.sbr * X_SB, r=p.sbr * X_SB)


@glyph("z", 0x007A)
def z(p):
    W = p.w(410, 0.85)
    inset = p.w(12, 0.05)  # top bar is a touch shorter than the base
    hb = p.hair * 1.0
    wz = p.stem * 0.98
    top_bar = rect(inset, P.XH - hb, W - inset, P.XH)
    base = rect(0, 0, W, hb)
    # Diagonal: lower-right edge through the top bar's end underneath, upper-left
    # edge through the base's left end on top.
    R1 = (W - inset, P.XH - hb)
    L0 = (0, hb)
    D = (R1[0] - L0[0], R1[1] - L0[1])
    Dl = math.hypot(*D)
    phi = math.asin(min(0.999, wz / Dl))
    base_ang = math.atan2(D[1], D[0])
    ang = base_ang + phi  # steeper than D: the upper-left edge passes L0
    d = (math.cos(ang), math.sin(ang))
    # Extend both edges well past the bars and clip.
    ext = 200
    pl0 = (L0[0] - d[0] * ext, L0[1] - d[1] * ext)
    pl1 = (L0[0] + d[0] * (Dl + ext), L0[1] + d[1] * (Dl + ext))
    pr0 = (R1[0] - d[0] * (Dl + ext), R1[1] - d[1] * (Dl + ext))
    pr1 = (R1[0] + d[0] * ext, R1[1] + d[1] * ext)
    diag_s = poly([pl0, pr0, pr1, pl1]) & rect(0, 0, W - inset, P.XH)
    shape = top_bar + base + diag_s
    # The bars are open sides: nearly a full round sidebearing.
    return G(shape, l=p.sbr * 0.9, r=p.sbr * 0.9)
