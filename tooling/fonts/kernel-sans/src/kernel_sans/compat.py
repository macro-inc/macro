"""Make the outlines of one glyph at several weights point-compatible.

Boolean operations can start a contour anywhere, order contours differently,
or split a smooth curve at a different place per weight. This module undoes
those differences:

- contours are matched by corner count, direction and position;
- each contour is cut into runs between its corners (sharp direction
  changes), which are stable across weights;
- inside a run, smooth curves are split by arc length until every weight has
  the same nodes, and lines become cubics where another weight has a curve.

What it cannot fix is a real change of topology: a different number of
contours, or of corners in a contour. Those glyphs raise IncompatibleGlyph
and need a construction that behaves the same at every weight.
"""

import math

from fontTools.pens.recordingPen import RecordingPen

# Corner thresholds tried in order (degrees). A join whose angle sits near a
# threshold can flip between weights, so several are tried.
ANGLES = (40.0, 25.0, 60.0, 15.0, 80.0)
EPS = 0.5  # font units; shorter segments are dropped


class IncompatibleGlyph(Exception):
    pass


# Geometry helpers ---------------------------------------------------------


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def _norm(v):
    return math.hypot(v[0], v[1])


def _lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _cubic_point(s, t):
    _, p0, c1, c2, p1 = s
    mt = 1 - t
    return (
        mt**3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t**3 * p1[0],
        mt**3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t**3 * p1[1],
    )


def _length_table(s, n=48):
    """Cumulative arc length at t = i/n."""
    if s[0] == "L":
        L = _dist(s[1], s[2])
        return [L * i / n for i in range(n + 1)]
    pts = [_cubic_point(s, i / n) for i in range(n + 1)]
    out = [0.0]
    for a, b in zip(pts, pts[1:]):
        out.append(out[-1] + _dist(a, b))
    return out


def _seg_len(s):
    return _length_table(s)[-1]


def _t_at_length(s, target):
    table = _length_table(s)
    n = len(table) - 1
    for i in range(n):
        if table[i + 1] >= target:
            span = table[i + 1] - table[i]
            u = 0 if span == 0 else (target - table[i]) / span
            return (i + u) / n
    return 1.0


def _split(s, t):
    if s[0] == "L":
        m = _lerp(s[1], s[2], t)
        return ("L", s[1], m), ("L", m, s[2])
    _, p0, c1, c2, p1 = s
    a, b, c = _lerp(p0, c1, t), _lerp(c1, c2, t), _lerp(c2, p1, t)
    d, e = _lerp(a, b, t), _lerp(b, c, t)
    f = _lerp(d, e, t)
    return ("C", p0, a, d, f), ("C", f, e, c, p1)


def _as_cubic(s):
    if s[0] == "C":
        return s
    p0, p1 = s[1], s[2]
    return ("C", p0, _lerp(p0, p1, 1 / 3), _lerp(p0, p1, 2 / 3), p1)


def _t_start(s):
    if s[0] == "L":
        return _sub(s[2], s[1])
    for q in (s[2], s[3], s[4]):
        v = _sub(q, s[1])
        if _norm(v) > 1e-6:
            return v
    return (1.0, 0.0)


def _t_end(s):
    if s[0] == "L":
        return _sub(s[2], s[1])
    for q in (s[3], s[2], s[1]):
        v = _sub(s[4], q)
        if _norm(v) > 1e-6:
            return v
    return (1.0, 0.0)


def _turn(a, b):
    """Angle in degrees between directions a and b."""
    na, nb = _norm(a), _norm(b)
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    c = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (na * nb)))
    return math.degrees(math.acos(c))


def _area(segs):
    a = 0.0
    for s in segs:
        p0, p1 = s[1], s[-1]
        a += p0[0] * p1[1] - p1[0] * p0[1]
    return a / 2


# Parsing and normalising --------------------------------------------------


