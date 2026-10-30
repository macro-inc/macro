"""Shape primitives and boolean helpers for drawing glyphs.

Glyphs are built by constructive geometry: draw simple filled shapes, then
combine them with `+` (union), `-` (difference) and `&` (intersection). The
booleans run through skia-pathops, so the result is always a clean outline
without overlaps. Coordinates are font units, y up.

Keep a glyph's construction the same at every weight (the same shapes meeting
the same way) so the outlines stay point-compatible for the variable font.
"""

import math

import pathops

BIG = 4000  # half-size of the "everything" region used by half-planes


class Shape:
    """An immutable filled outline."""

    __slots__ = ("path",)

    def __init__(self, path=None):
        self.path = path if path is not None else pathops.Path()

    # Booleans -----------------------------------------------------------

    def __add__(self, other):
        return Shape(pathops.op(self.path, other.path, pathops.PathOp.UNION))

    def __sub__(self, other):
        return Shape(pathops.op(self.path, other.path, pathops.PathOp.DIFFERENCE))

    def __and__(self, other):
        return Shape(pathops.op(self.path, other.path, pathops.PathOp.INTERSECTION))

    def __bool__(self):
        return len(list(self.path.segments)) > 0

    # Transforms ---------------------------------------------------------

    def transform(self, xx, xy, yx, yy, dx, dy):
        """Affine transform: x' = xx*x + yx*y + dx, y' = xy*x + yy*y + dy."""
        p = pathops.Path()
        self.path.draw(_TransformPen(p.getPen(), (xx, xy, yx, yy, dx, dy)))
        return Shape(p)

    def move(self, dx=0.0, dy=0.0):
        return self.transform(1, 0, 0, 1, dx, dy)

    def flip_x(self, cx=0.0):
        """Mirror left-right about the vertical line x = cx."""
        return self.transform(-1, 0, 0, 1, 2 * cx, 0)

    def flip_y(self, cy=0.0):
        """Mirror top-bottom about the horizontal line y = cy."""
        return self.transform(1, 0, 0, -1, 0, 2 * cy)

    def rotate180(self, cx, cy):
        """Rotate half a turn about (cx, cy), e.g. n -> u, b -> q."""
        return self.transform(-1, 0, 0, -1, 2 * cx, 2 * cy)

    def scale(self, sx, sy=None, cx=0.0, cy=0.0):
        sy = sx if sy is None else sy
        return self.transform(sx, 0, 0, sy, cx - sx * cx, cy - sy * cy)

    def rotate(self, degrees, cx=0.0, cy=0.0):
        a = math.radians(degrees)
        c, s = math.cos(a), math.sin(a)
        return self.transform(c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy)

    def skew(self, degrees, cy=0.0):
        """Horizontal skew (positive leans right), e.g. for an oblique."""
        t = math.tan(math.radians(degrees))
        return self.transform(1, 0, t, 1, -t * cy, 0)

    # Queries ------------------------------------------------------------

    def bounds(self):
        """(xMin, yMin, xMax, yMax) of the outline, or None when empty."""
        if not self:
            return None
        return tuple(self.path.bounds)

    def clean(self):
        p = pathops.Path(self.path)
        p.simplify(fix_winding=True, keep_starting_points=False)
        return Shape(p)


class _TransformPen:
    def __init__(self, pen, m):
        self.pen, self.m = pen, m

    def _t(self, pt):
        xx, xy, yx, yy, dx, dy = self.m
        x, y = pt
        return (xx * x + yx * y + dx, xy * x + yy * y + dy)

    def moveTo(self, pt):
        self.pen.moveTo(self._t(pt))

    def lineTo(self, pt):
        self.pen.lineTo(self._t(pt))

    def curveTo(self, *pts):
        self.pen.curveTo(*[self._t(p) for p in pts])

    def qCurveTo(self, *pts):
        self.pen.qCurveTo(*[self._t(p) if p is not None else None for p in pts])

    def closePath(self):
        self.pen.closePath()

    def endPath(self):
        self.pen.endPath()


