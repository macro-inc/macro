//! Selection outlines for marching ants: marching squares over pixel
//! centers at half coverage, linked into closed polygons, then simplified.
//!
//! Crossings are interpolated along the edges between pixel centers, so
//! antialiased edges trace smoothly. Where a hard edge (full against none)
//! turns a corner, the outline keeps the pixel corner rather than cutting
//! it, so hard-edged selections trace their pixels exactly (a rectangle is
//! its four corners). Polygons keep the selected side on their left as
//! seen on screen: outer edges run counterclockwise and holes clockwise.
//! Simplification ranks every point by Douglas–Peucker (the tolerance at
//! which it would go) and keeps the most important within the budget.

use crate::raster::{IRect, Selection};
use std::collections::HashMap;

/// The coverage the outline follows (between 127 and 128).
const LEVEL: f64 = 127.5;
/// How close to midway two crossings must be to keep the corner between
/// them.
const HARD: f64 = 0.01;

/// One of a cell's four edges: top, right, bottom, left.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    T,
    R,
    B,
    L,
}

/// The edge between two pixel centers: `(x, y)` and its right neighbor
/// (horizontal) or the one below (vertical).
type Edge = (i32, i32, bool);

/// A piece of outline across one cell.
struct Piece {
    /// Where it starts (a crossing), and the pixel corner after it.
    start: (f64, f64),
    corner: Option<(f64, f64)>,
    /// The edge it leaves through.
    to: Edge,
}

/// Each case's crossing pairs (corner bits: top left 8, top right 4,
/// bottom right 2, bottom left 1); saddles are decided per cell.
fn pairs(case: u8, joined: bool) -> &'static [(Side, Side)] {
    use Side::*;
    match case {
        1 | 14 => &[(L, B)],
        2 | 13 => &[(B, R)],
        3 | 12 => &[(L, R)],
        4 | 11 => &[(T, R)],
        6 | 9 => &[(T, B)],
        7 | 8 => &[(T, L)],
        5 if joined => &[(T, L), (B, R)],
        5 => &[(T, R), (L, B)],
        10 if joined => &[(T, R), (L, B)],
        10 => &[(T, L), (B, R)],
        _ => &[],
    }
}

/// The selection's outline polygons, simplified to about `max_points`.
pub(super) fn outline(selection: &Selection, max_points: usize) -> Vec<Vec<(f32, f32)>> {
    let Some(bounds) = selection.mask.content_bounds() else {
        return Vec::new();
    };
    let polygons = trace(selection, bounds.outset(1));
    simplify(polygons, max_points)
}

/// Marches over the cells of `grid` (whose border is unselected), linking
/// the pieces into closed polygons.
fn trace(selection: &Selection, grid: IRect) -> Vec<Vec<(f64, f64)>> {
    let w = grid.w as usize;
    let words = w.div_ceil(64);
    let mut pieces: HashMap<Edge, Piece> = HashMap::new();
    let mut starts: Vec<Edge> = Vec::new();
    let mut top = vec![0u8; w];
    let mut bottom = vec![0u8; w];
    let mut top_bits = vec![0u64; words];
    let mut bottom_bits = vec![0u64; words];
    let read = |y: i32, row: &mut [u8], bits: &mut [u64]| {
        selection.mask.read(IRect::new(grid.x, y, grid.w, 1), row);
        bits.fill(0);
        for (i, &v) in row.iter().enumerate() {
            if f64::from(v) > LEVEL {
                bits[i / 64] |= 1 << (i % 64);
            }
        }
    };
    read(grid.y, &mut top, &mut top_bits);
    for y in grid.y..grid.bottom() - 1 {
        read(y + 1, &mut bottom, &mut bottom_bits);
        for word in 0..words {
            // Cells whose four corners are not all alike.
            let next = |bits: &[u64]| bits.get(word + 1).map_or(0, |&b| b << 63);
            let (a, b) = (top_bits[word], bottom_bits[word]);
            let (a1, b1) = (a >> 1 | next(&top_bits), b >> 1 | next(&bottom_bits));
            let mut mixed = (a ^ b) | (a ^ a1) | (b ^ b1);
            while mixed != 0 {
                let bit = mixed.trailing_zeros() as usize;
                mixed &= mixed - 1;
                let i = word * 64 + bit;
                if i + 1 >= w {
                    break;
                }
                let corners = [top[i], top[i + 1], bottom[i + 1], bottom[i]];
                cell(grid.x + i as i32, y, corners, &mut pieces, &mut starts);
            }
        }
        std::mem::swap(&mut top, &mut bottom);
        std::mem::swap(&mut top_bits, &mut bottom_bits);
    }
    link(pieces, &starts)
}

