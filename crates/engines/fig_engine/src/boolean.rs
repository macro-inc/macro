//! Boolean operations on filled paths: Figma's union, subtract, intersect,
//! and exclude, for boolean layers and flattening.
//!
//! An operand is a list of paths, each filled with its own winding rule.
//! Curves are flattened to short lines and every point is snapped to a fine
//! grid, so the arithmetic below is exact. Every edge is split where it
//! meets another and coincident pieces are merged. For each piece, the
//! operands' winding numbers on its two sides (counted with a ray from its
//! midpoint) say whether the result covers either side; the pieces with the
//! result on exactly one side are the result's outline. They are turned to
//! have the result on their left, chained into closed contours (filled
//! nonzero), and runs of pieces that came from one curve are drawn as that
//! curve again, so circles stay circles.

use std::collections::HashMap;
use tiny_skia::{FillRule, Path, PathBuilder, PathSegment};

/// How the operands combine. The first operand is the bottom layer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoolOp {
    Union,
    /// The first operand minus all the others.
    Subtract,
    Intersect,
    /// Covered by an odd number of operands.
    Exclude,
}

impl BoolOp {
    /// Figma's `booleanOperation` names (`XOR` is Exclude).
    pub fn parse(s: &str) -> Option<BoolOp> {
        match s {
            "UNION" => Some(BoolOp::Union),
            "SUBTRACT" => Some(BoolOp::Subtract),
            "INTERSECT" => Some(BoolOp::Intersect),
            "XOR" | "EXCLUDE" => Some(BoolOp::Exclude),
            _ => None,
        }
    }

    pub fn figma_name(self) -> &'static str {
        match self {
            BoolOp::Union => "UNION",
            BoolOp::Subtract => "SUBTRACT",
            BoolOp::Intersect => "INTERSECT",
            BoolOp::Exclude => "XOR",
        }
    }

    /// The layer name Figma gives a new boolean.
    pub fn label(self) -> &'static str {
        match self {
            BoolOp::Union => "Union",
            BoolOp::Subtract => "Subtract",
            BoolOp::Intersect => "Intersect",
            BoolOp::Exclude => "Exclude",
        }
    }

    fn covers(self, inside: &[bool]) -> bool {
        match self {
            BoolOp::Union => inside.iter().any(|&b| b),
            BoolOp::Subtract => {
                inside.first().copied().unwrap_or(false) && !inside[1..].iter().any(|&b| b)
            }
            BoolOp::Intersect => !inside.is_empty() && inside.iter().all(|&b| b),
            BoolOp::Exclude => inside.iter().filter(|&&b| b).count() % 2 == 1,
        }
    }
}

/// One operand: paths in a space shared by all operands, each with the
/// rule it is filled by.
pub type Operand = Vec<(Path, FillRule)>;

/// Grid points per unit.
const GRID: f64 = 4096.0;
/// Largest distance (units) between a curve and the lines standing in for it.
const TOLERANCE: f64 = 0.005;
const MAX_STEPS: usize = 256;

type Pt = (i64, i64);

/// A curve of the input, as a cubic; flattened edges point back to it.
type Cubic = [(f64, f64); 4];

/// Where an edge came from: a curve and the parameters at its two ends.
type Tag = Option<(u32, f64, f64)>;

#[derive(Clone, Copy)]
struct Edge {
    a: Pt,
    b: Pt,
    slot: u32,
    tag: Tag,
}

/// Coincident edge pieces, merged: the segment from `p` to `q` (`p` < `q`)
/// and, per piece, its path slot and direction (+1 from `p` to `q`).
struct Group {
    p: Pt,
    q: Pt,
    members: Vec<(u32, i32)>,
    tag: Tag,
}

/// The region `op` makes of `operands`, filled nonzero; `None` when empty.
pub fn combine(op: BoolOp, operands: &[Operand]) -> Option<Path> {
    let mut curves: Vec<Cubic> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    // Each path is a slot with its own winding; an operand covers a point
    // when any of its slots does.
    let mut slot_operand: Vec<usize> = Vec::new();
    let mut slot_rule: Vec<FillRule> = Vec::new();
    for (k, operand) in operands.iter().enumerate() {
        for (path, rule) in operand {
            let slot = slot_operand.len() as u32;
            slot_operand.push(k);
            slot_rule.push(*rule);
            flatten(path, slot, &mut curves, &mut edges);
        }
    }
    if edges.is_empty() {
        return None;
    }
    let pieces = split(&edges);
    let groups = merge(pieces);
    let kept = classify(op, &groups, &slot_operand, &slot_rule, operands.len());
    build(&chain(kept), &curves)
}