def union(*shapes):
    """Union of any number of shapes (also accepts one iterable)."""
    if len(shapes) == 1 and not isinstance(shapes[0], Shape):
        shapes = tuple(shapes[0])
    out = Shape()
    for s in shapes:
        out = out + s
    return out


# ---------------------------------------------------------------------------
# Basic shapes


def poly(points):
    """Closed polygon through the points, in either direction."""
    p = pathops.Path()
    pen = p.getPen()
    pen.moveTo(points[0])
    for pt in points[1:]:
        pen.lineTo(pt)
    pen.closePath()
    # Normalise winding so unions and differences behave.
    p.simplify(fix_winding=True)
    return Shape(p)


def rect(x0, y0, x1, y1, nw=0, ne=0, se=0, sw=0):
    """Axis-aligned rectangle; nw/ne/se/sw chamfer that corner by a 45° cut
    with the given leg length."""
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    pts = []
    # Walk counter-clockwise from the bottom-left corner.
    pts += [(x0, y0 + sw), (x0 + sw, y0)] if sw else [(x0, y0)]
    pts += [(x1 - se, y0), (x1, y0 + se)] if se else [(x1, y0)]
    pts += [(x1, y1 - ne), (x1 - ne, y1)] if ne else [(x1, y1)]
    pts += [(x0 + nw, y1), (x0, y1 - nw)] if nw else [(x0, y1)]
    return poly(_dedupe(pts))


def _dedupe(pts):
    out = []
    for pt in pts:
        if not out or (abs(out[-1][0] - pt[0]) > 1e-6 or abs(out[-1][1] - pt[1]) > 1e-6):
            out.append(pt)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < 1e-6 and abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out


def superness(n):
    """Cubic handle factor that makes one Bézier per quadrant pass through the
    45° point of the superellipse |x|^n + |y|^n = 1 (n = 2 gives 0.5523)."""
    return (8 * 2 ** (-1 / n) - 4) / 3


def squircle(x0, y0, x1, y1, n=3.0):
    """Superellipse filling the box (x0, y0)-(x1, y1). n = 2 is an ellipse;
    higher n is squarer. Four cubic segments, one per quadrant."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = abs(x1 - x0) / 2, abs(y1 - y0) / 2
    k = superness(n)
    p = pathops.Path()
    pen = p.getPen()
    pen.moveTo((cx + rx, cy))
    pen.curveTo((cx + rx, cy + k * ry), (cx + k * rx, cy + ry), (cx, cy + ry))
    pen.curveTo((cx - k * rx, cy + ry), (cx - rx, cy + k * ry), (cx - rx, cy))
    pen.curveTo((cx - rx, cy - k * ry), (cx - k * rx, cy - ry), (cx, cy - ry))
    pen.curveTo((cx + k * rx, cy - ry), (cx + rx, cy - k * ry), (cx + rx, cy))
    pen.closePath()
    p.simplify(fix_winding=True)
    return Shape(p)


def ring(x0, y0, x1, y1, wx, wy, n=3.0, n_in=None, wy_bottom=None):
    """A closed round stroke (like o or O) filling the box: an outer squircle
    minus a counter inset by wx on the sides, wy at the top and wy_bottom
    (default wy) at the bottom."""
    wyb = wy if wy_bottom is None else wy_bottom
    outer = squircle(x0, y0, x1, y1, n)
    inner = squircle(x0 + wx, y0 + wyb, x1 - wx, y1 - wy, n if n_in is None else n_in)
    return outer - inner


def squircle_point(x0, y0, x1, y1, n, deg):
    """Point on the true superellipse in the box at polar angle `deg` of its
    parametric form (0 = right, 90 = top). Handy for placing cuts."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rx, ry = abs(x1 - x0) / 2, abs(y1 - y0) / 2
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x = cx + rx * math.copysign(abs(c) ** (2 / n), c)
    y = cy + ry * math.copysign(abs(s) ** (2 / n), s)
    return x, y