def parse(shape):
    """Contours of a Shape as lists of segments ("L", p0, p1) or
    ("C", p0, c1, c2, p1), closed explicitly and cleaned."""
    rec = RecordingPen()
    shape.path.draw(rec)
    contours, segs, start, prev = [], [], None, None
    for op, args in rec.value:
        if op == "moveTo":
            start = prev = tuple(args[0])
            segs = []
        elif op == "lineTo":
            p = tuple(args[0])
            segs.append(("L", prev, p))
            prev = p
        elif op == "curveTo":
            c1, c2, p = (tuple(a) for a in args)
            segs.append(("C", prev, c1, c2, p))
            prev = p
        elif op == "qCurveTo":
            # Single quadratic -> cubic (pathops only emits cubics, but be safe).
            q, p = tuple(args[0]), tuple(args[-1])
            segs.append(("C", prev, _lerp(prev, q, 2 / 3), _lerp(p, q, 2 / 3), p))
            prev = p
        elif op in ("closePath", "endPath"):
            if _dist(prev, start) > 1e-9:
                segs.append(("L", prev, start))
            segs = _clean(segs)
            if len(segs) >= 2:
                contours.append(segs)
    return contours


def _clean(segs):
    # Straight cubics become lines.
    out = []
    for s in segs:
        if s[0] == "C":
            p0, c1, c2, p1 = s[1:]
            d = _sub(p1, p0)
            L = _norm(d)
            if L > EPS:
                off = max(
                    abs((c[0] - p0[0]) * d[1] - (c[1] - p0[1]) * d[0]) / L
                    for c in (c1, c2)
                )
                if off < 0.05:
                    s = ("L", p0, p1)
        out.append(s)
    # Drop degenerate segments, keeping the outline closed.
    kept = [s for s in out if _seg_len(s) > EPS]
    if len(kept) < 2:
        return kept
    fixed = []
    for i, s in enumerate(kept):
        prev_end = kept[i - 1][-1]
        if s[1] != prev_end:
            s = (s[0], prev_end) + s[2:]
        fixed.append(s)
    # Merge consecutive collinear lines.
    changed = True
    while changed and len(fixed) > 2:
        changed = False
        for i in range(len(fixed)):
            a, b = fixed[i - 1], fixed[i]
            if a[0] == "L" and b[0] == "L" and _turn(_t_end(a), _t_start(b)) < 0.2:
                merged = ("L", a[1], b[2])
                if i == 0:
                    fixed[0] = merged
                    fixed.pop()
                else:
                    fixed[i - 1] = merged
                    del fixed[i]
                changed = True
                break
    return fixed


def _corners(segs, angle):
    """Indices i such that the node starting segment i is a corner."""
    return [
        i
        for i in range(len(segs))
        if _turn(_t_end(segs[i - 1]), _t_start(segs[i])) > angle
    ]


def _runs(segs, angle):
    """Split a contour that begins at a corner into runs that each begin at
    a corner."""
    cs = set(_corners(segs, angle))
    runs, cur = [], []
    for i, s in enumerate(segs):
        if i in cs and cur:
            runs.append(cur)
            cur = []
        cur.append(s)
    runs.append(cur)
    return runs


# Matching -----------------------------------------------------------------


def _centre(segs):
    xs = [p[0] for s in segs for p in s[1:]]
    ys = [p[1] for s in segs for p in s[1:]]
    return (
        (min(xs) + max(xs)) / 2,
        (min(ys) + max(ys)) / 2,
        max(xs) - min(xs),
        max(ys) - min(ys),
    )


def _anchor(segs):
    """For a contour without corners: the topmost node, then leftmost."""
    best = max(
        range(len(segs)), key=lambda i: (round(segs[i][1][1], 3), -segs[i][1][0])
    )
    return best


def _align(ref, other, angle):
    """Rotate `other` (a contour matched to `ref`) to start at the node
    corresponding to ref's first node; both must have equal corner counts."""
    rc, oc = _corners(ref, angle), _corners(other, angle)
    if not rc:
        a = ref[0][1]
        start = min(range(len(other)), key=lambda i: _dist(other[i][1], a))
        return start
    k = len(oc)
    best = None
    for r in range(k):
        cost = sum(
            _dist(ref[rc[i]][1], other[oc[(i + r) % k]][1]) ** 2 for i in range(k)
        )
        if best is None or cost < best[0]:
            best = (cost, oc[r % k])
    return best[1]


