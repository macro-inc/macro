//! Path geometry: Figma's command blobs, rounded rectangles, hit testing,
//! and SVG path data for outlines.
//!
//! A command blob is a sequence of one-byte commands with little-endian
//! `f32` operands: `0` close, `1` move (x y), `2` line (x y), `3` quadratic
//! (cx cy x y), `4` cubic (c1x c1y c2x c2y x y).

use crate::model::{Affine, CornerRadii, Rect, Vec2, WindingRule};
use std::fmt::Write;
use tiny_skia::{Path, PathBuilder, PathSegment};

pub struct ParsedPath {
    pub path: Path,
}

impl ParsedPath {
    pub fn bounds(&self) -> Rect {
        let b = self.path.bounds();
        Rect::new(
            f64::from(b.x()),
            f64::from(b.y()),
            f64::from(b.width()),
            f64::from(b.height()),
        )
    }

    /// Whether `p` (path coordinates) is inside the filled path.
    pub fn contains(&self, p: Vec2, rule: WindingRule) -> bool {
        if !self.bounds().contains(p) {
            return false;
        }
        let winding = winding_number(&self.path, p);
        match rule {
            WindingRule::NonZero => winding != 0,
            WindingRule::EvenOdd => winding % 2 != 0,
        }
    }
}

fn read_f32s<const N: usize>(bytes: &[u8], at: &mut usize) -> Option<[f32; N]> {
    let mut out = [0.0; N];
    for v in &mut out {
        let b = bytes.get(*at..*at + 4)?;
        *v = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        if !v.is_finite() {
            return None;
        }
        *at += 4;
    }
    Some(out)
}

/// Parses a geometry blob; `None` for empty or malformed geometry.
pub fn parse_blob(bytes: &[u8]) -> Option<ParsedPath> {
    let mut pb = PathBuilder::new();
    let mut at = 0;
    while at < bytes.len() {
        let cmd = bytes[at];
        at += 1;
        match cmd {
            0 => pb.close(),
            1 => {
                let [x, y] = read_f32s(bytes, &mut at)?;
                pb.move_to(x, y);
            }
            2 => {
                let [x, y] = read_f32s(bytes, &mut at)?;
                pb.line_to(x, y);
            }
            3 => {
                let [cx, cy, x, y] = read_f32s(bytes, &mut at)?;
                pb.quad_to(cx, cy, x, y);
            }
            4 => {
                let [c1x, c1y, c2x, c2y, x, y] = read_f32s(bytes, &mut at)?;
                pb.cubic_to(c1x, c1y, c2x, c2y, x, y);
            }
            _ => break,
        }
    }
    pb.finish().map(|path| ParsedPath { path })
}

/// A rectangle with per-corner radii. `smoothing` (Figma's corner
/// smoothing, 0..1) stretches each corner into a squircle-like curve.
pub fn rounded_rect(w: f32, h: f32, radii: CornerRadii, smoothing: f32) -> Option<Path> {
    if !(w > 0.0 && h > 0.0) {
        return None;
    }
    if radii.is_zero() {
        return tiny_skia::Rect::from_xywh(0.0, 0.0, w, h).map(PathBuilder::from_rect);
    }
    // Scale radii down uniformly when adjacent ones overlap (CSS rule).
    let mut r = [
        radii.top_left.max(0.0),
        radii.top_right.max(0.0),
        radii.bottom_right.max(0.0),
        radii.bottom_left.max(0.0),
    ];
    let mut factor = 1.0f32;
    for (a, b, side) in [(0, 1, w), (1, 2, h), (2, 3, w), (3, 0, h)] {
        let sum = r[a] + r[b];
        if sum > side {
            factor = factor.min(side / sum);
        }
    }
    for v in &mut r {
        *v *= factor;
    }
    // Circular arcs as cubics use κ ≈ 0.5523; smoothing pulls the handles
    // toward the edges (a squircle-like corner, as in Figma).
    let s = smoothing.clamp(0.0, 1.0);
    let k = 0.552_284_8 + 0.2 * s;
    let ext = |rad: f32| rad * (1.0 + 0.6 * s);
    let mut pb = PathBuilder::new();
    let [tl, tr, br, bl] = r;
    let (etl, etr, ebr, ebl) = (
        ext(tl).min(w / 2.0).min(h / 2.0).max(tl),
        ext(tr).min(w / 2.0).min(h / 2.0).max(tr),
        ext(br).min(w / 2.0).min(h / 2.0).max(br),
        ext(bl).min(w / 2.0).min(h / 2.0).max(bl),
    );
    pb.move_to(etl, 0.0);
    pb.line_to(w - etr, 0.0);
    if tr > 0.0 {
        pb.cubic_to(w - etr + etr * k, 0.0, w, etr - etr * k, w, etr);
    }
    pb.line_to(w, h - ebr);
    if br > 0.0 {
        pb.cubic_to(w, h - ebr + ebr * k, w - ebr + ebr * k, h, w - ebr, h);
    }
    pb.line_to(ebl, h);
    if bl > 0.0 {
        pb.cubic_to(ebl - ebl * k, h, 0.0, h - ebl + ebl * k, 0.0, h - ebl);
    }
    pb.line_to(0.0, etl);
    if tl > 0.0 {
        pb.cubic_to(0.0, etl - etl * k, etl - etl * k, 0.0, etl, 0.0);
    }
    pb.close();
    pb.finish()
}