def box(x0, y0, x1, y1):
    """Plain rectangle without chamfers (alias for clipping regions)."""
    return rect(x0, y0, x1, y1)


def half_plane(p0, p1):
    """Everything to the LEFT of the directed line p0 -> p1.

    Subtract it to cut a stroke along that line, e.g. an angled terminal."""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    d = math.hypot(dx, dy)
    ux, uy = dx / d, dy / d
    nx, ny = -uy, ux  # left normal
    a = (x0 - ux * BIG, y0 - uy * BIG)
    b = (x0 + ux * BIG, y0 + uy * BIG)
    c = (b[0] + nx * BIG, b[1] + ny * BIG)
    e = (a[0] + nx * BIG, a[1] + ny * BIG)
    return poly([a, b, c, e])


def above(y):
    return rect(-BIG, y, BIG, BIG)


def below(y):
    return rect(-BIG, -BIG, BIG, y)


def left_of(x):
    return rect(-BIG, -BIG, x, BIG)


def right_of(x):
    return rect(x, -BIG, BIG, BIG)


def band(y0, y1):
    """Horizontal band between y0 and y1, infinitely wide."""
    return rect(-BIG, y0, BIG, y1)


def column(x0, x1):
    """Vertical band between x0 and x1, infinitely tall."""
    return rect(x0, -BIG, x1, BIG)


# ---------------------------------------------------------------------------
# Strokes


def stroke(p0, p1, w):
    """A straight stroke of perpendicular thickness w from p0 to p1 with
    square (butt) ends."""
    (x0, y0), (x1, y1) = p0, p1
    d = math.hypot(x1 - x0, y1 - y0)
    nx, ny = -(y1 - y0) / d * w / 2, (x1 - x0) / d * w / 2
    return poly([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)])


def diag(xb, yb, xt, yt, w):
    """A diagonal stroke whose centreline runs from (xb, yb) to (xt, yt), with
    perpendicular thickness w and ends cut horizontally at yb and yt.

    This is how the strokes of v, w, x, A, V and friends are built: their ends
    sit flat on the baseline and the x-height or cap height."""
    dx, dy = xt - xb, yt - yb
    # Horizontal width that gives perpendicular thickness w.
    hw = w * math.hypot(dx, dy) / abs(dy) / 2
    return poly([(xb - hw, yb), (xb + hw, yb), (xt + hw, yt), (xt - hw, yt)])


def diag_edge(x_left_bottom, yb, x_left_top, yt, w):
    """Like diag, but positioned by its LEFT edge instead of its centreline."""
    dx, dy = x_left_top - x_left_bottom, yt - yb
    hw = w * math.hypot(dx, dy) / abs(dy)
    return poly([(x_left_bottom, yb), (x_left_bottom + hw, yb), (x_left_top + hw, yt), (x_left_top, yt)])


def hwidth(w, dx, dy):
    """Horizontal width of a stroke of perpendicular thickness w whose
    direction is (dx, dy)."""
    return w * math.hypot(dx, dy) / abs(dy)


# ---------------------------------------------------------------------------
# Cyber details


def chamfer(x, y, leg, corner):
    """Region to SUBTRACT to clip a convex corner at (x, y) with a 45° cut.

    corner is "nw", "ne", "se" or "sw": the direction the corner points.
    The cut removes a right isosceles triangle with legs `leg` along the x
    and y axes from the corner. The region is local (it only reaches a little
    past the triangle), so it is safe to use on terminals inside a glyph."""
    sx = -1 if corner in ("nw", "sw") else 1
    sy = 1 if corner in ("nw", "ne") else -1
    e = max(4.0, leg * 0.6)
    return poly([
        (x + sx * e, y + sy * e),
        (x - sx * (leg + e), y + sy * e),
        (x + sx * e, y - sy * (leg + e)),
    ])


