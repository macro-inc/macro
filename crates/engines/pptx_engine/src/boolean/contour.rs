//! Result contours: chaining directed edges into loops, grouping holes
//! with the outer contour around them, and turning edge runs back into the
//! source lines and curves.

use super::arrangement::{DirEdge, IPt, SCALE};
use super::{Pt, Seg};
use std::collections::HashMap;

/// Loops smaller than this (square points) are rounding slivers.
const MIN_AREA: f64 = 0.01;

/// Chains edges (each with the region on its right) into closed loops. At a
/// vertex where several loops touch, the walk takes the sharpest right
/// turn, so loops stay simple and only touch.
pub(super) fn chain(edges: &[DirEdge]) -> Vec<Vec<DirEdge>> {
    let mut out_of: HashMap<IPt, Vec<usize>> = HashMap::new();
    for (i, e) in edges.iter().enumerate() {
        out_of.entry(e.from).or_default().push(i);
    }
    let mut used = vec![false; edges.len()];
    let mut loops = Vec::new();
    for start in 0..edges.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let mut lp = vec![edges[start]];
        let mut at = start;
        loop {
            let cur = edges[at];
            let candidates = out_of.get(&cur.to).map_or(&[][..], Vec::as_slice);
            let din = (
                (cur.to.x - cur.from.x) as f64,
                (cur.to.y - cur.from.y) as f64,
            );
            let mut best: Option<(f64, usize)> = None;
            for &c in candidates {
                if used[c] && c != start {
                    continue;
                }
                let e = edges[c];
                let dout = ((e.to.x - e.from.x) as f64, (e.to.y - e.from.y) as f64);
                // Positive turns are to the right (y points down).
                let turn = (din.0 * dout.1 - din.1 * dout.0).atan2(din.0 * dout.0 + din.1 * dout.1);
                if best.is_none_or(|(t, _)| turn > t) {
                    best = Some((turn, c));
                }
            }
            match best {
                Some((_, c)) if c == start => break,
                Some((_, c)) => {
                    used[c] = true;
                    lp.push(edges[c]);
                    at = c;
                }
                // An open end (should not happen): close the loop as it is.
                None => break,
            }
        }
        loops.push(lp);
    }
    loops
}

/// Twice the signed area of a loop in grid units (positive: clockwise on screen).
fn area2(lp: &[DirEdge]) -> f64 {
    lp.iter()
        .map(|e| {
            (i128::from(e.from.x) * i128::from(e.to.y) - i128::from(e.to.x) * i128::from(e.from.y))
                as f64
        })
        .sum()
}

/// Whether a loop is too small to keep.
pub(super) fn is_sliver(lp: &[DirEdge]) -> bool {
    lp.len() < 3 || (area2(lp) / 2.0).abs() < MIN_AREA * SCALE * SCALE
}

