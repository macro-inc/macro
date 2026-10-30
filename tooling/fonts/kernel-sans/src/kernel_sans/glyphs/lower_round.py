"""Lowercase letters built from a squircle bowl: a b d e g p q s, the
single-storey a.ss01, and ae oe oslash eth thorn germandbls.

b d p q g thorn and a.ss01 share one bowl-on-stem construction (`_bowl_on_stem`):
the bowl's outer contour leaves the stem near its top and bottom like the n
arch, and its counter meets the stem lower down in a crotch that gets an ink
trap. d q g a.ss01 are mirror images of b p.

pathops gotcha: a stem whose straight edge overlaps a squircle's vertical
extreme for a unit or so can make the union drop the curve entirely. Where a
stem continues a curve's side (a, g, germandbls) the two share an edge
exactly instead of overlapping.
"""

import math
from types import SimpleNamespace

from .. import params as P
from ..geom import (
    Shape,
    above,
    below,
    chamfer,
    diag,
    left_of,
    poly,
    rect,
    right_of,
    ring,
    squircle,
    stem_trap,
    stroke,
    superness,
)
from . import G, glyph, ref
from .parts import outer_x, solve_cx

PROOF_TEXT = [
    "nanbndnenpnqnsngn",
    "oaobodoeogoposoqo",
    "badges spaced bodega cabbage gasped passage",
    "nnænnœnnønnðnnþnnßnn ooæooœooøooðooþooßoo",
    "æbcdes œø ðe þønd spæß",
    "badges grasped bagpipes straße æsop œuvre",
]


# ---------------------------------------------------------------------------
# Helpers


def _ox(x0, y0, x1, y1, n, y, side="right"):
    """x where a superellipse filling the box (x0, y0)-(x1, y1) crosses y
    (parts.outer_x with box-order arguments)."""
    return outer_x(x0, x1, y0, y1, n, y, side)


def _oy(x0, y0, x1, y1, n, x, side="top"):
    """y where a superellipse filling the box (x0, y0)-(x1, y1) crosses x."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    t = min(1.0, abs(x - cx) / rx)
    dy = ry * (1 - t**n) ** (1 / n)
    return cy + dy if side == "top" else cy - dy


def _quadrant(box, n, which):
    """Control points of one quadrant of geom.squircle(*box, n): "tl" runs
    from the top point to the left point, "bl" from the left point to the
    bottom point."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    k = superness(n)
    if which == "tl":
        return [
            (cx, cy + ry),
            (cx - k * rx, cy + ry),
            (cx - rx, cy + k * ry),
            (cx - rx, cy),
        ]
    return [
        (cx - rx, cy),
        (cx - rx, cy - k * ry),
        (cx - k * rx, cy - ry),
        (cx, cy - ry),
    ]


def _heavy(p):
    """0 up to Regular, 1 at ExtraBold: how far above Regular the weight is."""
    return max(0.0, p.grow) / (P.STEMS[800] - P.REGULAR_STEM)