fn snap(x: f64, y: f64) -> Pt {
    ((x * GRID).round() as i64, (y * GRID).round() as i64)
}

fn unsnap(p: Pt) -> (f32, f32) {
    ((p.0 as f64 / GRID) as f32, (p.1 as f64 / GRID) as f32)
}

fn cubic_at(c: &Cubic, t: f64) -> (f64, f64) {
    let u = 1.0 - t;
    let (a, b, cc, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    (
        a * c[0].0 + b * c[1].0 + cc * c[2].0 + d * c[3].0,
        a * c[0].1 + b * c[1].1 + cc * c[2].1 + d * c[3].1,
    )
}

/// Flattens `path` (its contours closed, as filling closes them) into
/// `edges` for `slot`.
fn flatten(path: &Path, slot: u32, curves: &mut Vec<Cubic>, edges: &mut Vec<Edge>) {
    let mut start = (0.0, 0.0);
    let mut last = (0.0, 0.0);
    let mut open = false;
    let line = |edges: &mut Vec<Edge>, a: (f64, f64), b: (f64, f64)| {
        let (pa, pb) = (snap(a.0, a.1), snap(b.0, b.1));
        if pa != pb {
            edges.push(Edge {
                a: pa,
                b: pb,
                slot,
                tag: None,
            });
        }
    };
    let pt = |p: tiny_skia::Point| (f64::from(p.x), f64::from(p.y));
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(p) => {
                if open {
                    line(edges, last, start);
                }
                start = pt(p);
                last = start;
                open = true;
            }
            PathSegment::LineTo(p) => {
                let p = pt(p);
                line(edges, last, p);
                last = p;
            }
            PathSegment::QuadTo(c, p) => {
                let (c, p) = (pt(c), pt(p));
                let c1 = (
                    last.0 + (c.0 - last.0) * 2.0 / 3.0,
                    last.1 + (c.1 - last.1) * 2.0 / 3.0,
                );
                let c2 = (p.0 + (c.0 - p.0) * 2.0 / 3.0, p.1 + (c.1 - p.1) * 2.0 / 3.0);
                push_cubic([last, c1, c2, p], slot, curves, edges);
                last = p;
            }
            PathSegment::CubicTo(c1, c2, p) => {
                let p = pt(p);
                push_cubic([last, pt(c1), pt(c2), p], slot, curves, edges);
                last = p;
            }
            PathSegment::Close => {
                line(edges, last, start);
                last = start;
                open = false;
            }
        }
    }
    if open {
        line(edges, last, start);
    }
}

fn push_cubic(c: Cubic, slot: u32, curves: &mut Vec<Cubic>, edges: &mut Vec<Edge>) {
    // Uniform steps keep the chord error under the tolerance: it is at most
    // max|B''| / (8 n²), and |B''| ≤ 6 × the largest second difference.
    let dd = |i: usize| {
        let x = c[i].0 - 2.0 * c[i + 1].0 + c[i + 2].0;
        let y = c[i].1 - 2.0 * c[i + 1].1 + c[i + 2].1;
        (x * x + y * y).sqrt()
    };
    let l = dd(0).max(dd(1));
    let steps = ((0.75 * l / TOLERANCE).sqrt().ceil() as usize).clamp(1, MAX_STEPS);
    let id = curves.len() as u32;
    curves.push(c);
    let mut prev = snap(c[0].0, c[0].1);
    let mut prev_t = 0.0;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let (x, y) = if i == steps { c[3] } else { cubic_at(&c, t) };
        let p = snap(x, y);
        if p != prev {
            edges.push(Edge {
                a: prev,
                b: p,
                slot,
                tag: Some((id, prev_t, t)),
            });
            prev = p;
            prev_t = t;
        }
    }
}

fn sub(a: Pt, b: Pt) -> (i128, i128) {
    (i128::from(a.0 - b.0), i128::from(a.1 - b.1))
}

fn cross(a: (i128, i128), b: (i128, i128)) -> i128 {
    a.0 * b.1 - a.1 * b.0
}