def _frame(contours):
    """Glyph bounding box (x0, y0, w, h) used to compare positions across
    weights, since contours drift apart as a glyph gets wider."""
    xs = [p[0] for c in contours for s in c for p in s[1:]]
    ys = [p[1] for c in contours for s in c for p in s[1:]]
    if not xs:
        return 0.0, 0.0, 1.0, 1.0
    return min(xs), min(ys), max(max(xs) - min(xs), 1.0), max(max(ys) - min(ys), 1.0)


def _rel(pt, frame):
    x0, y0, w, h = frame
    return ((pt[0] - x0) / w, (pt[1] - y0) / h)


def _assign(cost):
    """Minimum-cost perfect matching for a square matrix whose entries may be
    None (not allowed). Returns a list col[i] or None when impossible.
    Exhaustive for small sizes, greedy otherwise."""
    import itertools

    n = len(cost)
    if n <= 7:
        best = None
        for perm in itertools.permutations(range(n)):
            total = 0.0
            for i, j in enumerate(perm):
                c = cost[i][j]
                if c is None:
                    break
                total += c
            else:
                if best is None or total < best[0]:
                    best = (total, perm)
        return list(best[1]) if best else None
    taken, out = set(), []
    for i in range(n):
        opts = [
            (cost[i][j], j)
            for j in range(n)
            if j not in taken and cost[i][j] is not None
        ]
        if not opts:
            return None
        c, j = min(opts)
        taken.add(j)
        out.append(j)
    return out


def _match_contours(ref_contours, other_contours, label, angle):
    if len(ref_contours) != len(other_contours):
        raise IncompatibleGlyph(
            f"{len(ref_contours)} contours at the default weight, {len(other_contours)} at {label}"
        )
    fr, fo = _frame(ref_contours), _frame(other_contours)
    sig_o = [(len(_corners(c, angle)), _area(c) > 0) for c in other_contours]
    cost = []
    for rc in ref_contours:
        ncr, sign = len(_corners(rc, angle)), _area(rc) > 0
        cx, cy, w, h = _centre(rc)
        (rx, ry), (rw, rh) = _rel((cx, cy), fr), (w / fr[2], h / fr[3])
        row = []
        for j, oc in enumerate(other_contours):
            if sig_o[j] != (ncr, sign):
                row.append(None)
                continue
            ox, oy, ow, oh = _centre(oc)
            (qx, qy), (qw, qh) = _rel((ox, oy), fo), (ow / fo[2], oh / fo[3])
            row.append(
                (qx - rx) ** 2
                + (qy - ry) ** 2
                + 0.25 * ((qw - rw) ** 2 + (qh - rh) ** 2)
            )
        cost.append(row)
    perm = _assign(cost)
    if perm is None:
        counts_r = sorted(len(_corners(c, angle)) for c in ref_contours)
        counts_o = sorted(n for n, _ in sig_o)
        raise IncompatibleGlyph(
            f"corner counts per contour differ: {counts_r} at the default weight, {counts_o} at {label}"
        )
    return [other_contours[j] for j in perm]


def _fractions(run):
    lengths = [_seg_len(s) for s in run]
    total = sum(lengths) or 1.0
    acc, out = 0.0, []
    for L in lengths[:-1]:
        acc += L
        out.append(acc / total)
    return out


def _split_run(run, fraction):
    lengths = [_seg_len(s) for s in run]
    target = fraction * sum(lengths)
    acc = 0.0
    for i, L in enumerate(lengths):
        if acc + L >= target or i == len(run) - 1:
            t = (
                _t_at_length(run[i], max(0.0, target - acc))
                if run[i][0] == "C"
                else max(0.0, min(1.0, (target - acc) / (L or 1)))
            )
            t = min(max(t, 1e-4), 1 - 1e-4)
            a, b = _split(run[i], t)
            return run[:i] + [a, b] + run[i + 1 :]
        acc += L
    return run


