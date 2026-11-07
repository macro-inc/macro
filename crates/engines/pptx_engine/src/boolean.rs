//! Boolean operations on filled outlines: PowerPoint's Merge Shapes (Union,
//! Combine, Fragment, Intersect, Subtract).
//!
//! Each input shape is a set of filled paths in slide space. Curves are
//! flattened (within [`FLATTEN_TOLERANCE`] points) and every vertex is snapped
//! to a fixed grid, so the arrangement of all edges can be built with exact
//! integer predicates: edges are split wherever they cross, touch, or overlap
//! (snap rounding keeps that consistent), then each edge learns which shapes
//! cover its two sides from exact winding numbers (the non-zero rule, which
//! is how the renderer fills). An operation keeps the edges whose two sides
//! differ in the result and chains them into closed contours with the
//! inside on their right: outer contours run clockwise on screen and holes
//! counter-clockwise, so the result fills the same with the even-odd and the
//! non-zero rule. Contour pieces that follow one input curve become that
//! curve again (the sub-curve between the cuts), so circles stay circles.

mod arrangement;
mod contour;

use arrangement::Arrangement;

/// How finely curves are flattened to find intersections (points).
pub const FLATTEN_TOLERANCE: f64 = 0.05;

/// A point in slide points.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pt {
    /// Horizontal coordinate.
    pub x: f64,
    /// Vertical coordinate (down is positive).
    pub y: f64,
}

impl Pt {
    /// Creates a point.
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    fn lerp(self, o: Pt, t: f64) -> Pt {
        Pt::new(self.x + (o.x - self.x) * t, self.y + (o.y - self.y) * t)
    }

    fn add(self, o: Pt) -> Pt {
        Pt::new(self.x + o.x, self.y + o.y)
    }

    fn sub(self, o: Pt) -> Pt {
        Pt::new(self.x - o.x, self.y - o.y)
    }
}

/// One piece of an outline.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Seg {
    /// A straight line from the first point to the second.
    Line(Pt, Pt),
    /// A cubic Bézier: start, two control points, end.
    Cubic(Pt, Pt, Pt, Pt),
}

impl Seg {
    /// Where the segment starts.
    pub fn start(&self) -> Pt {
        match *self {
            Seg::Line(a, _) | Seg::Cubic(a, ..) => a,
        }
    }

    /// Where the segment ends.
    pub fn end(&self) -> Pt {
        match *self {
            Seg::Line(_, b) | Seg::Cubic(.., b) => b,
        }
    }

    /// The point at parameter `t` (0 at the start, 1 at the end).
    pub fn at(&self, t: f64) -> Pt {
        match *self {
            Seg::Line(a, b) => a.lerp(b, t),
            Seg::Cubic(p0, p1, p2, p3) => {
                let mt = 1.0 - t;
                let (a, b, c, d) = (mt * mt * mt, 3.0 * mt * mt * t, 3.0 * mt * t * t, t * t * t);
                Pt::new(
                    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
                    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
                )
            }
        }
    }

    /// The part of the segment between parameters `t0` and `t1` (reversed
    /// when `t1 < t0`).
    pub fn part(&self, t0: f64, t1: f64) -> Seg {
        match *self {
            Seg::Line(..) => Seg::Line(self.at(t0), self.at(t1)),
            Seg::Cubic(..) => {
                if t1 < t0 {
                    return self.part(t1, t0).reversed();
                }
                // Split at t1, keep the head, then split that at t0 / t1.
                let head = if t1 < 1.0 {
                    split_cubic(self, t1).0
                } else {
                    *self
                };
                if t0 <= 0.0 || t1 <= 0.0 {
                    return head;
                }
                split_cubic(&head, t0 / t1).1
            }
        }
    }

    /// The same segment traversed backwards.
    pub fn reversed(&self) -> Seg {
        match *self {
            Seg::Line(a, b) => Seg::Line(b, a),
            Seg::Cubic(a, b, c, d) => Seg::Cubic(d, c, b, a),
        }
    }
}

/// Splits a cubic at `t` (de Casteljau).
fn split_cubic(seg: &Seg, t: f64) -> (Seg, Seg) {
    let Seg::Cubic(p0, p1, p2, p3) = *seg else {
        let m = seg.at(t);
        return (Seg::Line(seg.start(), m), Seg::Line(m, seg.end()));
    };
    let a = p0.lerp(p1, t);
    let b = p1.lerp(p2, t);
    let c = p2.lerp(p3, t);
    let d = a.lerp(b, t);
    let e = b.lerp(c, t);
    let m = d.lerp(e, t);
    (Seg::Cubic(p0, a, d, m), Seg::Cubic(m, e, c, p3))
}

/// A filled path: closed loops filled by the non-zero winding rule. A loop
/// that does not end where it starts is closed with a straight line.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FillPath {
    /// The loops (sub-paths), each a chain of segments.
    pub loops: Vec<Vec<Seg>>,
}

/// One input shape: the union of its filled paths.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Operand {
    /// The filled paths.
    pub paths: Vec<FillPath>,
}

/// A merge operation, as PowerPoint names them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MergeMode {
    /// Everything any shape covers.
    Union,
    /// What an odd number of shapes covers (overlaps are cut out).
    Combine,
    /// Every region the outlines cut out, as separate pieces.
    Fragment,
    /// What every shape covers.
    Intersect,
    /// The first shape without what the others cover.
    Subtract,
}