fn dot(a: (i128, i128), b: (i128, i128)) -> i128 {
    a.0 * b.0 + a.1 * b.1
}

/// Splits every edge where it meets another (crossings, touching ends, and
/// overlaps), returning the pieces.
fn split(edges: &[Edge]) -> Vec<Edge> {
    let n = edges.len();
    let mut cuts: Vec<Vec<(f64, Pt)>> = vec![Vec::new(); n];
    let min_x = |e: &Edge| e.a.0.min(e.b.0);
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| min_x(&edges[i]));
    for (k, &i) in order.iter().enumerate() {
        let ei = &edges[i];
        let max_x = ei.a.0.max(ei.b.0);
        let (y0, y1) = (ei.a.1.min(ei.b.1), ei.a.1.max(ei.b.1));
        for &j in &order[k + 1..] {
            let ej = &edges[j];
            if min_x(ej) > max_x {
                break;
            }
            if ej.a.1.max(ej.b.1) < y0 || ej.a.1.min(ej.b.1) > y1 {
                continue;
            }
            intersect(ei, ej, i, j, &mut cuts);
        }
    }
    let mut out = Vec::with_capacity(n + n / 4);
    for (e, mut at) in edges.iter().zip(cuts) {
        if at.is_empty() {
            out.push(*e);
            continue;
        }
        at.sort_by(|x, y| x.0.total_cmp(&y.0));
        let mut from = e.a;
        let mut from_t = 0.0;
        for (t, p) in at.into_iter().chain(std::iter::once((1.0, e.b))) {
            if p == from {
                continue;
            }
            let tag = e
                .tag
                .map(|(id, t0, t1)| (id, t0 + (t1 - t0) * from_t, t0 + (t1 - t0) * t));
            out.push(Edge {
                a: from,
                b: p,
                slot: e.slot,
                tag,
            });
            from = p;
            from_t = t;
        }
    }
    out
}

/// Records where edges `i` and `j` meet, as cuts along each.
fn intersect(ei: &Edge, ej: &Edge, i: usize, j: usize, cuts: &mut [Vec<(f64, Pt)>]) {
    let r = sub(ei.b, ei.a);
    let s = sub(ej.b, ej.a);
    let qp = sub(ej.a, ei.a);
    let denom = cross(r, s);
    if denom == 0 {
        if cross(qp, r) != 0 {
            return;
        }
        // Collinear: each one's ends that lie inside the other cut it.
        let inside = |e: &Edge, d: (i128, i128), p: Pt| -> Option<f64> {
            let len2 = dot(d, d);
            let along = dot(sub(p, e.a), d);
            (along > 0 && along < len2).then(|| along as f64 / len2 as f64)
        };
        for p in [ej.a, ej.b] {
            if let Some(t) = inside(ei, r, p) {
                cuts[i].push((t, p));
            }
        }
        for p in [ei.a, ei.b] {
            if let Some(t) = inside(ej, s, p) {
                cuts[j].push((t, p));
            }
        }
        return;
    }
    let (mut t_num, mut u_num, mut d) = (cross(qp, s), cross(qp, r), denom);
    if d < 0 {
        (t_num, u_num, d) = (-t_num, -u_num, -d);
    }
    if t_num < 0 || t_num > d || u_num < 0 || u_num > d {
        return;
    }
    let point = if u_num == 0 {
        ej.a
    } else if u_num == d {
        ej.b
    } else if t_num == 0 {
        ei.a
    } else if t_num == d {
        ei.b
    } else {
        let t = t_num as f64 / d as f64;
        (
            (ei.a.0 as f64 + r.0 as f64 * t).round() as i64,
            (ei.a.1 as f64 + r.1 as f64 * t).round() as i64,
        )
    };
    if t_num > 0 && t_num < d && point != ei.a && point != ei.b {
        cuts[i].push((t_num as f64 / d as f64, point));
    }
    if u_num > 0 && u_num < d && point != ej.a && point != ej.b {
        cuts[j].push((u_num as f64 / d as f64, point));
    }
}