def trap(x, y, angle, depth, width=None):
    """Ink-trap wedge to SUBTRACT at a crotch.

    (x, y) is the crotch corner (where the white counter meets the join);
    the wedge points into the black at `angle` degrees (0 = right, 90 = up)
    and is `depth` deep. Width at the mouth defaults to 0.55 * depth.
    Returns an empty shape when depth is ~0, so it is safe at Light."""
    if depth < 1:
        return Shape()
    width = 0.55 * depth if width is None else width
    a = math.radians(angle)
    ux, uy = math.cos(a), math.sin(a)
    nx, ny = -uy, ux
    back = depth * 0.6  # start in the white so the cut opens cleanly
    bx, by = x - ux * back, y - uy * back
    half = width / 2 * (1 + back / depth)
    tip = (x + ux * depth, y + uy * depth)
    return poly([(bx + nx * half, by + ny * half), tip, (bx - nx * half, by - ny * half)])


def notch(tip, a, b):
    """Ink-trap triangle to SUBTRACT: `tip` lies inside the black join, `a`
    and `b` lie in the white counter on either side of the crotch, so the cut
    opens cleanly and deepens the crotch towards the tip."""
    return poly([a, tip, b])


def stem_trap(x, y, depth, side="right", up=True):
    """Ink trap at a crotch where a curve leaves the straight edge x = x of a
    stem at height y (n, m, h, b, d, p, q, r, a). The trap runs along the stem
    edge for `depth` and opens into the counter on `side` of the stem.
    `up` means the counter is below the crotch (n, h, m, r, b-top); use
    up=False for joins at the bottom (u, d-bottom, b-bottom, a-bottom)."""
    if depth < 1:
        return Shape()
    sx = 1 if side == "right" else -1
    sy = 1 if up else -1
    tip = (x - sx * depth * 0.22, y + sy * depth)
    # Start the cut just below the crotch so no sliver of the curve survives
    # next to it at any weight.
    a = (x + sx * (depth * 0.05 + 0.3), y - sy * (depth * 0.4 + 4))
    b = (x + sx * depth * 0.95, y + sy * depth * 1.1)
    return notch(tip, a, b)


def crotch_trap(v, d1, d2, depth, mouth=0.6):
    """Ink trap to SUBTRACT at the inner vertex of two straight edges, as in
    v w y A V W M N K k and the figures.

    v is the vertex where the two edges meet (the tip of the white wedge);
    d1 and d2 are the directions of the two edges going away from v along
    the white wedge. The trap continues the wedge `depth` into the black and
    opens `mouth * depth` wide where it crosses the edges, so its tip angle
    stays at least about 30 degrees. Use depth = p.trap for vertices (stem
    shoulders use stem_trap with 1.3 * p.trap)."""
    if depth < 1:
        return Shape()
    u1 = _unit(d1)
    u2 = _unit(d2)
    bis = _unit((u1[0] + u2[0], u1[1] + u2[1]))
    half = math.acos(max(-1.0, min(1.0, u1[0] * u2[0] + u1[1] * u2[1]))) / 2
    m = min(2.5 * depth, (mouth * depth / 2) / max(math.sin(half), 0.05))
    tip = (v[0] - bis[0] * depth, v[1] - bis[1] * depth)
    a = (v[0] + u1[0] * m, v[1] + u1[1] * m)
    b = (v[0] + u2[0] * m, v[1] + u2[1] * m)
    return poly([a, tip, b])


def _unit(d):
    if isinstance(d, (int, float)):
        a = math.radians(d)
        return (math.cos(a), math.sin(a))
    n = math.hypot(d[0], d[1])
    return (d[0] / n, d[1] / n)


def dot(cx, cy, side, cut=None):
    """Square dot centred at (cx, cy) with the house NW + SE chamfers."""
    c = side * 0.22 if cut is None else cut
    h = side / 2
    return rect(cx - h, cy - h, cx + h, cy + h, nw=c, se=c)
