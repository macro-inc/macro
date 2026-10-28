//! The arrangement of every input edge: snapped to an integer grid, split
//! at every crossing and touch, deduplicated, and classified by the
//! operands covering each side.

use super::{FLATTEN_TOLERANCE, Operand, Pt, Seg};
use std::collections::HashMap;

/// Grid units per point: vertices snap to 1/1024 pt.
pub(super) const SCALE: f64 = 1024.0;
/// A vertex this close (grid units) to an edge splits it (snap rounding's hot pixel).
const HOT: i128 = 1;
/// Splitting rounds: each round splits at the crossings the previous one
/// left (rounding moves split edges by under a grid unit).
const MAX_ROUNDS: usize = 12;
/// Most pieces a cubic is flattened into.
const MAX_STEPS: usize = 64;

/// A snapped vertex in grid units.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(super) struct IPt {
    pub x: i64,
    pub y: i64,
}

impl IPt {
    fn snap(p: Pt) -> Self {
        Self {
            x: (p.x * SCALE).round() as i64,
            y: (p.y * SCALE).round() as i64,
        }
    }

    /// Back to points.
    pub fn pt(self) -> Pt {
        Pt::new(self.x as f64 / SCALE, self.y as f64 / SCALE)
    }
}

fn cross(o: IPt, a: IPt, b: IPt) -> i128 {
    let (ax, ay) = (i128::from(a.x - o.x), i128::from(a.y - o.y));
    let (bx, by) = (i128::from(b.x - o.x), i128::from(b.y - o.y));
    ax * by - ay * bx
}

fn dot(o: IPt, a: IPt, b: IPt) -> i128 {
    let (ax, ay) = (i128::from(a.x - o.x), i128::from(a.y - o.y));
    let (bx, by) = (i128::from(b.x - o.x), i128::from(b.y - o.y));
    ax * bx + ay * by
}

/// Where an edge came from: a source curve and the parameters at its ends.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Src {
    pub curve: u32,
    pub t0: f64,
    pub t1: f64,
}

impl Src {
    pub fn reversed(self) -> Self {
        Self {
            t0: self.t1,
            t1: self.t0,
            ..self
        }
    }
}

/// An input edge, directed as its loop runs.
#[derive(Clone, Copy, Debug)]
struct RawEdge {
    a: IPt,
    b: IPt,
    /// The filled path (atom) it bounds.
    atom: u32,
    src: Src,
}

/// A unique edge of the arrangement, `a < b`.
#[derive(Clone, Debug)]
pub(super) struct Edge {
    pub a: IPt,
    pub b: IPt,
    /// Provenance, `t0` at `a` and `t1` at `b`.
    pub src: Src,
    /// Per atom: input copies running `a → b` minus those running `b → a`.
    d: Vec<i32>,
    /// Operands covering the side right of `a → b` (bit per operand).
    pub right: u64,
    /// Operands covering the side left of `a → b`.
    pub left: u64,
}

/// A directed result edge.
#[derive(Clone, Copy, Debug)]
pub(super) struct DirEdge {
    pub from: IPt,
    pub to: IPt,
    pub src: Src,
}

pub(super) struct Arrangement {
    /// Source curves by id (slide points).
    pub curves: Vec<Seg>,
    pub edges: Vec<Edge>,
}

impl Arrangement {
    pub fn build(operands: &[Operand]) -> Self {
        let mut curves = Vec::new();
        let mut raw = Vec::new();
        let mut atom_operand = Vec::new();
        for (oi, op) in operands.iter().enumerate() {
            for path in &op.paths {
                let atom = atom_operand.len() as u32;
                atom_operand.push(oi);
                for lp in &path.loops {
                    flatten_loop(lp, atom, &mut curves, &mut raw);
                }
            }
        }
        split(&mut raw);
        let mut edges = dedupe(&raw, atom_operand.len());
        classify(&mut edges, &atom_operand);
        Self { curves, edges }
    }

    /// The edges bounding the region whose cover satisfies `keep`, directed
    /// with the region on their right.
    pub fn region_edges(&self, keep: impl Fn(u64) -> bool) -> Vec<DirEdge> {
        let mut out = Vec::new();
        for e in &self.edges {
            let (r, l) = (keep(e.right), keep(e.left));
            if r && !l {
                out.push(DirEdge {
                    from: e.a,
                    to: e.b,
                    src: e.src,
                });
            } else if l && !r {
                out.push(DirEdge {
                    from: e.b,
                    to: e.a,
                    src: e.src.reversed(),
                });
            }
        }
        out
    }