def _bez(pts, t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = pts
    m = 1 - t
    a, b, c, d = m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t
    return (a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3)


def _bez_solve(pts, axis, value):
    """Point on a monotonic cubic where coordinate `axis` (0 = x, 1 = y)
    equals value."""
    lo, hi = 0.0, 1.0
    rising = _bez(pts, 1)[axis] > _bez(pts, 0)[axis]
    for _ in range(60):
        mid = (lo + hi) / 2
        if (_bez(pts, mid)[axis] < value) == rising:
            lo = mid
        else:
            hi = mid
    return _bez(pts, (lo + hi) / 2)


def _trap(x, depth, up, counter, n_in):
    """Ink trap where a squircle counter (box `counter`, lying to the RIGHT
    of the stem edge x = x) meets that edge: at the top of the counter when
    `up`, else at its bottom. Like geom.stem_trap, it runs along the stem
    edge for `depth`, but it is fitted to the drawn curve: the crotch is
    found on the actual Bezier, the cut starts just below it on the straight
    edge (no lip), and the far corner sits in the white beyond the curve (no
    sliver). Mirror the result for counters on the left."""
    if depth < 1:
        return Shape()
    sy = 1 if up else -1
    quad = _quadrant(counter, n_in, "tl" if up else "bl")
    _, yc = _bez_solve(quad, 0, x)  # the crotch
    tip = (x - depth * 0.22, yc + sy * depth)
    # Far corner where geom.stem_trap puts it (a near-flat top edge, as in
    # n) when that lies well inside the counter; otherwise, for counters
    # that leave the stem at a shallow angle, just beyond the curve on a
    # ray from the tip.
    b = (x + depth * 0.95, yc + sy * depth * 1.1)
    ytop = quad[0][1] if up else quad[3][1]
    inside = (
        sy * (ytop - b[1]) > 2 and b[0] > _bez_solve(quad, 1, b[1])[0] + depth * 0.2 + 1
    )
    if not inside:
        q = _bez_solve(quad, 1, yc + sy * depth * 0.6)
        b = (q[0] + (q[0] - tip[0]) * 0.6, q[1] + (q[1] - tip[1]) * 0.6)
    e = (x, yc - sy * (2.0 + 0.05 * depth))
    a = (e[0] + (e[0] - tip[0]) * 0.5, e[1] + (e[1] - tip[1]) * 0.5)
    return poly([a, tip, b])


def _bowl_on_stem(p, xl, xr, y0, y1, ws, wt, wb, out_top, in_top, out_bot, in_bot):
    """A squircle bowl to the RIGHT of a stem whose right edge is xl, reaching
    x = xr. Its outer contour meets the stem edge at out_top / out_bot and its
    counter at in_top / in_bot (the crotches). Top and bottom halves are solved
    separately so the two joins can differ; both share the right extreme, so
    the side stays smooth.

    Returns a namespace: shape (the bowl clipped to x >= xl - 1), out and cnt
    (its unclipped outer and counter), out_bot_box (the box of the outer's
    lower half) and traps(depth), both crotches' ink traps."""
    n, n_in = p.sq, p.sq_in
    yc, ry = (y0 + y1) / 2, (y1 - y0) / 2
    yi0, yi1 = y0 + wb, y1 - wt
    yci, ryi = (yi0 + yi1) / 2, (yi1 - yi0) / 2
    xri = xr - ws

    def outer_box(join):
        cx = solve_cx(xr, xl, join, yc, ry, n)
        return (2 * cx - xr, y0, xr, y1)

    def inner_box(join):
        cx = solve_cx(xri, xl, join, yci, ryi, n_in)
        return (2 * cx - xri, yi0, xri, yi1)

    ot, ob = outer_box(out_top), outer_box(out_bot)
    bt, bb = inner_box(in_top), inner_box(in_bot)
    out = (squircle(*ot, n) & above(yc)) + (squircle(*ob, n) & below(yc))
    cnt = (squircle(*bt, n_in) & above(yci)) + (squircle(*bb, n_in) & below(yci))
    shape = (out - cnt) & right_of(xl - 1)

    def traps(depth):
        # Never thinner than 3.5 units, so even Light keeps a clean notch.
        depth = max(depth, 3.5)
        return _trap(xl, depth, True, bt, n_in) + _trap(xl, depth, False, bb, n_in)

    return SimpleNamespace(shape=shape, out=out, cnt=cnt, traps=traps, out_bot_box=ob)


def _bowl_joins(p):
    """Join heights of the x-height bowl of b d p q g, matching the n arch."""
    out_top = P.XH - p.hair * 0.1
    in_top = P.XH - p.hair - P.XH * 0.17
    out_bot = p.hair * 0.1
    in_bot = p.hair + P.XH * 0.17
    return out_top, in_top, out_bot, in_bot


def _b_width(p):
    # A bowl on one stem widens like o (k ~0.6), so heavy weights gain
    # colour rather than width.
    return p.w(496, 0.6)


def _b_body(p, stem_y0, stem_y1, nw=0, sw=0):
    """Stem on the left plus an x-height bowl on the right (b, p, thorn).
    Returns (shape, xr)."""
    s = p.stem
    xl = s
    xr = _b_width(p)
    out_top, in_top, out_bot, in_bot = _bowl_joins(p)
    bowl = _bowl_on_stem(
        p,
        xl,
        xr,
        -P.OS,
        P.XH + P.OS,
        p.stem * 1.03,
        p.hair,
        p.hair,
        out_top,
        in_top,
        out_bot,
        in_bot,
    )
    shape = (
        rect(0, stem_y0, s, stem_y1, nw=nw, sw=sw)
        + bowl.shape
        - bowl.traps(p.trap * 1.3)
    )
    return shape, xr


def _mirror(shape_xr):
    shape, xr = shape_xr
    return shape.flip_x(xr / 2), xr


# ---------------------------------------------------------------------------
# b d p q thorn


@glyph("b", 0x0062)
def b(p):
    shape, _ = _b_body(p, 0, P.ASC, nw=p.cut)
    return G(shape, l=p.sb, r=p.sbr)


@glyph("d", 0x0064)
def d(p):
    # Drawn as b with a nw chamfer; the mirror turns it into ne.
    shape, _ = _mirror(_b_body(p, 0, P.ASC, nw=p.cut))
    return G(shape, l=p.sbr, r=p.sb)


@glyph("p", 0x0070)
def p_(p):
    shape, _ = _b_body(p, P.DESC, P.XH, nw=p.cut, sw=p.cut)
    return G(shape, l=p.sb, r=p.sbr)


@glyph("q", 0x0071)
def q(p):
    shape, _ = _mirror(_b_body(p, P.DESC, P.XH, nw=p.cut, sw=p.cut))
    return G(shape, l=p.sbr, r=p.sb)


@glyph("thorn", 0x00FE)
def thorn(p):
    shape, _ = _b_body(p, P.DESC, P.ASC, nw=p.cut, sw=p.cut)
    return G(shape, l=p.sb, r=p.sbr)


# ---------------------------------------------------------------------------
# a.ss01, g


@glyph("a.ss01")
def a_ss01(p):
    shape, xr = _mirror(_b_body(p, 0, P.XH, nw=p.cut))
    return G(
        shape,
        l=p.sbr,
        r=p.sb,
        anchors={"top": (xr - p.stem) / 2, "bottom": xr - p.stem / 2},
    )


@glyph("g", 0x0067)
def g(p):
    s = p.stem
    yc_t = -40  # where the stem turns into the tail
    shape, xr = _mirror(_b_body(p, yc_t, P.XH, nw=p.cut))
    # Tail: the lower half of a ring whose right side continues the stem,
    # ending on the left in a horizontal cut.
    y0_t = P.DESC - P.OS
    y1_t = 2 * yc_t - y0_t
    x0_t = xr * 0.07
    wb = p.hair * 0.92
    outer = squircle(x0_t, y0_t, xr, y1_t, p.sq)
    inner = squircle(x0_t + s, y0_t + wb, xr - s, y1_t - wb, p.sq_in)
    cx_t = (x0_t + xr) / 2
    y_term = y0_t + wb + 0.45 * (yc_t - y0_t - wb)
    tail = (outer - inner) & (below(yc_t) + left_of(cx_t))
    tail = tail - (left_of(cx_t) & above(y_term))
    tail = tail - chamfer(
        _ox(x0_t, y0_t, xr, y1_t, p.sq, y_term, "left"), y_term, p.cut, "nw"
    )
    return G(shape + tail, l=p.sbr, r=p.sb, anchors={"top": (xr - s) / 2})


# ---------------------------------------------------------------------------
# a


def _a_shape(p, xr, ae_e=None):
    """Double-storey a whose stem's right edge is at xr. Returns (shape,
    hook centre x, stem left x).

    For ae, `ae_e` = (outer box of the e, x of the e's counter at its left
    extreme): the stem then stops above the baseline and the bowl's outer
    contour runs on under it until it disappears inside the e, so the two
    bottoms meet in a clean V instead of a step."""
    s = p.stem
    xs = xr - s
    top = P.XH + P.OS
    # Vertical budget: hook top, upper counter, bowl top, bowl counter,
    # bowl bottom. Strokes thin a little in the bowl so ExtraBold stays open.
    wh = p.hair * 0.96  # hook top
    wt = p.hair * 0.86  # bowl top
    wb = p.hair * 0.92  # bowl bottom
    free = top + P.OS - wh - wt - wb
    c_lo = free * 0.555
    c_up = free - c_lo
    yb1 = -P.OS + wb + c_lo + wt  # bowl outer top
    # Hook: the top of a squircle ring whose right side becomes the stem. It
    # turns straight just above the bowl, so the bowl's crotch meets a truly
    # straight stem edge.
    yc_h = yb1 + 2
    xh0 = xr * 0.045
    wl = s * 0.98
    hb = (xh0, 2 * yc_h - top, xr, top)
    outer = squircle(*hb, p.sq)
    inner = squircle(xh0 + wl, 2 * yc_h - (top - wh), xs, top - wh, p.sq_in)
    cx_h = (xh0 + xr) / 2
    ct = yb1 + c_up * 0.42  # terminal cut
    hook = (outer - inner) & above(yc_h)
    hook = hook - (left_of(cx_h) & below(ct))
    hook = hook - chamfer(_ox(*hb, p.sq, ct, "left"), ct, p.cut, "sw")
    # Lower bowl: drawn as a bowl on the right of a stem at -xs, mirrored.
    yi0, yi1 = -P.OS + wb, yb1 - wt
    in_top, in_bot = yi1 - c_lo * 0.30, yi0 + c_lo * 0.30
    bw = _bowl_on_stem(
        p,
        -xs,
        0,
        -P.OS,
        yb1,
        s * 1.03,
        wt,
        wb,
        out_top=yb1 - wt * 0.08,
        in_top=in_top,
        out_bot=wb * 0.1,
        in_bot=in_bot,
    )
    bowl = bw.shape
    if ae_e is None:
        stem = rect(xs, 0, xr, yc_h)  # shares y = yc_h with the hook
    else:
        ebox, e_in = ae_e
        # Where the e's bottom drops below the bowl's (mirrored) bottom.
        ob = bw.out_bot_box
        lo, hi = xs, e_in
        for _ in range(50):
            mid = (lo + hi) / 2
            if _oy(*ebox, p.sq, mid, "bottom") > _oy(*ob, p.sq, -mid, "bottom"):
                lo = mid
            else:
                hi = mid
        clip = (lo + e_in) / 2
        bowl = (bw.out & right_of(-clip)) - (bw.cnt & right_of(-xs))
        stem = rect(xs, yb1 * 0.4, clip, yc_h)
    # Bowl-join traps, as in n (geom.stem_trap). Exception to the 1.3 *
    # p.trap rule: this counter is short and leaves the stem steeply, so a
    # deeper notch reaches past its top and leaves a barb of black between
    # the curve and the cut at ExtraBold.
    d = p.trap * 0.65
    traps = stem_trap(-xs, in_top, d) + stem_trap(-xs, in_bot, d, up=False)
    shape = hook + bowl.flip_x(0) + stem - traps.flip_x(0)
    return shape, cx_h, xs


@glyph("a", 0x0061)
def a(p):
    xr = p.w(448, 0.6)
    shape, cx_h, _ = _a_shape(p, xr)
    # Accents centre on the hook; an ogonek hangs from the stem.
    return G(
        shape,
        l=p.sbr * 0.95,
        r=p.sb * 0.95,
        anchors={"top": cx_h, "bottom": xr - p.stem / 2},
    )


# ---------------------------------------------------------------------------
# e


def _e_shape(p, x0, w, ws=None):
    """e filling x0..x0+w, carved out of its outer squircle (eye, lower
    counter and aperture removed in one go, so no two edges coincide)."""
    ws = p.stem * 1.02 if ws is None else ws
    heavy = _heavy(p)
    wt = p.hair * (1.04 - 0.04 * heavy)
    x1 = x0 + w
    y0, y1 = -P.OS, P.XH + P.OS
    outer = squircle(x0, y0, x1, y1, p.sq)
    inner = squircle(x0 + ws, y0 + wt, x1 - ws, y1 - wt, p.sq_in)
    # The bar thins a little faster than the other horizontals above Regular
    # (as in Inter) and is placed so the eye keeps a fixed share (0.46) of
    # the white between the top and bottom strokes. A bar centred at a fixed
    # height, or one that rises as it thickens, closes the eye at ExtraBold.
    hb = p.hair * (0.94 - 0.1 * heavy)
    white = (y1 - wt) - (y0 + wt) - hb
    bar_t = y1 - wt - white * 0.46
    bar_b = bar_t - hb
    cx = (x0 + x1) / 2
    cb = P.XH * 0.24  # lower terminal
    eye = inner & above(bar_t)
    low = (inner + (right_of(cx) & above(cb))) & below(bar_b)
    shape = outer - eye - low
    return shape - chamfer(_ox(x0, y0, x1, y1, p.sq, cb, "right"), cb, p.cut, "ne")


@glyph("e", 0x0065)
def e(p):
    # The bar ends flush with the right extreme, so the right side reads
    # nearly as full as o's and gets almost a round sidebearing.
    return G(_e_shape(p, 0, p.w(476, 0.6)), l=p.sbr, r=p.sbr * 0.92)


# ---------------------------------------------------------------------------
# s


def _s_shape(p, w):
    """Two stacked squircle rings: the upper one's bottom stroke and the
    lower one's top stroke are the spine, a little heavier than the other
    horizontals (1.09 x hair) so it holds its own against the sides.
    The upper ring is a touch narrower; the terminals are cut horizontally
    (top at right, bottom at left) with chamfered outer corners."""
    s = p.stem
    heavy = _heavy(p)
    # All three horizontals follow p.hair (which thins relative to the stem
    # above Regular), so the counters stay open at ExtraBold instead of
    # closing to slits. The spine is placed so the upper counter keeps the
    # same share of the white at every weight.
    wsp = p.hair * 1.09
    wt = p.hair * (1.04 - 0.06 * heavy)
    white = P.XH + 2 * P.OS - 2 * wt - wsp
    sp1 = P.XH + P.OS - wt - white * 0.477
    sp0 = sp1 - wsp
    # The sides next to the terminals are 0.94 x stem, so each ring's
    # counter sits 0.03 x stem off its outer centre. The spine's edges hand
    # over from one ring to the other at those centres, where both curves
    # are flat and meet in one node: the top edge at xt (the lower ring's
    # outer, the upper ring's counter), the bottom edge at xb (the upper
    # ring's outer, the lower ring's counter). No patch is needed between
    # them, so no sliver or zero-length segment is left at the joins.
    xt = w / 2
    xb = xt - s * 0.03
    # Upper ring (a little narrower, 0.935 w); its bottom stroke is the spine.
    hu = w * 0.4675
    xu0, xu1 = xb - hu, xb + hu
    ub = (xu0, sp0, xu1, P.XH + P.OS)
    U = squircle(*ub, p.sq) - squircle(
        xu0 + s, sp0 + wsp, xu1 - s * 0.94, P.XH + P.OS - wt, p.sq_in
    )
    ct = P.XH * 0.735
    U = U - (right_of(xt) & below(ct))
    U = U - chamfer(_ox(*ub, p.sq, ct, "right"), ct, p.cut, "se")
    # Lower ring; its top stroke is the spine.
    lb = (0, -P.OS, w, sp1)
    L = squircle(*lb, p.sq) - squircle(s * 0.94, -P.OS + wt, w - s, sp1 - wsp, p.sq_in)
    cb = P.XH * 0.27
    L = L - (left_of(xb) & above(cb))
    L = L - chamfer(_ox(*lb, p.sq, cb, "left"), cb, p.cut, "nw")
    return U + L


@glyph("s", 0x0073)
def s_(p):
    return G(_s_shape(p, p.w(434, 0.6)), l=p.sbr * 0.92, r=p.sbr * 0.92)


# ---------------------------------------------------------------------------
# ae oe oslash


@glyph("ae", 0x00E6)
def ae(p):
    # The e's left side sits inside the a's stem (never tangent to its edge)
    # and its counter starts just right of it.
    s = p.stem
    xr = p.w(436, 0.6)
    xs = xr - s
    ex0, we, ws_e = xs + s * 0.06, p.w(452, 0.6), s
    ebox = (ex0, -P.OS, ex0 + we, P.XH + P.OS)
    a_shape, _, _ = _a_shape(p, xr, ae_e=(ebox, ex0 + ws_e))
    e_shape = _e_shape(p, ex0, we, ws=ws_e)
    return G(a_shape + e_shape, l=p.sbr * 0.95, r=p.sbr * 0.92)


@glyph("oe", 0x0153)
def oe(p):
    # The e's left side overlaps the o's right side; neither curve touches
    # the other's counter.
    wo = p.w(466, 0.6)
    ws = p.stem * 1.04
    o_shape = ring(0, -P.OS, wo, P.XH + P.OS, ws, p.hair, n=p.sq, n_in=p.sq_in)
    e_shape = _e_shape(p, wo - ws * 0.92, p.w(456, 0.6), ws=ws)
    return G(o_shape + e_shape, l=p.sbr, r=p.sbr * 0.92)


@glyph("oslash", 0x00F8)
def oslash(p):
    o = ref("o")
    x0, _, x1, _ = o.shape.bounds()
    w = x1 - x0
    over = 44
    slash = diag(
        x0 + w * 0.12, -P.OS - over, x1 - w * 0.12, P.XH + P.OS + over, p.hair * 0.85
    )
    return G(o.shape + slash, l=p.sbr, r=p.sbr)


# ---------------------------------------------------------------------------
# eth


@glyph("eth", 0x00F0)
def eth(p):
    # The bowl is a little lower than o so the crossing stroke clears it at
    # every weight (it must never touch the bowl, or the masters would stop
    # matching).
    w = p.w(478, 0.6)
    ws = p.stem * 1.04
    bt = P.XH * 0.95 + P.OS
    bowl = ring(0, -P.OS, w, bt, ws, p.hair, n=p.sq, n_in=p.sq_in)
    # Ascender: the upper right of a tall, wide ring sharing the bowl's
    # right extreme, so it leans left as it rises and hooks over the bowl,
    # ending in a vertical cut (the stroke travels left there) just left of
    # the ring's top point.
    yc = (bt - P.OS) / 2
    top = P.ASC + P.OS * 0.8
    heavy = _heavy(p)
    wr = p.hair * (0.82 - 0.06 * heavy)
    xR0 = -w * 0.15  # a wide ring, so the ascender leans and the hook opens
    cxR, rxR = (xR0 + w) / 2, (w - xR0) / 2
    xt = cxR - rxR * 0.1  # just left of the ring's top point
    rb = (xR0, 2 * yc - top, w, top)
    ri = (xR0 + ws, 2 * yc - top + wr, w - ws, top - wr)
    R = squircle(*rb, p.sq) - squircle(*ri, p.sq_in)
    R = R & above(yc) & right_of(xt)
    R = R - chamfer(xt, _oy(*rb, p.sq, xt), p.cut, "nw")
    # Crossing stroke, centred on the ascender's centreline, halfway between
    # the bowl and the ascender's top stroke.
    hb = p.hair * (0.72 - 0.12 * heavy)
    yb = (bt + top - wr) / 2 + 8
    xm = (_ox(*rb, p.sq, yb, "right") + _ox(*ri, p.sq_in, yb, "right")) / 2
    ang = math.radians(9)
    c, s_ = math.cos(ang), math.sin(ang)
    left = ws * 0.35 + w * 0.15
    right = min(ws * 0.5 + w * 0.07, (w - 6 - xm) / c)
    bar = stroke((xm - left * c, yb - left * s_), (xm + right * c, yb + right * s_), hb)
    return G(bowl + R + bar, l=p.sbr, r=p.sbr)


# ---------------------------------------------------------------------------
# germandbls


@glyph("germandbls", 0x00DF)
def germandbls(p):
    """Stem rising into an arch; the upper bowl's right side runs down into
    the waist, which is the top stroke of the lower bowl. The waist stops
    short of the stem and the lower bowl ends in a vertical cut near it.

    The lower bowl's left half comes from a much wider squircle than its
    right half (they meet at the shared top and bottom points), so the waist
    and the bottom stroke are nearly flat where they end."""
    s = p.stem
    W = p.w(508, 0.9)
    top = P.ASC + P.OS * 0.8
    hw = p.hair
    # Wide enough that the terminal never reads as touching the stem at
    # Light and Regular (B-like) at text sizes.
    gap = p.w(62, 0.1)
    x_end = s + gap  # free ends of the waist and the bottom stroke
    # Lower bowl, its top stroke is the waist.
    yl1 = P.ASC * 0.565 + hw / 2
    cxl = W * 0.52
    ws_l = s * 1.03

    def lower_ring(x0, x1):
        return squircle(x0, -P.OS, x1, yl1, p.sq) - squircle(
            x0 + ws_l, -P.OS + hw, x1 - ws_l, yl1 - hw, p.sq_in
        )

    wide = cxl + W * 0.9
    lb_left = (cxl - wide, -P.OS, cxl + wide, yl1)
    L = (lower_ring(2 * cxl - W, W) & right_of(cxl)) + (
        lower_ring(cxl - wide, cxl + wide) & left_of(cxl) & right_of(x_end)
    )
    L = L - chamfer(x_end, _oy(*lb_left, p.sq, x_end, "bottom"), p.cut, "sw")
    # Upper bowl: a ring whose left side is the stem; its right side ends
    # inside the waist.
    xu1 = W * 0.82
    yu0 = yl1 - hw - 40
    U = squircle(0, yu0, xu1, top, p.sq) - squircle(
        s, yu0 + hw, xu1 - s * 0.98, top - hw, p.sq_in
    )
    ycu = (yu0 + top) / 2
    cxu = xu1 / 2
    U = U & (above(ycu) + (right_of(cxu) & above(yl1 - hw / 2)))
    stem = rect(
        0, 0, s, ycu
    )  # shares y = ycu with the arch; an overlap breaks the union
    return G(stem + U + L, l=p.sb, r=p.sbr)
