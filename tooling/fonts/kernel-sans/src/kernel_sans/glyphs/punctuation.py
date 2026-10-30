"""Punctuation and symbols: dots and commas, quotes, dashes, brackets,
slashes, guillemets, @ & § ¶ © ® ™, daggers, bullets and arrows.

Everything that has a dot uses the period's square (`geom.dot`, side
`p.dot`); commas and quotes are that square with a wedge tail. Curves are
squircles, free stroke ends get the house 45° chamfer, and arrow and
guillemet tips are cut flat across their point.
"""

import math

from .. import params as P
from ..geom import (
    Shape,
    above,
    band,
    below,
    chamfer,
    diag,
    dot,
    half_plane,
    hwidth,
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
from .parts import open_bowl, outer_x

PROOF_TEXT = [
    "H.H,H:H;H!H?H n.n,n:n;n!n?n",
    "“Quoted” ‘text’ — (parens) [brackets] {braces}",
    "hello@macro.com  R&D  A→B ← ↑ ↓ ↗ ↘ ↔ © ® ™ § ¶",
    "(HOH) [HOH] {HOH} «HOH» ‹n› H–H—H n-n H/O\\n n|n ¦",
    "n*n † ‡ • n·n n… ¿n? ¡n! „non“ ‚non‘ 'n' \"n\" n_n",
]

SQ2 = math.sqrt(2)


# ---------------------------------------------------------------------------
# Shared helpers


def _period(p):
    """(dot side, period sidebearing, period advance)."""
    s = p.dot
    sb = p.sb * 0.95
    return s, sb, s + 2 * sb


def _sq_y(x0, y0, x1, y1, n, x, side="top"):
    """y where a superellipse filling the box crosses x (top or bottom)."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    t = min(1.0, abs(x - cx) / rx)
    dy = ry * (1 - t**n) ** (1 / n)
    return cy + dy if side == "top" else cy - dy


def _comma(p, x0, y0):
    """The comma: the period's square at (x0, y0) with a wedge tail growing
    down and to the left from its bottom edge."""
    s = p.dot
    c = s * 0.3
    tail = s * 0.55 + 85  # length of the tail below the square
    tw = s * 0.34  # width of the flat tail end
    tl = x0 - s * 0.06  # left corner of the tail end
    return poly([
        (x0, y0 + s - c),
        (x0 + c, y0 + s),
        (x0 + s, y0 + s),
        (x0 + s, y0),
        (tl + tw, y0 - tail),
        (tl, y0 - tail),
        (x0, y0),
    ])


def _comma_depth(p):
    return p.dot * 0.55 + 85


def _gap(p):
    """Gap between the stroke of ! ? and their dot."""
    return p.dot * 0.3 + 60


def _chevron(tip_x, yc, h, dx, w, flat, pointing="left"):
    """A guillemet chevron: two diagonal strokes of perpendicular thickness
    w meeting at a point at (tip_x, yc), ends cut horizontally at
    yc +- h/2, the point cut flat by `flat`."""
    hh = h / 2
    k = 4.0
    xiv = tip_x + w * math.hypot(dx, hh) / hh  # inner vertex
    outer = poly([(tip_x, yc), (tip_x + k * dx, yc + k * hh), (tip_x + k * dx, yc - k * hh)])
    inner = poly([(xiv, yc), (xiv + k * dx, yc + k * hh), (xiv + k * dx, yc - k * hh)])
    shape = (outer - inner) & band(yc - hh, yc + hh)
    shape = shape - left_of(tip_x + flat)
    if pointing == "right":
        shape = shape.flip_x(tip_x)
    return shape


def _arrow(p, length, heads=(True, False)):
    """A horizontal arrow along +x from x = 0 to x = length at y = 0, with an
    open chevron head at the right (heads[0]) and/or left (heads[1]) end.
    The shaft and arms have thickness t; arm ends are square to the arm;
    the point is cut flat (which reads as the house chamfer on diagonals)."""
    t = p.hair * 1.1
    arm = 190 + 0.55 * t  # arm length along its outer edge
    flat = max(4.0, p.cut * 0.62)  # depth of the cut across the point
    k = 1200

    def head(tip):
        # A chevron pointing to +x whose geometric point is at (tip, 0).
        outer = poly([(tip, 0), (tip - k, k), (tip - k, -k)])
        inner_x = tip - t * SQ2
        inner = poly([(inner_x, 0), (inner_x - k, k), (inner_x - k, -k)])
        h = outer - inner
        for sy in (1, -1):
            ux, uy = -1 / SQ2, sy / SQ2  # along the arm, away from the point
            ex, ey = tip + arm * ux, arm * uy
            # Everything past the arm end; half_plane keeps the left of
            # (ex, ey) -> (ex + uy, ey - ux), whose left normal is u.
            h = h - half_plane((ex, ey), (ex + uy, ey - ux))
        return h - right_of(tip - flat)

    s0, s1 = 0.0, length
    shape = Shape()
    if heads[0]:
        shape = shape + head(length + flat)
        s1 = length + flat - t * 1.2
    if heads[1]:
        shape = shape + head(flat).flip_x(0)
        s0 = -flat + t * 1.2
    return shape + rect(s0, -t / 2, s1, t / 2)


def _rotate_arrow(shape, deg):
    return shape.rotate(deg, 0, 0)


# ---------------------------------------------------------------------------
# Dots, commas, quotes


@glyph("comma", 0x002C)
def comma(p):
    s, sb, adv = _period(p)
    return G(_comma(p, sb, 0), width=adv)


@glyph("colon", 0x003A)
def colon(p):
    per = ref("period")
    s = p.dot
    return G(per.shape + per.shape.move(0, P.XH - s), width=per.width)


@glyph("semicolon", 0x003B)
def semicolon(p):
    s, sb, adv = _period(p)
    shape = _comma(p, sb, 0) + dot(sb + s / 2, P.XH - s / 2, s)
    return G(shape, width=adv)


@glyph("periodcentered", 0x00B7)
def periodcentered(p):
    s, sb, adv = _period(p)
    return G(dot(sb + s / 2, P.AXIS, s), width=adv)


@glyph("ellipsis", 0x2026)
def ellipsis(p):
    s, sb, adv = _period(p)
    pitch = s + 2 * sb * 0.82
    shape = Shape()
    for i in range(3):
        shape = shape + dot(sb + s / 2 + i * pitch, s / 2, s)
    return G(shape, width=2 * sb + 2 * pitch + s)


@glyph("exclam", 0x0021)
def exclam(p):
    s = p.dot
    w = p.stem * 1.05
    cx = s / 2
    stem = rect(cx - w / 2, s + _gap(p), cx + w / 2, P.CAP, nw=0.36 * w)
    sb = p.sb * 0.95
    return G(stem + dot(cx, s / 2, s), l=sb, r=sb)


@glyph("exclamdown", 0x00A1)
def exclamdown(p):
    g = ref("exclam")
    b = g.shape.bounds()
    shape = g.shape.rotate180((b[0] + b[2]) / 2, P.XH / 2)
    return G(shape, width=g.width)


def _ring_part(x0, y0, x1, y1, ix0, iy0, ix1, iy1, n, n_in, clip):
    """(outer squircle - inner squircle) & clip, for building curves from
    quadrants whose inner box is not simply inset."""
    return (squircle(x0, y0, x1, y1, n) - squircle(ix0, iy0, ix1, iy1, n_in)) & clip


def _question(p):
    """? : a squircle hook whose left terminal is cut flat and chamfered;
    its right side sweeps down into the stem through two squircle quadrants
    (an S), so the stem grows out of the curve instead of sitting under it."""
    s = p.dot
    w = p.stem * 1.05  # stem, as in exclam
    W = p.w(400, 1.5)
    ws, wt = p.stem * 1.04, p.hair * 1.04
    top = P.CAP + P.COS
    n, n_in = p.sq, p.sq_in
    xs_c = W * 0.46  # stem centre, a little left as in Inter and SF
    xs0, xs1 = xs_c - w / 2, xs_c + w / 2
    xa = (xs1 + W - ws) / 2  # where the lower curve turns from one quadrant to the next
    y_sb = s + _gap(p)  # stem bottom
    yb_c = y_sb + 16  # stem top, where the lower quadrant starts
    ry_b = (xa - xs0) * 0.9
    top_b = yb_c + ry_b
    ya = top_b - wt  # bottom of the hook's outer box
    cy = (ya + top) / 2
    # Upper hook: top half, left side down to the terminal (kept clear of
    # the squircle's quadrant join at cy so the outline is the same at every
    # weight).
    y_cut = cy - p.cut - (top - cy) * 0.06
    hook = ring(0, ya, W, top, ws, wt, n=n, n_in=n_in)
    hook = hook - (left_of(W / 2) & below(y_cut)) - (right_of(W / 2) & below(cy))
    xt = outer_x(0, W, ya, top, n, y_cut, side="left")
    hook = hook - chamfer(xt, y_cut, p.cut, "sw")
    # Right side down into the bottom of the S (bottom-right quadrant). The
    # pieces meet exactly where their tangents agree.
    qa = _ring_part(
        2 * xa - W, ya, W, top, 2 * xa - (W - ws), ya + wt, W - ws, top - wt, n, n_in,
        below(cy) & right_of(xa),
    )
    # From the bottom of the S down into the stem (top-left quadrant).
    qb = _ring_part(
        xs0, 2 * yb_c - top_b, 2 * xa - xs0, top_b,
        xs1, 2 * yb_c - ya, 2 * xa - xs1, ya, n, n_in,
        left_of(xa) & above(yb_c),
    )
    stem = rect(xs0, y_sb, xs1, yb_c)
    return hook + qa + qb + stem + dot(xs_c, s / 2, s)


@glyph("question", 0x003F)
def question(p):
    return G(_question(p), l=p.sbr * 0.9, r=p.sbr * 1.0)


@glyph("questiondown", 0x00BF)
def questiondown(p):
    g = ref("question")
    b = g.shape.bounds()
    shape = g.shape.rotate180((b[0] + b[2]) / 2, P.XH / 2)
    return G(shape, l=p.sbr * 1.0, r=p.sbr * 0.9)


def _quote(p, x0):
    """quoteright drawn with its square at x0 and its top at cap height."""
    s = p.dot
    return _comma(p, x0, P.CAP - s)


def _quote_pitch(p):
    return p.dot + p.dot * 0.5 + 34


def _qsb(p):
    return p.sb * 0.95, p.sb * 0.75


@glyph("quoteright", 0x2019)
def quoteright(p):
    l, r = _qsb(p)
    return G(_quote(p, 0), l=l, r=r)


@glyph("quoteleft", 0x2018)
def quoteleft(p):
    l, r = _qsb(p)
    sh = _quote(p, 0)
    b = sh.bounds()
    return G(sh.rotate180((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), l=l, r=r)


@glyph("quotesinglbase", 0x201A)
def quotesinglbase(p):
    l, r = _qsb(p)
    return G(_comma(p, 0, 0), l=l, r=r)


@glyph("quotedblright", 0x201D)
def quotedblright(p):
    l, r = _qsb(p)
    sh = _quote(p, 0) + _quote(p, _quote_pitch(p))
    return G(sh, l=l, r=r)


@glyph("quotedblleft", 0x201C)
def quotedblleft(p):
    l, r = _qsb(p)
    sh = _quote(p, 0) + _quote(p, _quote_pitch(p))
    b = sh.bounds()
    return G(sh.rotate180((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), l=l, r=r)


@glyph("quotedblbase", 0x201E)
def quotedblbase(p):
    l, r = _qsb(p)
    sh = _comma(p, 0, 0) + _comma(p, _quote_pitch(p), 0)
    return G(sh, l=l, r=r)


def _tick(p, x0):
    """A straight quote: a slightly tapered vertical tick from cap height."""
    w = p.stem * 1.0
    h = P.CAP * 0.36
    wb = w * 0.72
    cx = x0 + w / 2
    c = 0.36 * w
    sh = poly([
        (cx - wb / 2, P.CAP - h),
        (cx + wb / 2, P.CAP - h),
        (cx + w / 2, P.CAP),
        (cx - w / 2 + c, P.CAP),
        (cx - w / 2 + c * 0.1, P.CAP - c * 0.9),
    ])
    return sh


@glyph("quotesingle", 0x0027)
def quotesingle(p):
    return G(_tick(p, 0), l=p.sb * 1.25, r=p.sb * 1.25)


@glyph("quotedbl", 0x0022)
def quotedbl(p):
    pitch = p.stem + p.stem * 0.6 + 60
    return G(_tick(p, 0) + _tick(p, pitch), l=p.sb * 1.25, r=p.sb * 1.25)


# ---------------------------------------------------------------------------
# Guillemets


def _guil_dims(p):
    h = P.XH * 0.6
    dx = h * 0.42
    w = p.stem * 0.92
    flat = p.cut * 0.5
    return h, dx, w, flat


def _guil(p, yc, double=False, pointing="left"):
    h, dx, w, flat = _guil_dims(p)
    shape = _chevron(0, yc, h, dx, w, flat)
    if double:
        b = shape.bounds()
        pitch = (b[2] - b[0]) * 0.62 + 30
        shape = shape + shape.move(pitch, 0)
    if pointing == "right":
        b = shape.bounds()
        shape = shape.flip_x((b[0] + b[2]) / 2)
    return shape


def _guil_sb(p):
    return p.sb * 0.75, p.sb * 0.6


@glyph("guilsinglleft", 0x2039)
def guilsinglleft(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.AXIS), l=l, r=r)


@glyph("guilsinglright", 0x203A)
def guilsinglright(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.AXIS, pointing="right"), l=r, r=l)


@glyph("guillemotleft", 0x00AB)
def guillemotleft(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.AXIS, double=True), l=l, r=r)


@glyph("guillemotright", 0x00BB)
def guillemotright(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.AXIS, double=True, pointing="right"), l=r, r=l)


@glyph("guilsinglleft.case")
def guilsinglleft_case(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.CASE_AXIS), l=l, r=r)


@glyph("guilsinglright.case")
def guilsinglright_case(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.CASE_AXIS, pointing="right"), l=r, r=l)


@glyph("guillemotleft.case")
def guillemotleft_case(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.CASE_AXIS, double=True), l=l, r=r)


@glyph("guillemotright.case")
def guillemotright_case(p):
    l, r = _guil_sb(p)
    return G(_guil(p, P.CASE_AXIS, double=True, pointing="right"), l=r, r=l)


# ---------------------------------------------------------------------------
# Dashes


def _dash(p, length, yc, sb):
    t = p.hair * 1.05
    return G(rect(0, yc - t / 2, length, yc + t / 2), l=sb, r=sb)


@glyph("hyphen", 0x002D, 0x00AD)
def hyphen(p):
    return _dash(p, p.w(214, 0.5), P.AXIS, p.sb * 0.82)


@glyph("endash", 0x2013)
def endash(p):
    return _dash(p, p.w(440, 0.2), P.AXIS, 30)


@glyph("emdash", 0x2014)
def emdash(p):
    return _dash(p, 940, P.AXIS, 30)


@glyph("hyphen.case")
def hyphen_case(p):
    return _dash(p, p.w(214, 0.5), P.CASE_AXIS, p.sb * 0.82)


@glyph("endash.case")
def endash_case(p):
    return _dash(p, p.w(440, 0.2), P.CASE_AXIS, 30)


@glyph("emdash.case")
def emdash_case(p):
    return _dash(p, 940, P.CASE_AXIS, 30)


@glyph("underscore", 0x005F)
def underscore(p):
    t = p.hair * 1.05
    w = p.w(500, 0.3)
    return G(rect(0, -60 - t, w, -60), width=w)


# ---------------------------------------------------------------------------
# Brackets

BR_LO, BR_HI = -140, 800  # vertical span of brackets, parens and braces
CASE_SHIFT = 40


def _paren(p, dy=0):
    ws = p.stem * 0.95
    wt = p.hair * 1.02
    rx = p.w(250, 0.5)
    y0, y1 = BR_LO + dy, BR_HI + dy
    n, n_in = p.sq, p.sq_in
    sh = ring(0, y0, 2 * rx, y1, ws, wt, n=n, n_in=n_in)
    xc = rx * 0.78
    sh = sh & left_of(xc)
    for side, corner in (("top", "ne"), ("bottom", "se")):
        yo = _sq_y(0, y0, 2 * rx, y1, n, xc, side)
        sh = sh - chamfer(xc, yo, p.cut, corner)
    return sh


def _paren_sb(p):
    return p.sbr * 1.35, p.sbr * 0.7


@glyph("parenleft", 0x0028)
def parenleft(p):
    l, r = _paren_sb(p)
    return G(_paren(p), l=l, r=r)


@glyph("parenright", 0x0029)
def parenright(p):
    l, r = _paren_sb(p)
    return G(_paren(p).flip_x(0), l=r, r=l)


@glyph("parenleft.case")
def parenleft_case(p):
    l, r = _paren_sb(p)
    return G(_paren(p, CASE_SHIFT), l=l, r=r)


@glyph("parenright.case")
def parenright_case(p):
    l, r = _paren_sb(p)
    return G(_paren(p, CASE_SHIFT).flip_x(0), l=r, r=l)


def _bracket(p, dy=0):
    ws = p.stem * 0.95
    wt = p.hair * 1.0
    arm = p.w(200, 0.5)
    y0, y1 = BR_LO + dy, BR_HI + dy
    return rect(0, y0, ws, y1) + rect(ws - 1, y1 - wt, arm, y1) + rect(ws - 1, y0, arm, y0 + wt)


def _bracket_sb(p):
    return p.sb * 1.35, p.sb * 0.75


@glyph("bracketleft", 0x005B)
def bracketleft(p):
    l, r = _bracket_sb(p)
    return G(_bracket(p), l=l, r=r)


@glyph("bracketright", 0x005D)
def bracketright(p):
    l, r = _bracket_sb(p)
    return G(_bracket(p).flip_x(0), l=r, r=l)


@glyph("bracketleft.case")
def bracketleft_case(p):
    l, r = _bracket_sb(p)
    return G(_bracket(p, CASE_SHIFT), l=l, r=r)


@glyph("bracketright.case")
def bracketright_case(p):
    l, r = _bracket_sb(p)
    return G(_bracket(p, CASE_SHIFT).flip_x(0), l=r, r=l)


def _brace(p, dy=0):
    """{ with chamfered corners and a sharp angular point in the middle."""
    tv = p.stem * 0.92  # vertical strokes
    th = p.hair * 0.98  # arms
    d2 = tv * 0.95  # perpendicular thickness of the point's diagonals
    y0, y1 = BR_LO + dy, BR_HI + dy
    ym = (y0 + y1) / 2
    xs = 78 + 0.25 * p.grow  # stem's outer edge (the point is at x = 0)
    j = 120 + 0.2 * p.grow  # half height of the point
    xe = xs + tv + p.w(78, 0.3)  # arm end
    co = (tv + th) * 0.62  # outer corner chamfer leg
    dc = (tv + th) / 2  # thickness across the corner chamfer
    ci = co + dc * SQ2 - tv - th  # inner chamfer leg
    L = math.hypot(xs, j)
    xi = d2 * L / j  # inner vertex of the point
    jj = (xs + tv - xi) * j / xs
    xin = xs + tv
    pts = [
        (xe, y1),
        (xs + co, y1),
        (xs, y1 - co),
        (xs, ym + j),
        (0, ym),
        (xs, ym - j),
        (xs, y0 + co),
        (xs + co, y0),
        (xe, y0),
        (xe, y0 + th),
        (xin + ci, y0 + th),
        (xin, y0 + th + ci),
        (xin, ym - jj),
        (xi, ym),
        (xin, ym + jj),
        (xin, y1 - th - ci),
        (xin + ci, y1 - th),
        (xe, y1 - th),
    ]
    return poly(pts)


def _brace_sb(p):
    return p.sb * 0.9, p.sb * 0.75


@glyph("braceleft", 0x007B)
def braceleft(p):
    l, r = _brace_sb(p)
    return G(_brace(p), l=l, r=r)


@glyph("braceright", 0x007D)
def braceright(p):
    l, r = _brace_sb(p)
    return G(_brace(p).flip_x(0), l=r, r=l)


@glyph("braceleft.case")
def braceleft_case(p):
    l, r = _brace_sb(p)
    return G(_brace(p, CASE_SHIFT), l=l, r=r)


@glyph("braceright.case")
def braceright_case(p):
    l, r = _brace_sb(p)
    return G(_brace(p, CASE_SHIFT).flip_x(0), l=r, r=l)


# ---------------------------------------------------------------------------
# Slashes and bars

SL_LO, SL_HI = -140, P.ASC


@glyph("slash", 0x002F)
def slash(p):
    run = p.w(300, 0.4)
    sh = diag(0, SL_LO, run, SL_HI, p.stem * 0.95)
    return G(sh, l=p.sb * 0.3, r=p.sb * 0.3)


@glyph("backslash", 0x005C)
def backslash(p):
    run = p.w(300, 0.4)
    sh = diag(run, SL_LO, 0, SL_HI, p.stem * 0.95)
    return G(sh, l=p.sb * 0.3, r=p.sb * 0.3)


@glyph("bar", 0x007C)
def bar(p):
    w = p.stem * 0.92
    c = 0.36 * w
    return G(rect(0, BR_LO, w, BR_HI, nw=c, sw=c), l=p.sb * 1.5, r=p.sb * 1.5)


@glyph("brokenbar", 0x00A6)
def brokenbar(p):
    w = p.stem * 0.92
    c = 0.36 * w
    gap = 90 + 0.3 * p.grow
    mid = (BR_LO + BR_HI) / 2
    sh = rect(0, mid + gap / 2, w, BR_HI, nw=c) + rect(0, BR_LO, w, mid - gap / 2, sw=c)
    return G(sh, l=p.sb * 1.5, r=p.sb * 1.5)


# ---------------------------------------------------------------------------
# Daggers, asterisk, bullets


@glyph("asterisk", 0x002A)
def asterisk(p):
    t = p.hair * 0.98
    r = 172 + 0.3 * p.grow
    cy = P.CAP - 150
    sh = Shape()
    for a in (90, 30, 150):
        ra = math.radians(a)
        dx, dy = r * math.cos(ra), r * math.sin(ra)
        sh = sh + stroke((-dx, cy - dy), (dx, cy + dy), t)
    return G(sh, l=p.sb * 0.75, r=p.sb * 0.75)


def _dagger(p, double=False):
    w = p.stem * 0.9
    t = p.hair * 0.95
    half = p.w(165, 0.4)
    y0, y1 = -120, P.CAP
    c = 0.36 * w
    sh = rect(-w / 2, y0, w / 2, y1, nw=c, sw=c)
    yb = y1 - 220
    sh = sh + rect(-half, yb - t / 2, half, yb + t / 2)
    if double:
        yb2 = y0 + 220
        sh = sh + rect(-half, yb2 - t / 2, half, yb2 + t / 2)
    return sh


@glyph("dagger", 0x2020)
def dagger(p):
    return G(_dagger(p), l=p.sb * 0.8, r=p.sb * 0.8)


@glyph("daggerdbl", 0x2021)
def daggerdbl(p):
    return G(_dagger(p, True), l=p.sb * 0.8, r=p.sb * 0.8)


def _bullet(p, yc):
    side = p.dot + 90
    return dot(0, yc, side)


@glyph("bullet", 0x2022)
def bullet(p):
    return G(_bullet(p, P.AXIS), l=p.sb * 1.2, r=p.sb * 1.2)


@glyph("bullet.case")
def bullet_case(p):
    return G(_bullet(p, P.CASE_AXIS), l=p.sb * 1.2, r=p.sb * 1.2)


# ---------------------------------------------------------------------------
# @ & § ¶


@glyph("at", 0x0040)
def at(p):
    """@ : a single-storey a inside a squircle ring. The ring's right side
    runs straight down and hooks into the foot of the a's stem; below the
    hook the ring is open. The ring's terminal ends travelling sideways, so
    it is cut vertically with the house chamfer on its outer corner."""
    W = p.w(840, 1.5)
    y0, y1 = -150, 730
    cy = (y0 + y1) / 2
    n, n_in = p.sq, p.sq_in
    ws, wt = p.stem * 0.98, p.hair * 0.98  # ring
    st = p.stem  # the a's stem
    hook_w = p.w(250, 0.3)  # from the stem's right edge to the ring's outer right
    xr = W - hook_w
    xs = xr - st
    ha = 480 + 0.2 * p.grow
    oy0, oy1 = cy - ha / 2 - P.OS, cy + ha / 2 + P.OS  # the a, with overshoots
    xa0 = xr - p.w(372, 0.8)
    # Ring, open at the lower right.
    x_cut = W * 0.73
    ringsh = ring(0, y0, W, y1, ws, wt, n=n, n_in=n_in) - (right_of(x_cut) & below(cy))
    ringsh = ringsh - chamfer(x_cut, _sq_y(0, y0, W, y1, n, x_cut, "bottom"), p.cut, "se")
    # The right side continues straight down, then hooks into the stem's foot.
    yh = oy0 + hook_w * 0.62
    side = rect(W - ws, yh, W, cy)
    hook = _ring_part(
        2 * xr - W, oy0, W, 2 * yh - oy0, 2 * xr - (W - ws), oy0 + wt, W - ws, 2 * yh - oy0 - wt,
        n, n_in, below(yh) & right_of(xr - 1),
    )
    # The a: bowl and stem; the counter meets the stem at an angle (ink traps).
    wsb = p.stem * 1.03
    ix1 = xs + st * 0.25
    iy0, iy1 = oy0 + p.hair, oy1 - p.hair
    bowl = _ring_part(xa0, oy0, ix1 + wsb, oy1, xa0 + wsb, iy0, ix1, iy1, n, n_in, left_of(xs + 1))
    stem = rect(xs, oy0, xr, oy1, ne=p.cut)
    sh = ringsh + side + hook + bowl + stem
    yt = _sq_y(xa0 + wsb, iy0, ix1, iy1, n_in, xs, "top")
    yb = _sq_y(xa0 + wsb, iy0, ix1, iy1, n_in, xs, "bottom")
    sh = sh - stem_trap(xs, yt, p.trap, side="left", up=True) - stem_trap(xs, yb, p.trap, side="left", up=False)
    return G(sh, l=p.sbr, r=p.sbr)


def _tangent_point(x0, y0, x1, y1, n, slope):
    """Point on the lower-left quadrant of the superellipse filling the box
    where its tangent has the given (negative) slope."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = (x1 - x0) / 2, (y1 - y0) / 2
    a = 2 / n
    tan_t = (abs(slope) * rx / ry) ** (1 / (a - 2))
    t = math.atan(tan_t)
    return cx - rx * math.cos(t) ** a, cy - ry * math.sin(t) ** a


AMP = dict(lx=500, lxk=1.0, uw=250, uwk=1.2, m=-1.35, foot=40, footk=0.0, ytail=0.44)


@glyph("ampersand", 0x0026)
def ampersand(p):
    """& : a closed squircle loop sitting on a larger bowl that opens at the
    upper right into the tail; a straight leg leaves the loop tangentially
    on the left and runs through the bowl to the baseline."""
    a = AMP
    ws, wt = p.cstem * 0.95, p.chair * 0.95
    n, n_in = p.sq * 0.92, p.sq_in * 0.95
    top = P.CAP + P.COS
    # Lower bowl.
    lx1 = p.w(a["lx"], a["lxk"])
    ly1 = P.CAP * 0.6
    lower = ring(0, -P.COS, lx1, ly1, ws, wt, n=n, n_in=n_in)
    # Upper loop, its bottom on the bowl's top; placed so the leg's foot
    # lands `foot` past the bowl.
    uw = p.w(a["uw"], a["uwk"])
    uy0 = ly1 - wt
    m = a["m"]
    dw = p.cstem * 0.95
    hw = dw * math.hypot(1, m) / abs(m)
    tx0, ty = _tangent_point(0, uy0, uw, top, n, m)
    # The leg's foot sits on the bowl's overshoot line, so the bowl always
    # meets the leg's side in a crotch rather than crossing its flat foot.
    yf = -P.COS
    foot = lx1 + a["foot"] + a["footk"] * p.grow
    ux0 = foot - (tx0 + (ty - yf) / abs(m) + hw)
    tx = ux0 + tx0
    lws = ws * 0.92
    upper = ring(ux0, uy0, ux0 + uw, top, lws, wt, n=n, n_in=n_in)
    counter = squircle(ux0 + lws, uy0 + wt, ux0 + uw - lws, top - wt, n_in)
    leg = poly([(foot - hw, yf), (foot, yf), (tx + hw, ty), (tx, ty)]) - counter
    # Open the bowl at the upper right; its top stroke ends inside the leg.
    y_open = ly1 - wt / 2
    x_open = tx + hw / 2 + (ty - y_open) / abs(m)
    y_tail = P.CAP * a["ytail"]
    lower = lower - (right_of(x_open) & above(y_tail))
    xt = outer_x(0, lx1, -P.COS, ly1, n, y_tail, "right")
    lower = lower - chamfer(xt, y_tail, p.ccut, "ne")
    return G(lower + upper + leg, l=p.sbr * 0.9, r=p.sbr * 0.3)


@glyph("section", 0x00A7)
def section(p):
    """§ : a closed squircle ring in the middle; the top arc runs straight
    down into its left side and the bottom arc (the same, turned) into its
    right side. Terminals are cut flat and chamfered as in c."""
    W = p.w(440, 1.0)
    ws, wt = p.stem * 1.02, p.hair
    n, n_in = p.sq, p.sq_in
    top = P.CAP + P.COS
    bot = -130
    mid = (top + bot) / 2
    hm = (top - bot) * 0.42
    m1 = mid + hm / 2
    middle = ring(0, mid - hm / 2, W, m1, ws, wt, n=n, n_in=n_in)
    cyt = m1 + (top - m1) * 0.2  # centre of the top arc's box
    # The curve overlaps the straight part, never the reverse: pathops drops
    # pieces when a rectangle overlaps a squircle just past its tangent point.
    arc = ring(0, 2 * cyt - top, W, top, ws, wt, n=n, n_in=n_in) & above(cyt - 1)
    y_cut = cyt + (top - cyt) * 0.37
    arc = arc - (right_of(W / 2) & below(y_cut))
    xt = outer_x(0, W, 2 * cyt - top, top, n, y_cut, "right")
    arc = arc - chamfer(xt, y_cut, p.cut, "se")
    upper = arc + rect(0, mid, ws, cyt)
    return G(middle + upper + upper.rotate180(W / 2, mid), l=p.sbr, r=p.sbr)


@glyph("paragraph", 0x00B6)
def paragraph(p):
    """¶ : a filled squircle bowl on the left stem, a top bar and a second
    stem, standing on the baseline as in Inter."""
    st = p.stem * 0.9
    th = p.hair
    xl = p.w(250, 0.7)  # bowl width = left edge of the inner stem
    xr = xl + 2 * st + p.w(70, 0.3)
    yb = P.CAP * 0.38
    bowl = squircle(0, yb, 2 * xl, P.CAP, p.sq) & left_of(xl + 1)
    sh = bowl + rect(xl, 0, xl + st, P.CAP) + rect(xr - st, 0, xr, P.CAP) + rect(xl, P.CAP - th, xr, P.CAP)
    return G(sh, l=p.sbr * 0.9, r=p.sb * 1.0)


# ---------------------------------------------------------------------------
# © ® ™


def _damp(v, v400, k):
    """Grow a stroke more slowly with weight than the letters do, for the
    small letters inside © ® ™ whose counters would close up."""
    return v400 + k * (v - v400)


def _ring_mark(p, x0, y0, size):
    t = p.hair * 0.92
    return ring(x0, y0, x0 + size, y0 + size, t, t, n=p.sq * 0.92, n_in=p.sq_in * 0.95)


@glyph("copyright", 0x00A9)
def copyright(p):
    size = P.CAP + 2 * P.COS
    y0 = -P.COS
    sh = _ring_mark(p, 0, y0, size)
    ch = size * 0.46
    cw = ch * 0.86
    cx0 = size / 2 - cw / 2 + cw * 0.04
    cy0 = y0 + size / 2 - ch / 2
    c = open_bowl(
        p, cx0, cx0 + cw, cy0, cy0 + ch, p.stem * 0.92, p.hair * 0.92, p.hair * 0.92,
        cut_top=cy0 + ch * 0.66, cut_bottom=cy0 + ch * 0.34,
    )
    return G(sh + c, l=p.csbr * 0.9, r=p.csbr * 0.9)


def _small_r(p, x0, y0, h, st, th):
    """A small R: stem, squircle bowl, straight leg from the bowl."""
    n, n_in = p.sq * 0.92, p.sq_in * 0.95
    w = h * 0.7
    x1 = x0 + w
    yt = y0 + h
    yb = y0 + h * 0.42  # bowl bottom
    xc = x0 + st
    wr = st * 1.04  # bowl's right side
    stem = rect(x0, y0, xc, yt)
    bowl = _ring_part(2 * xc - x1, yb, x1, yt, 2 * xc - (x1 - wr), yb + th, x1 - wr, yt - th, n, n_in, right_of(xc - 1))
    dw = st * 0.98
    leg_x = xc + (x1 - xc) * 0.12
    hw = hwidth(dw, x1 - leg_x, yb + th * 0.5 - y0)
    leg = poly([(x1 - hw, y0), (x1, y0), (leg_x + hw, yb + th * 0.5), (leg_x, yb + th * 0.5)])
    return stem + bowl + leg


@glyph("registered", 0x00AE)
def registered(p):
    size = (P.CAP + 2 * P.COS) * 0.8
    y0 = P.CAP + P.COS - size
    sh = _ring_mark(p, 0, y0, size)
    reg = P.params(400)
    st = _damp(p.stem * 0.75, reg.stem * 0.75, 0.5)
    th = _damp(p.hair * 0.7, reg.hair * 0.7, 0.3)
    rh = size * 0.5
    rw = rh * 0.7
    rx0 = size / 2 - rw / 2 + rw * 0.04
    ry0 = y0 + size / 2 - rh / 2
    return G(sh + _small_r(p, rx0, ry0, rh, st, th), l=p.csbr * 0.6, r=p.csbr * 0.6)


@glyph("trademark", 0x2122)
def trademark(p):
    """™ : superior T and M hanging from the cap height."""
    reg = P.params(400)
    st = _damp(p.stem * 0.66, reg.stem * 0.66, 0.6)
    th = _damp(p.hair * 0.66, reg.hair * 0.66, 0.6)
    h = P.CAP * 0.37
    top = P.CAP
    y0 = top - h
    c = 0.36 * st
    tw = h * 0.86 + 0.3 * p.grow
    T = rect(0, top - th, tw, top) + rect(tw / 2 - st / 2, y0, tw / 2 + st / 2, top - th + 1)
    mx0 = tw + 48 + 0.2 * p.grow
    mx1 = mx0 + h * 1.1 + 0.8 * p.grow
    mid = (mx0 + mx1) / 2
    dw = st * 0.88
    vy_out = y0 + h * 0.1  # the V's lowest point
    dx = mid - (mx0 + st)
    # Upper edges run from the stems' inner top corners to the inner vertex.
    # The lower edges are parallel, dv below.
    dy_guess = top - vy_out
    for _ in range(20):
        dv = dw * math.hypot(dx, dy_guess) / dx
        dy_guess = top - (vy_out + dv)
    vy_in = vy_out + dv
    k = (top - vy_in) / dx  # slope of the diagonals
    ya = vy_out + (mid - (mx0 + st * 0.5)) * k
    V = poly([
        (mx0 + st * 0.5, top), (mx0 + st, top), (mid, vy_in), (mx1 - st, top), (mx1 - st * 0.5, top),
        (mx1 - st * 0.5, ya), (mid, vy_out), (mx0 + st * 0.5, ya),
    ])
    M = rect(mx0, y0, mx0 + st, top, nw=c) + rect(mx1 - st, y0, mx1, top, ne=c) + V
    return G(T + M, l=p.csb * 0.55, r=p.csb * 0.55)


# ---------------------------------------------------------------------------
# Arrows

ARROW_LEN = 660


def _arrow_sb(p):
    return p.sb * 1.0


@glyph("arrowright", 0x2192)
def arrowright(p):
    sh = _arrow(p, p.w(ARROW_LEN, 0.5)).move(0, P.AXIS)
    return G(sh, l=_arrow_sb(p), r=_arrow_sb(p))


@glyph("arrowleft", 0x2190)
def arrowleft(p):
    sh = _arrow(p, p.w(ARROW_LEN, 0.5)).flip_x(0).move(0, P.AXIS)
    return G(sh, l=_arrow_sb(p), r=_arrow_sb(p))


@glyph("arrowboth", 0x2194)
def arrowboth(p):
    sh = _arrow(p, p.w(ARROW_LEN + 160, 0.5), heads=(True, True)).move(0, P.AXIS)
    return G(sh, l=_arrow_sb(p), r=_arrow_sb(p))


@glyph("arrowup", 0x2191)
def arrowup(p):
    sh = _rotate_arrow(_arrow(p, P.CAP), 90)
    return G(sh, l=_arrow_sb(p), r=_arrow_sb(p))


@glyph("arrowdown", 0x2193)
def arrowdown(p):
    sh = _rotate_arrow(_arrow(p, P.CAP), -90).move(0, P.CAP)
    return G(sh, l=_arrow_sb(p), r=_arrow_sb(p))


def _diag_arrow(p, deg):
    side = 560 + 0.3 * p.grow
    t = p.hair * 1.1
    length = (side - t * 0.36) * SQ2
    sh = _rotate_arrow(_arrow(p, length), deg)
    b = sh.bounds()
    cy = (P.CAP) / 2 - 30
    return sh.move(0, cy - (b[1] + b[3]) / 2)


@glyph("uni2197", 0x2197)
def arrow_ne(p):
    return G(_diag_arrow(p, 45), l=_arrow_sb(p), r=_arrow_sb(p))


@glyph("uni2198", 0x2198)
def arrow_se(p):
    return G(_diag_arrow(p, -45), l=_arrow_sb(p), r=_arrow_sb(p))


__all__ = ["PROOF_TEXT"]