/// Merges coincident pieces.
fn merge(pieces: Vec<Edge>) -> Vec<Group> {
    let mut index: HashMap<(Pt, Pt), usize> = HashMap::with_capacity(pieces.len());
    let mut groups: Vec<Group> = Vec::with_capacity(pieces.len());
    for e in pieces {
        let forward = e.a < e.b;
        let (p, q) = if forward { (e.a, e.b) } else { (e.b, e.a) };
        let dir = if forward { 1 } else { -1 };
        match index.get(&(p, q)) {
            Some(&g) => groups[g].members.push((e.slot, dir)),
            None => {
                index.insert((p, q), groups.len());
                groups.push(Group {
                    p,
                    q,
                    members: vec![(e.slot, dir)],
                    tag: if forward {
                        e.tag
                    } else {
                        e.tag.map(|(id, t0, t1)| (id, t1, t0))
                    },
                });
            }
        }
    }
    groups
}

/// The groups on the result's outline, as directed edges with the result on
/// their left.
fn classify(
    op: BoolOp,
    groups: &[Group],
    slot_operand: &[usize],
    slot_rule: &[FillRule],
    operand_count: usize,
) -> Vec<(Pt, Pt, Tag)> {
    // Horizontal bands of the groups each crosses, for the ray counts.
    let (y_min, y_max) = groups.iter().fold((i64::MAX, i64::MIN), |(lo, hi), g| {
        (lo.min(g.p.1.min(g.q.1)), hi.max(g.p.1.max(g.q.1)))
    });
    let bands = ((groups.len() as f64).sqrt() as usize).clamp(1, 2048);
    let span = (y_max - y_min + 1) as f64 / bands as f64;
    let band_of = |y: f64| (((y - y_min as f64) / span) as usize).min(bands - 1);
    let mut band: Vec<Vec<u32>> = vec![Vec::new(); bands];
    for (k, g) in groups.iter().enumerate() {
        let (lo, hi) = (g.p.1.min(g.q.1), g.p.1.max(g.q.1));
        if lo == hi {
            continue; // Horizontal pieces never count for a horizontal ray.
        }
        for b in band
            .iter_mut()
            .take(band_of(hi as f64) + 1)
            .skip(band_of(lo as f64))
        {
            b.push(k as u32);
        }
    }
    let slots = slot_operand.len();
    let mut h = vec![0i32; slots];
    let mut d = vec![0i32; slots];
    let mut inside = vec![false; operand_count];
    let mut kept = Vec::new();
    let covered = |w: &[i32], inside: &mut [bool]| {
        inside.iter_mut().for_each(|b| *b = false);
        for (s, &wn) in w.iter().enumerate() {
            let hit = match slot_rule[s] {
                FillRule::Winding => wn != 0,
                FillRule::EvenOdd => wn % 2 != 0,
            };
            if hit {
                inside[slot_operand[s]] = true;
            }
        }
        op.covers(inside)
    };
    let mut left = vec![0i32; slots];
    let mut right = vec![0i32; slots];
    for (k, g) in groups.iter().enumerate() {
        h.iter_mut().for_each(|v| *v = 0);
        d.iter_mut().for_each(|v| *v = 0);
        // Doubled coordinates keep the midpoint on the grid.
        let m = (g.p.0 + g.q.0, g.p.1 + g.q.1);
        for &o in &band[band_of(m.1 as f64 / 2.0)] {
            if o as usize == k {
                continue;
            }
            let other = &groups[o as usize];
            let a = (other.p.0 * 2, other.p.1 * 2);
            let b = (other.q.0 * 2, other.q.1 * 2);
            let side = cross(sub(b, a), sub(m, a));
            let c = if a.1 <= m.1 && m.1 < b.1 && side > 0 {
                1
            } else if b.1 <= m.1 && m.1 < a.1 && side < 0 {
                -1
            } else {
                0
            };
            if c != 0 {
                for &(slot, dir) in &other.members {
                    h[slot as usize] += c * dir;
                }
            }
        }
        for &(slot, dir) in &g.members {
            d[slot as usize] += dir;
        }
        // The count is the winding on the ray's side of the piece: its +x
        // side, or +y for a horizontal piece. Crossing the piece from its
        // right to its left adds `d`.
        for s in 0..slots {
            if g.q.1 > g.p.1 {
                right[s] = h[s];
                left[s] = h[s] + d[s];
            } else {
                left[s] = h[s];
                right[s] = h[s] - d[s];
            }
        }
        let l = covered(&left, &mut inside);
        let r = covered(&right, &mut inside);
        if l != r {
            kept.push(if l {
                (g.p, g.q, g.tag)
            } else {
                (g.q, g.p, g.tag.map(|(id, t0, t1)| (id, t1, t0)))
            });
        }
    }
    kept
}