/// Whether the doubled point `(x, y)` is inside a loop (non-zero winding).
fn contains(lp: &[DirEdge], x: i128, y: i128) -> bool {
    let mut w = 0;
    for e in lp {
        let (p0, p1, dir) = if e.from.y < e.to.y {
            (e.from, e.to, 1)
        } else {
            (e.to, e.from, -1)
        };
        let (x0, y0) = (2 * i128::from(p0.x), 2 * i128::from(p0.y));
        let (x1, y1) = (2 * i128::from(p1.x), 2 * i128::from(p1.y));
        if y0 == y1 || !(y0 <= y && y < y1) {
            continue;
        }
        if (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0 {
            w += dir;
        }
    }
    w != 0
}

/// Groups loops into connected pieces: each outer loop with the holes it
/// directly surrounds.
pub(super) fn assemble(loops: Vec<Vec<DirEdge>>) -> Vec<Vec<Vec<DirEdge>>> {
    let (outers, holes): (Vec<_>, Vec<_>) = loops.into_iter().partition(|l| area2(l) > 0.0);
    let areas: Vec<f64> = outers.iter().map(|l| area2(l)).collect();
    let mut pieces: Vec<Vec<Vec<DirEdge>>> = outers.into_iter().map(|l| vec![l]).collect();
    for hole in holes {
        let e = hole[0];
        let (x, y) = (
            i128::from(e.from.x) + i128::from(e.to.x),
            i128::from(e.from.y) + i128::from(e.to.y),
        );
        let owner = pieces
            .iter()
            .enumerate()
            .filter(|(_, p)| contains(&p[0], x, y))
            .min_by(|(i, _), (j, _)| areas[*i].total_cmp(&areas[*j]))
            .map(|(i, _)| i);
        if let Some(i) = owner {
            pieces[i].push(hole);
        }
    }
    // Top-left pieces first.
    pieces.sort_by_key(|p| {
        let min = p[0].iter().map(|e| (e.from.y, e.from.x)).min();
        min.unwrap_or_default()
    });
    pieces
}

/// Rebuilds a loop's segments: runs of edges along one source line or curve
/// become that line or the curve's part between the run's ends.
pub(super) fn to_segs(lp: &[DirEdge], curves: &[Seg]) -> Vec<Seg> {
    let n = lp.len();
    if n == 0 {
        return Vec::new();
    }
    let joins = |a: &DirEdge, b: &DirEdge| {
        a.src.curve == b.src.curve
            && a.src.t1 == b.src.t0
            && (a.src.t1 - a.src.t0).signum() == (b.src.t1 - b.src.t0).signum()
    };
    // Start at a run boundary so no run wraps around.
    let first = (0..n)
        .find(|&i| !joins(&lp[(i + n - 1) % n], &lp[i]))
        .unwrap_or(0);
    let mut segs: Vec<Seg> = Vec::new();
    let mut i = 0;
    while i < n {
        let head = lp[(first + i) % n];
        let mut last = head;
        let mut j = i + 1;
        while j < n && joins(&last, &lp[(first + j) % n]) {
            last = lp[(first + j) % n];
            j += 1;
        }
        let (from, to) = (head.from.pt(), last.to.pt());
        let seg = match curves.get(head.src.curve as usize) {
            Some(c @ Seg::Cubic(..)) => match c.part(head.src.t0, last.src.t1) {
                // Pin the ends to the snapped vertices, keeping the tangents.
                Seg::Cubic(p0, p1, p2, p3) => {
                    Seg::Cubic(from, p1.add(from.sub(p0)), p2.add(to.sub(p3)), to)
                }
                line => line,
            },
            _ => Seg::Line(from, to),
        };
        if from != to {
            segs.push(seg);
        }
        i = j;
    }
    merge_collinear(segs)
}

/// Joins consecutive lines that continue in the same direction.
fn merge_collinear(segs: Vec<Seg>) -> Vec<Seg> {
    let straight = |a: Pt, b: Pt, c: Pt| {
        let (ux, uy) = (b.x - a.x, b.y - a.y);
        let (vx, vy) = (c.x - b.x, c.y - b.y);
        let cross = ux * vy - uy * vx;
        let dot = ux * vx + uy * vy;
        dot > 0.0 && cross.abs() <= 1e-6 * (ux.hypot(uy) * vx.hypot(vy)).max(1e-12)
    };
    let mut out: Vec<Seg> = Vec::with_capacity(segs.len());
    for s in segs {
        if let Some(last) = out.last_mut()
            && let (Seg::Line(a, b), Seg::Line(_, c)) = (*last, s)
            && straight(a, b, c)
        {
            *last = Seg::Line(a, c);
            continue;
        }
        out.push(s);
    }
    // The loop's seam.
    if out.len() > 2
        && let (Some(&Seg::Line(a, b)), Some(&Seg::Line(_, c))) = (out.last(), out.first())
        && straight(a, b, c)
    {
        out.pop();
        out[0] = Seg::Line(a, c);
    }
    out
}