/// An axis-aligned rectangle path.
pub fn rect_path(x: f32, y: f32, w: f32, h: f32) -> Option<Path> {
    tiny_skia::Rect::from_xywh(x, y, w, h).map(PathBuilder::from_rect)
}

const CURVE_STEPS: usize = 12;

fn flatten(path: &Path, mut edge: impl FnMut(Vec2, Vec2)) {
    let mut start = Vec2::default();
    let mut last = Vec2::default();
    let pt = |p: tiny_skia::Point| Vec2::new(f64::from(p.x), f64::from(p.y));
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(p) => {
                if last != start {
                    edge(last, start);
                }
                start = pt(p);
                last = start;
            }
            PathSegment::LineTo(p) => {
                let p = pt(p);
                edge(last, p);
                last = p;
            }
            PathSegment::QuadTo(c, p) => {
                let (c, p) = (pt(c), pt(p));
                let p0 = last;
                for i in 1..=CURVE_STEPS {
                    let t = i as f64 / CURVE_STEPS as f64;
                    let u = 1.0 - t;
                    let q = Vec2::new(
                        u * u * p0.x + 2.0 * u * t * c.x + t * t * p.x,
                        u * u * p0.y + 2.0 * u * t * c.y + t * t * p.y,
                    );
                    edge(last, q);
                    last = q;
                }
            }
            PathSegment::CubicTo(c1, c2, p) => {
                let (c1, c2, p) = (pt(c1), pt(c2), pt(p));
                let p0 = last;
                for i in 1..=CURVE_STEPS {
                    let t = i as f64 / CURVE_STEPS as f64;
                    let u = 1.0 - t;
                    let a = u * u * u;
                    let b = 3.0 * u * u * t;
                    let c = 3.0 * u * t * t;
                    let d = t * t * t;
                    let q = Vec2::new(
                        a * p0.x + b * c1.x + c * c2.x + d * p.x,
                        a * p0.y + b * c1.y + c * c2.y + d * p.y,
                    );
                    edge(last, q);
                    last = q;
                }
            }
            PathSegment::Close => {
                if last != start {
                    edge(last, start);
                }
                last = start;
            }
        }
    }
    if last != start {
        edge(last, start);
    }
}

fn winding_number(path: &Path, p: Vec2) -> i32 {
    let mut winding = 0;
    flatten(path, |a, b| {
        if a.y <= p.y {
            if b.y > p.y && cross(a, b, p) > 0.0 {
                winding += 1;
            }
        } else if b.y <= p.y && cross(a, b, p) < 0.0 {
            winding -= 1;
        }
    });
    winding
}

fn cross(a: Vec2, b: Vec2, p: Vec2) -> f64 {
    (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
}

/// Distance from `p` to the path's outline (path coordinates).
pub fn distance_to_outline(path: &Path, p: Vec2) -> f64 {
    let mut best = f64::INFINITY;
    flatten(path, |a, b| {
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let len2 = dx * dx + dy * dy;
        let t = if len2 > 0.0 {
            (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let (qx, qy) = (a.x + t * dx - p.x, a.y + t * dy - p.y);
        best = best.min((qx * qx + qy * qy).sqrt());
    });
    best
}

/// SVG path data for `path` after `t`.
pub fn to_svg(path: &Path, t: &Affine, out: &mut String) {
    let p = |q: tiny_skia::Point| t.apply(Vec2::new(f64::from(q.x), f64::from(q.y)));
    for seg in path.segments() {
        let _ = match seg {
            PathSegment::MoveTo(a) => {
                let a = p(a);
                write!(out, "M{:.2} {:.2}", a.x, a.y)
            }
            PathSegment::LineTo(a) => {
                let a = p(a);
                write!(out, "L{:.2} {:.2}", a.x, a.y)
            }
            PathSegment::QuadTo(c, a) => {
                let (c, a) = (p(c), p(a));
                write!(out, "Q{:.2} {:.2} {:.2} {:.2}", c.x, c.y, a.x, a.y)
            }
            PathSegment::CubicTo(c1, c2, a) => {
                let (c1, c2, a) = (p(c1), p(c2), p(a));
                write!(
                    out,
                    "C{:.2} {:.2} {:.2} {:.2} {:.2} {:.2}",
                    c1.x, c1.y, c2.x, c2.y, a.x, a.y
                )
            }
            PathSegment::Close => write!(out, "Z"),
        };
    }
}

#[cfg(test)]
mod test;