/// Chains directed edges into closed contours.
fn chain(edges: Vec<(Pt, Pt, Tag)>) -> Vec<Vec<(Pt, Pt, Tag)>> {
    let mut from: HashMap<Pt, Vec<usize>> = HashMap::with_capacity(edges.len());
    for (k, e) in edges.iter().enumerate() {
        from.entry(e.0).or_default().push(k);
    }
    let mut used = vec![false; edges.len()];
    let mut contours = Vec::new();
    for start in 0..edges.len() {
        if used[start] {
            continue;
        }
        let mut contour = Vec::new();
        let mut at = start;
        loop {
            used[at] = true;
            contour.push(edges[at]);
            let next = from
                .get(&edges[at].1)
                .and_then(|list| list.iter().copied().find(|&n| !used[n]));
            match next {
                Some(n) => at = n,
                None => break,
            }
        }
        if contour.len() >= 2 {
            contours.push(contour);
        }
    }
    contours
}

/// The cubic `c` between parameters `t0` and `t1` (either order).
fn sub_cubic(c: &Cubic, t0: f64, t1: f64) -> Cubic {
    if t0 > t1 {
        let [a, b, cc, d] = sub_cubic(c, t1, t0);
        return [d, cc, b, a];
    }
    let lerp =
        |a: (f64, f64), b: (f64, f64), t: f64| (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
    // Left part, [0, t1].
    let split_left = |c: &Cubic, t: f64| -> Cubic {
        let ab = lerp(c[0], c[1], t);
        let bc = lerp(c[1], c[2], t);
        let cd = lerp(c[2], c[3], t);
        let abc = lerp(ab, bc, t);
        let bcd = lerp(bc, cd, t);
        [c[0], ab, abc, lerp(abc, bcd, t)]
    };
    let split_right = |c: &Cubic, t: f64| -> Cubic {
        let ab = lerp(c[0], c[1], t);
        let bc = lerp(c[1], c[2], t);
        let cd = lerp(c[2], c[3], t);
        let abc = lerp(ab, bc, t);
        let bcd = lerp(bc, cd, t);
        [lerp(abc, bcd, t), bcd, cd, c[3]]
    };
    let left = if t1 < 1.0 { split_left(c, t1) } else { *c };
    if t0 <= 0.0 || t1 <= 0.0 {
        return left;
    }
    split_right(&left, t0 / t1)
}

/// Draws the contours, with runs from one curve as that curve.
fn build(contours: &[Vec<(Pt, Pt, Tag)>], curves: &[Cubic]) -> Option<Path> {
    let mut pb = PathBuilder::new();
    for contour in contours {
        let (x, y) = unsnap(contour[0].0);
        pb.move_to(x, y);
        let mut k = 0;
        while k < contour.len() {
            let (a, mut b, tag) = contour[k];
            k += 1;
            match tag {
                Some((id, t0, mut t1)) => {
                    // Extend through pieces continuing the same curve.
                    while k < contour.len() {
                        match contour[k].2 {
                            Some((id2, s0, s1))
                                if id2 == id
                                    && (s0 - t1).abs() < 1e-9
                                    && (s1 - s0).signum() == (t1 - t0).signum() =>
                            {
                                t1 = s1;
                                b = contour[k].1;
                                k += 1;
                            }
                            _ => break,
                        }
                    }
                    let c = sub_cubic(&curves[id as usize], t0, t1);
                    let (bx, by) = unsnap(b);
                    pb.cubic_to(
                        c[1].0 as f32,
                        c[1].1 as f32,
                        c[2].0 as f32,
                        c[2].1 as f32,
                        bx,
                        by,
                    );
                }
                None => {
                    // Merge straight runs along one line.
                    while k < contour.len() && contour[k].2.is_none() {
                        let next = contour[k].1;
                        if cross(sub(b, a), sub(next, b)) != 0 || dot(sub(b, a), sub(next, b)) <= 0
                        {
                            break;
                        }
                        b = next;
                        k += 1;
                    }
                    let (bx, by) = unsnap(b);
                    pb.line_to(bx, by);
                }
            }
        }
        pb.close();
    }
    pb.finish()
}

#[cfg(test)]
mod test;