    /// Every non-empty cover some region has, in a stable order.
    pub fn labels(&self) -> Vec<u64> {
        let mut labels: Vec<u64> = self
            .edges
            .iter()
            .flat_map(|e| [e.right, e.left])
            .filter(|&m| m != 0)
            .collect();
        labels.sort_unstable();
        labels.dedup();
        labels
    }
}

/// Steps that keep a flattened cubic within the tolerance (Wang's formula).
fn cubic_steps(p0: Pt, p1: Pt, p2: Pt, p3: Pt) -> usize {
    let dd = |a: Pt, b: Pt, c: Pt| {
        let x = a.x - 2.0 * b.x + c.x;
        let y = a.y - 2.0 * b.y + c.y;
        (x * x + y * y).sqrt()
    };
    let m = dd(p0, p1, p2).max(dd(p1, p2, p3));
    let n = (0.75 * m / FLATTEN_TOLERANCE).sqrt().ceil();
    if n.is_finite() {
        (n as usize).clamp(1, MAX_STEPS)
    } else {
        1
    }
}

/// Flattens one closed loop into snapped edges, closing any gap with a line.
fn flatten_loop(lp: &[Seg], atom: u32, curves: &mut Vec<Seg>, out: &mut Vec<RawEdge>) {
    let finite = |p: Pt| p.x.is_finite() && p.y.is_finite();
    let segs: Vec<Seg> = lp
        .iter()
        .copied()
        .filter(|s| match *s {
            Seg::Line(a, b) => finite(a) && finite(b),
            Seg::Cubic(a, b, c, d) => finite(a) && finite(b) && finite(c) && finite(d),
        })
        .collect();
    let Some(first) = segs.first() else { return };
    let start = IPt::snap(first.start());
    let mut prev = start;
    for seg in segs {
        let s = IPt::snap(seg.start());
        if s != prev {
            // A gap between segments: bridge it.
            push_line(curves, out, atom, prev, s);
            prev = s;
        }
        let cid = curves.len() as u32;
        curves.push(seg);
        let steps = match seg {
            Seg::Line(..) => 1,
            Seg::Cubic(p0, p1, p2, p3) => cubic_steps(p0, p1, p2, p3),
        };
        let mut prev_t = 0.0;
        for i in 1..=steps {
            let t = if i == steps {
                1.0
            } else {
                i as f64 / steps as f64
            };
            let q = IPt::snap(seg.at(t));
            if q != prev {
                out.push(RawEdge {
                    a: prev,
                    b: q,
                    atom,
                    src: Src {
                        curve: cid,
                        t0: prev_t,
                        t1: t,
                    },
                });
                prev = q;
                prev_t = t;
            }
        }
    }
    if prev != start {
        push_line(curves, out, atom, prev, start);
    }
}

fn push_line(curves: &mut Vec<Seg>, out: &mut Vec<RawEdge>, atom: u32, a: IPt, b: IPt) {
    let cid = curves.len() as u32;
    curves.push(Seg::Line(a.pt(), b.pt()));
    out.push(RawEdge {
        a,
        b,
        atom,
        src: Src {
            curve: cid,
            t0: 0.0,
            t1: 1.0,
        },
    });
}

/// Whether `p` lies within the hot-pixel radius of the inside of `a → b`.
fn near_inside(a: IPt, b: IPt, p: IPt) -> bool {
    if p == a || p == b {
        return false;
    }
    let len2 = dot(a, b, b);
    let proj = dot(a, b, p);
    if proj <= 0 || proj >= len2 {
        return false;
    }
    let c = cross(a, b, p);
    c * c <= HOT * HOT * len2
}