def _equalise(runs_by_master):
    """runs_by_master: list (per master) of one run each. Returns runs with
    the same node count and segment types."""
    fr = [_fractions(r) for r in runs_by_master]
    gaps = [b - a for f in fr for a, b in zip([0.0] + f, f + [1.0])]
    tol = min([0.06] + [g * 0.5 for g in gaps if g > 0])
    clusters = []
    for f in sorted(x for fs in fr for x in fs):
        if clusters and f - clusters[-1][-1] < tol:
            clusters[-1].append(f)
        else:
            clusters.append([f])
    centres = [sum(c) / len(c) for c in clusters]
    out = []
    for run, fs in zip(runs_by_master, fr):
        missing = [c for c in centres if not any(abs(c - f) < tol for f in fs)]
        for c in sorted(missing):
            run = _split_run(run, c)
        out.append(run)
    n = {len(r) for r in out}
    if len(n) != 1:
        raise IncompatibleGlyph(
            f"could not equalise a run: {sorted(len(r) for r in out)} segments"
        )
    for i in range(len(out[0])):
        if any(r[i][0] == "C" for r in out):
            for r in out:
                r[i] = _as_cubic(r[i])
    return out


def _exact(parsed, default):
    """Contours already identical in structure: only reorder and rotate."""
    ref = parsed[default]
    out = {default: ref}
    for w, contours in parsed.items():
        if w == default:
            continue
        if len(contours) != len(ref):
            return None
        fr, fo = _frame(ref), _frame(contours)
        cost, rots = [], []
        for rc in ref:
            sig = tuple(seg[0] for seg in rc)
            row, rrow = [], []
            for oc in contours:
                best = None
                if len(oc) == len(rc):
                    for k in range(len(oc)):
                        rot = oc[k:] + oc[:k]
                        if tuple(seg[0] for seg in rot) != sig:
                            continue
                        c = sum(
                            _dist(_rel(a[1], fr), _rel(b[1], fo)) ** 2
                            for a, b in zip(rc, rot)
                        )
                        if best is None or c < best[0]:
                            best = (c, rot)
                row.append(best[0] if best else None)
                rrow.append(best[1] if best else None)
            cost.append(row)
            rots.append(rrow)
        perm = _assign(cost)
        if perm is None:
            return None
        out[w] = [rots[i][j] for i, j in enumerate(perm)]
    return out


def _by_corners(parsed, default, angle):
    ref = parsed[default]
    others = [w for w in parsed if w != default]
    matched = {default: ref}
    for w in others:
        matched[w] = _match_contours(ref, parsed[w], w, angle)
    result = {w: [] for w in parsed}
    ws = list(parsed)
    for ci, rc in enumerate(ref):
        cs = _corners(rc, angle)
        rstart = cs[0] if cs else _anchor(rc)
        rrot = rc[rstart:] + rc[:rstart]
        rot = {default: rrot}
        for w in others:
            oc = matched[w][ci]
            ostart = _align(rrot, oc, angle)
            rot[w] = oc[ostart:] + oc[:ostart]
        runs = {w: _runs(rot[w], angle) for w in ws}
        counts = {w: len(r) for w, r in runs.items()}
        if len(set(counts.values())) != 1:
            raise IncompatibleGlyph(f"corner runs differ per weight: {counts}")
        merged = {w: [] for w in ws}
        for ri in range(counts[default]):
            eq = _equalise([runs[w][ri] for w in ws])
            for w, r in zip(ws, eq):
                merged[w].extend(r)
        for w in ws:
            result[w].append(merged[w])
    return result


def match_masters(shapes, default):
    """shapes: {weight: Shape}. Returns {weight: [contour, ...]} where the
    contours line up segment for segment across weights."""
    parsed = {w: parse(s) for w, s in shapes.items()}
    exact = _exact(parsed, default)
    if exact is not None:
        return exact
    first_error = None
    for angle in ANGLES:
        try:
            return _by_corners(parsed, default, angle)
        except IncompatibleGlyph as e:
            first_error = first_error or e
    raise first_error