/// Adds the pieces of the cell whose top left pixel is `(x, y)`, with
/// coverages `[top left, top right, bottom right, bottom left]`.
fn cell(
    x: i32,
    y: i32,
    corners: [u8; 4],
    pieces: &mut HashMap<Edge, Piece>,
    starts: &mut Vec<Edge>,
) {
    let v = corners.map(f64::from);
    let inside = v.map(|v| v > LEVEL);
    let case = (u8::from(inside[0]) << 3)
        | (u8::from(inside[1]) << 2)
        | (u8::from(inside[2]) << 1)
        | u8::from(inside[3]);
    let joined = v.iter().sum::<f64>() / 4.0 > LEVEL;
    // Pixel centers of the corners.
    let (x0, y0) = (f64::from(x) + 0.5, f64::from(y) + 0.5);
    let pos = [
        (x0, y0),
        (x0 + 1.0, y0),
        (x0 + 1.0, y0 + 1.0),
        (x0, y0 + 1.0),
    ];
    // Each side's corners (as indices into `v`), and its edge.
    let side = |s: Side| -> (usize, usize, Edge) {
        match s {
            Side::T => (0, 1, (x, y, false)),
            Side::R => (1, 2, (x + 1, y, true)),
            Side::B => (3, 2, (x, y + 1, false)),
            Side::L => (0, 3, (x, y, true)),
        }
    };
    // Where the outline crosses a side, and how far along it.
    let crossing = |s: Side| -> ((f64, f64), f64) {
        let (a, b, _) = side(s);
        let t = (LEVEL - v[a]) / (v[b] - v[a]);
        let (pa, pb) = (pos[a], pos[b]);
        ((pa.0 + (pb.0 - pa.0) * t, pa.1 + (pb.1 - pa.1) * t), t)
    };
    let odd_corner = matches!(case, 1 | 2 | 4 | 8 | 7 | 11 | 13 | 14);
    for &(s1, s2) in pairs(case, joined) {
        let (mut p, t1) = crossing(s1);
        let (mut q, t2) = crossing(s2);
        let (mut from, mut to) = (side(s1).2, side(s2).2);
        // Keep the selected side on the left: s1's selected corner must
        // lie left of p → q (with y down, left of (dx, dy) is (dy, -dx)).
        let (a, b, _) = side(s1);
        let c = if inside[a] { pos[a] } else { pos[b] };
        let (dx, dy) = (q.0 - p.0, q.1 - p.1);
        if (c.0 - p.0) * dy - (c.1 - p.1) * dx < 0.0 {
            std::mem::swap(&mut p, &mut q);
            std::mem::swap(&mut from, &mut to);
        }
        let corner = (odd_corner && (t1 - 0.5).abs() < HARD && (t2 - 0.5).abs() < HARD)
            .then_some((x0 + 0.5, y0 + 0.5));
        pieces.insert(
            from,
            Piece {
                start: p,
                corner,
                to,
            },
        );
        starts.push(from);
    }
}

/// Follows pieces edge to edge into closed polygons.
fn link(mut pieces: HashMap<Edge, Piece>, starts: &[Edge]) -> Vec<Vec<(f64, f64)>> {
    let mut polygons = Vec::new();
    for &start in starts {
        let mut polygon = Vec::new();
        let mut at = start;
        while let Some(piece) = pieces.remove(&at) {
            polygon.push(piece.start);
            polygon.extend(piece.corner);
            at = piece.to;
        }
        if polygon.len() >= 3 {
            polygons.push(polygon);
        }
    }
    polygons
}

/// Drops points on a straight line between their neighbors.
fn drop_collinear(polygon: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let n = polygon.len();
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(n);
    for i in 0..n {
        let p = polygon[i];
        let prev = out.last().copied().unwrap_or(polygon[(i + n - 1) % n]);
        let next = polygon[(i + 1) % n];
        if !straight(prev, p, next) {
            out.push(p);
        }
    }
    // The first point may have become collinear with the last kept ones.
    while out.len() > 3 {
        let k = out.len();
        if straight(out[k - 2], out[k - 1], out[0]) {
            out.pop();
        } else if straight(out[k - 1], out[0], out[1]) {
            out.remove(0);
        } else {
            break;
        }
    }
    out
}