/// Splits edges where they cross, touch, or overlap, until none do.
fn split(edges: &mut Vec<RawEdge>) {
    for _ in 0..MAX_ROUNDS {
        let mut cuts: Vec<Vec<IPt>> = vec![Vec::new(); edges.len()];
        let mut any = false;
        let lo = |e: &RawEdge| (e.a.x.min(e.b.x), e.a.y.min(e.b.y));
        let hi = |e: &RawEdge| (e.a.x.max(e.b.x), e.a.y.max(e.b.y));
        let mut order: Vec<usize> = (0..edges.len()).collect();
        order.sort_by_key(|&i| lo(&edges[i]).0);
        let hot = HOT as i64;
        let mut active: Vec<usize> = Vec::new();
        for &i in &order {
            let (x0, y0) = lo(&edges[i]);
            let (_, y1) = hi(&edges[i]);
            active.retain(|&j| hi(&edges[j]).0 + hot >= x0);
            for &j in &active {
                let (_, jy0) = lo(&edges[j]);
                let (_, jy1) = hi(&edges[j]);
                if jy1 + hot < y0 || y1 + hot < jy0 {
                    continue;
                }
                any |= cut_pair(&edges[i], &edges[j], i, j, &mut cuts);
            }
            active.push(i);
        }
        if !any {
            return;
        }
        let mut next = Vec::with_capacity(edges.len() + cuts.len());
        for (e, mut points) in edges.iter().zip(cuts) {
            if points.is_empty() {
                next.push(*e);
                continue;
            }
            let len2 = dot(e.a, e.b, e.b) as f64;
            let at = |p: IPt| dot(e.a, e.b, p) as f64 / len2;
            points.sort_by(|p, q| at(*p).total_cmp(&at(*q)));
            points.dedup();
            let mut prev = e.a;
            let mut prev_t = e.src.t0;
            for p in points.into_iter().chain(std::iter::once(e.b)) {
                if p == prev {
                    continue;
                }
                let t = if p == e.b {
                    e.src.t1
                } else {
                    e.src.t0 + (e.src.t1 - e.src.t0) * at(p).clamp(0.0, 1.0)
                };
                next.push(RawEdge {
                    a: prev,
                    b: p,
                    atom: e.atom,
                    src: Src {
                        curve: e.src.curve,
                        t0: prev_t,
                        t1: t,
                    },
                });
                prev = p;
                prev_t = t;
            }
        }
        *edges = next;
    }
}

/// Records where two edges must split; returns whether any split is needed.
fn cut_pair(e: &RawEdge, f: &RawEdge, i: usize, j: usize, cuts: &mut [Vec<IPt>]) -> bool {
    let mut any = false;
    for p in [f.a, f.b] {
        if near_inside(e.a, e.b, p) {
            cuts[i].push(p);
            any = true;
        }
    }
    for p in [e.a, e.b] {
        if near_inside(f.a, f.b, p) {
            cuts[j].push(p);
            any = true;
        }
    }
    let o1 = cross(e.a, e.b, f.a).signum();
    let o2 = cross(e.a, e.b, f.b).signum();
    let o3 = cross(f.a, f.b, e.a).signum();
    let o4 = cross(f.a, f.b, e.b).signum();
    if o1 * o2 < 0 && o3 * o4 < 0 {
        let r = (e.b.x - e.a.x, e.b.y - e.a.y);
        let s = (f.b.x - f.a.x, f.b.y - f.a.y);
        let denom = i128::from(r.0) * i128::from(s.1) - i128::from(r.1) * i128::from(s.0);
        let num = i128::from(f.a.x - e.a.x) * i128::from(s.1)
            - i128::from(f.a.y - e.a.y) * i128::from(s.0);
        let t = num as f64 / denom as f64;
        let q = IPt {
            x: (e.a.x as f64 + t * r.0 as f64).round() as i64,
            y: (e.a.y as f64 + t * r.1 as f64).round() as i64,
        };
        if q != e.a && q != e.b {
            cuts[i].push(q);
            any = true;
        }
        if q != f.a && q != f.b {
            cuts[j].push(q);
            any = true;
        }
    }
    any
}

/// Merges coincident edges, summing their directions per atom.
fn dedupe(raw: &[RawEdge], atoms: usize) -> Vec<Edge> {
    let mut index: HashMap<(IPt, IPt), usize> = HashMap::new();
    let mut edges: Vec<Edge> = Vec::new();
    for e in raw {
        let forward = e.a < e.b;
        let (a, b, src) = if forward {
            (e.a, e.b, e.src)
        } else {
            (e.b, e.a, e.src.reversed())
        };
        let k = *index.entry((a, b)).or_insert_with(|| {
            edges.push(Edge {
                a,
                b,
                src,
                d: vec![0; atoms],
                right: 0,
                left: 0,
            });
            edges.len() - 1
        });
        edges[k].d[e.atom as usize] += if forward { 1 } else { -1 };
    }
    edges.retain(|e| e.d.iter().any(|&d| d != 0));
    edges
}