/// One connected result region: an outer contour (clockwise on screen) and
/// its holes (counter-clockwise), or for single-result modes every contour
/// of the result.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Piece {
    /// Closed contours; each ends where it starts.
    pub loops: Vec<Vec<Seg>>,
}

/// The most operands an operation takes (each side of an edge records the
/// operands covering it in a 64-bit mask).
pub const MAX_OPERANDS: usize = 64;

/// Merges `operands` (at most [`MAX_OPERANDS`]). Fragment returns one piece
/// per connected region (with its holes); the other modes return one piece
/// holding the whole result, or nothing when the result is empty.
pub fn merge(operands: &[Operand], mode: MergeMode) -> Vec<Piece> {
    let n = operands.len().min(MAX_OPERANDS);
    let arr = Arrangement::build(&operands[..n]);
    let all: u64 = if n == 64 { u64::MAX } else { (1u64 << n) - 1 };
    let keep: fn(u64, u64) -> bool = match mode {
        MergeMode::Union => |m, _| m != 0,
        MergeMode::Intersect => |m, all| m != 0 && m == all,
        MergeMode::Subtract => |m, _| m == 1,
        MergeMode::Combine => |m, _| m.count_ones() % 2 == 1,
        MergeMode::Fragment => return fragment(&arr),
    };
    let loops = contour::chain(&arr.region_edges(|m| keep(m, all)));
    let loops: Vec<Vec<Seg>> = loops
        .iter()
        .filter(|l| !contour::is_sliver(l))
        .map(|l| contour::to_segs(l, &arr.curves))
        .filter(|l| !l.is_empty())
        .collect();
    if loops.is_empty() {
        Vec::new()
    } else {
        vec![Piece { loops }]
    }
}

/// Fragment: each distinct cover (set of operands) cut into its connected regions.
fn fragment(arr: &Arrangement) -> Vec<Piece> {
    let mut out = Vec::new();
    for label in arr.labels() {
        let loops: Vec<_> = contour::chain(&arr.region_edges(|m| m == label))
            .into_iter()
            .filter(|l| !contour::is_sliver(l))
            .collect();
        for piece in contour::assemble(loops) {
            let loops: Vec<Vec<Seg>> = piece
                .iter()
                .map(|l| contour::to_segs(l, &arr.curves))
                .filter(|l| !l.is_empty())
                .collect();
            if !loops.is_empty() {
                out.push(Piece { loops });
            }
        }
    }
    out
}

/// `[left, top, right, bottom]` of segments with curves counted exactly
/// (their extremes, not their control points); `None` when there are none.
pub fn bounds(segs: &[Seg]) -> Option<[f64; 4]> {
    let mut b: Option<[f64; 4]> = None;
    let mut add = |p: Pt| {
        b = Some(match b {
            None => [p.x, p.y, p.x, p.y],
            Some([l, t, r, bt]) => [l.min(p.x), t.min(p.y), r.max(p.x), bt.max(p.y)],
        });
    };
    for s in segs {
        add(s.start());
        add(s.end());
        if let Seg::Cubic(p0, p1, p2, p3) = *s {
            for t in extremes(p0.x, p1.x, p2.x, p3.x)
                .into_iter()
                .chain(extremes(p0.y, p1.y, p2.y, p3.y))
                .flatten()
            {
                add(s.at(t));
            }
        }
    }
    b
}

/// Parameters in (0, 1) where one coordinate of a cubic turns.
fn extremes(a: f64, b: f64, c: f64, d: f64) -> [Option<f64>; 2] {
    // The derivative over 3: p(1-t)² + 2q(1-t)t + r t².
    let (p, q, r) = (b - a, c - b, d - c);
    let (qa, qb, qc) = (p - 2.0 * q + r, 2.0 * (q - p), p);
    let inside = |t: f64| (t > 0.0 && t < 1.0).then_some(t);
    if qa.abs() < 1e-12 {
        if qb.abs() < 1e-12 {
            return [None, None];
        }
        return [inside(-qc / qb), None];
    }
    let disc = qb * qb - 4.0 * qa * qc;
    if disc < 0.0 {
        return [None, None];
    }
    let s = disc.sqrt();
    [
        inside((-qb + s) / (2.0 * qa)),
        inside((-qb - s) / (2.0 * qa)),
    ]
}

/// The signed area of a closed chain of segments (positive when clockwise on
/// screen), counting curves exactly.
pub fn area(loop_: &[Seg]) -> f64 {
    loop_
        .iter()
        .map(|s| match *s {
            Seg::Line(a, b) => (a.x * b.y - b.x * a.y) / 2.0,
            // Green's theorem over a cubic Bézier: ½∫(x y' − y x') dt is a
            // weighted sum of the control points' cross products.
            Seg::Cubic(p0, p1, p2, p3) => {
                let c = |a: Pt, b: Pt| a.x * b.y - b.x * a.y;
                (0.6 * c(p0, p1)
                    + 0.3 * c(p0, p2)
                    + 0.1 * c(p0, p3)
                    + 0.3 * c(p1, p2)
                    + 0.3 * c(p1, p3)
                    + 0.6 * c(p2, p3))
                    / 2.0
            }
        })
        .sum()
}

#[cfg(test)]
mod test;