/// Whether `b` lies on the straight way from `a` to `c`.
fn straight(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> bool {
    let (ux, uy) = (b.0 - a.0, b.1 - a.1);
    let (vx, vy) = (c.0 - b.0, c.1 - b.1);
    (ux * vy - uy * vx).abs() < 1e-9 && ux * vx + uy * vy >= 0.0
}

/// Distance from `p` to the segment `a`–`b`.
fn segment_distance(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (p.0 - a.0 - t * dx).hypot(p.1 - a.1 - t * dy)
}

/// Douglas–Peucker importance of each point of a closed polygon: the
/// tolerance at which simplification would drop it (three points always
/// stay).
fn importance(polygon: &[(f64, f64)]) -> Vec<f64> {
    let n = polygon.len();
    let mut out = vec![f64::INFINITY; n];
    if n <= 3 {
        return out;
    }
    let d2 = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2);
    let far = (1..n)
        .max_by(|&a, &b| d2(polygon[0], polygon[a]).total_cmp(&d2(polygon[0], polygon[b])))
        .unwrap_or(1);
    // Chains from i to j (j == n is point 0 again), each under the
    // importance of the point that split it.
    let mut chains = vec![(0, far, f64::INFINITY), (far, n, f64::INFINITY)];
    while let Some((i, j, limit)) = chains.pop() {
        if j - i < 2 {
            continue;
        }
        let (a, b) = (polygon[i], polygon[j % n]);
        let (k, d) = (i + 1..j)
            .map(|k| (k, segment_distance(polygon[k], a, b)))
            .max_by(|x, y| x.1.total_cmp(&y.1))
            .unwrap_or((i + 1, 0.0));
        let v = d.min(limit);
        out[k] = v;
        chains.push((i, k, v));
        chains.push((k, j, v));
    }
    // Keep a third point: the most important of the rest.
    if let Some(third) = (0..n)
        .filter(|&k| out[k].is_finite())
        .max_by(|&a, &b| out[a].total_cmp(&out[b]))
    {
        out[third] = f64::INFINITY;
    }
    out
}

/// Twice the signed area of a polygon.
fn area2(polygon: &[(f64, f64)]) -> f64 {
    let n = polygon.len();
    (0..n)
        .map(|i| {
            let (a, b) = (polygon[i], polygon[(i + 1) % n]);
            a.0 * b.1 - b.0 * a.1
        })
        .sum()
}

/// Simplifies polygons to about `max_points` points in all, dropping the
/// smallest polygons when even three points each are too many.
fn simplify(polygons: Vec<Vec<(f64, f64)>>, max_points: usize) -> Vec<Vec<(f32, f32)>> {
    let mut polygons: Vec<Vec<(f64, f64)>> = polygons
        .iter()
        .map(|p| drop_collinear(p))
        .filter(|p| p.len() >= 3)
        .collect();
    let total: usize = polygons.iter().map(Vec::len).sum();
    if total > max_points {
        if polygons.len() * 3 > max_points {
            polygons.sort_by(|a, b| area2(b).abs().total_cmp(&area2(a).abs()));
            polygons.truncate(max_points / 3);
        }
        let ranks: Vec<Vec<f64>> = polygons.iter().map(|p| importance(p)).collect();
        let fixed: usize = ranks.iter().flatten().filter(|v| v.is_infinite()).count();
        let mut finite: Vec<f64> = ranks
            .iter()
            .flatten()
            .copied()
            .filter(|v| v.is_finite())
            .collect();
        let budget = max_points.saturating_sub(fixed);
        let threshold = if budget >= finite.len() {
            f64::NEG_INFINITY
        } else {
            finite.sort_by(|a, b| b.total_cmp(a));
            finite[budget]
        };
        polygons = polygons
            .iter()
            .zip(&ranks)
            .map(|(p, r)| {
                p.iter()
                    .zip(r)
                    .filter(|&(_, &v)| v > threshold)
                    .map(|(&q, _)| q)
                    .collect()
            })
            .collect();
    }
    polygons
        .into_iter()
        .map(|p| p.into_iter().map(|(x, y)| (x as f32, y as f32)).collect())
        .collect()
}