/// Rows of edges by y, to find the edges a horizontal ray can cross.
struct Rows {
    y0: i64,
    height: i64,
    rows: Vec<Vec<usize>>,
}

impl Rows {
    fn new(edges: &[Edge]) -> Self {
        let y0 = edges.iter().map(|e| e.a.y.min(e.b.y)).min().unwrap_or(0);
        let y1 = edges.iter().map(|e| e.a.y.max(e.b.y)).max().unwrap_or(0);
        let count = (edges.len() / 4).clamp(1, 1024);
        let height = ((y1 - y0) / count as i64).max(1) + 1;
        let mut rows = vec![Vec::new(); count + 1];
        for (i, e) in edges.iter().enumerate() {
            if e.a.y == e.b.y {
                continue;
            }
            let r0 = ((e.a.y.min(e.b.y) - y0) / height) as usize;
            let r1 = ((e.a.y.max(e.b.y) - y0) / height) as usize;
            for row in &mut rows[r0.min(count)..=r1.min(count)] {
                row.push(i);
            }
        }
        Self { y0, height, rows }
    }

    /// Edges whose y-range may hold the doubled coordinate `y2`.
    fn at(&self, y2: i128) -> &[usize] {
        let y = (y2.div_euclid(2)) as i64;
        let r = (y - self.y0).div_euclid(self.height);
        if r < 0 {
            return &[];
        }
        self.rows.get(r as usize).map_or(&[], Vec::as_slice)
    }
}

/// Gives every edge the operands covering each side, from winding numbers
/// along a ray from its midpoint toward +x.
fn classify(edges: &mut [Edge], atom_operand: &[usize]) {
    let atoms = atom_operand.len();
    let rows = Rows::new(edges);
    let mask = |w: &[i32]| -> u64 {
        w.iter()
            .zip(atom_operand)
            .filter(|(w, _)| **w != 0)
            .fold(0u64, |m, (_, &o)| m | (1u64 << o))
    };
    let mut sides = Vec::with_capacity(edges.len());
    let mut w = vec![0i32; atoms];
    for (i, e) in edges.iter().enumerate() {
        // Doubled midpoint, so it stays on the integer grid.
        let mx = i128::from(e.a.x) + i128::from(e.b.x);
        let my = i128::from(e.a.y) + i128::from(e.b.y);
        w.iter_mut().for_each(|v| *v = 0);
        for &j in rows.at(my) {
            if j == i {
                continue;
            }
            let f = &edges[j];
            // Lower (smaller y) and upper end, doubled.
            let (p0, p1) = if f.a.y < f.b.y {
                (f.a, f.b)
            } else {
                (f.b, f.a)
            };
            let (x0, y0) = (2 * i128::from(p0.x), 2 * i128::from(p0.y));
            let (x1, y1) = (2 * i128::from(p1.x), 2 * i128::from(p1.y));
            // Half-open in y: the ray runs just below a vertex it meets.
            if !(y0 <= my && my < y1) {
                continue;
            }
            // Crossing to the right of the midpoint.
            let c = (x1 - x0) * (my - y0) - (mx - x0) * (y1 - y0);
            if c <= 0 {
                continue;
            }
            let down = if f.a.y < f.b.y { 1 } else { -1 };
            for (v, d) in w.iter_mut().zip(&f.d) {
                *v += d * down;
            }
        }
        // The two sides of the edge itself.
        let (right, left): (Vec<i32>, Vec<i32>) = if e.a.y == e.b.y {
            // Horizontal, running +x: right is below (the ray's side).
            (w.clone(), w.iter().zip(&e.d).map(|(v, d)| v - d).collect())
        } else {
            let down = if e.a.y < e.b.y { 1 } else { -1 };
            let east = w.clone();
            let west: Vec<i32> = w.iter().zip(&e.d).map(|(v, d)| v + d * down).collect();
            if down > 0 { (west, east) } else { (east, west) }
        };
        sides.push((mask(&right), mask(&left)));
    }
    for (e, (r, l)) in edges.iter_mut().zip(sides) {
        e.right = r;
        e.left = l;
    }
}
