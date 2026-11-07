//! Outlines of the shapes the editor draws: rectangles (rounded),
//! ellipses, polygons, and stars.

use crate::geom::{PathData, Point, Rect, Seg};

/// Bézier handle length for a quarter circle of radius 1.
const KAPPA: f64 = 0.552_284_749_830_793_4;

/// A rectangle, its corners rounded by `radius`.
pub fn rect(r: Rect, radius: f64) -> PathData {
    let radius = radius.max(0.0).min(r.width() / 2.0).min(r.height() / 2.0);
    if radius <= 0.0 {
        return PathData::rect(r);
    }
    let k = radius * (1.0 - KAPPA);
    let Rect { x0, y0, x1, y1 } = r;
    PathData {
        segs: vec![
            Seg::Move {
                p: Point::new(x0 + radius, y0),
            },
            Seg::Line {
                p: Point::new(x1 - radius, y0),
            },
            Seg::Cubic {
                c1: Point::new(x1 - k, y0),
                c2: Point::new(x1, y0 + k),
                p: Point::new(x1, y0 + radius),
            },
            Seg::Line {
                p: Point::new(x1, y1 - radius),
            },
            Seg::Cubic {
                c1: Point::new(x1, y1 - k),
                c2: Point::new(x1 - k, y1),
                p: Point::new(x1 - radius, y1),
            },
            Seg::Line {
                p: Point::new(x0 + radius, y1),
            },
            Seg::Cubic {
                c1: Point::new(x0 + k, y1),
                c2: Point::new(x0, y1 - k),
                p: Point::new(x0, y1 - radius),
            },
            Seg::Line {
                p: Point::new(x0, y0 + radius),
            },
            Seg::Cubic {
                c1: Point::new(x0, y0 + k),
                c2: Point::new(x0 + k, y0),
                p: Point::new(x0 + radius, y0),
            },
            Seg::Close,
        ],
    }
}

/// An ellipse filling a rectangle.
pub fn ellipse(r: Rect) -> PathData {
    let (cx, cy) = (r.center().x, r.center().y);
    let (rx, ry) = (r.width() / 2.0, r.height() / 2.0);
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    PathData {
        segs: vec![
            Seg::Move {
                p: Point::new(cx + rx, cy),
            },
            Seg::Cubic {
                c1: Point::new(cx + rx, cy + ky),
                c2: Point::new(cx + kx, cy + ry),
                p: Point::new(cx, cy + ry),
            },
            Seg::Cubic {
                c1: Point::new(cx - kx, cy + ry),
                c2: Point::new(cx - rx, cy + ky),
                p: Point::new(cx - rx, cy),
            },
            Seg::Cubic {
                c1: Point::new(cx - rx, cy - ky),
                c2: Point::new(cx - kx, cy - ry),
                p: Point::new(cx, cy - ry),
            },
            Seg::Cubic {
                c1: Point::new(cx + kx, cy - ry),
                c2: Point::new(cx + rx, cy - ky),
                p: Point::new(cx + rx, cy),
            },
            Seg::Close,
        ],
    }
}

/// A regular polygon with `sides` corners, or a star with that many
/// points when `inner` (the inner radius as a fraction of the outer) is
/// given, fit to a rectangle with a point at the top.
pub fn polygon(r: Rect, sides: u32, inner: Option<f64>) -> PathData {
    let sides = sides.clamp(3, 100);
    let (cx, cy) = (r.center().x, r.center().y);
    let (rx, ry) = (r.width() / 2.0, r.height() / 2.0);
    let count = if inner.is_some() { sides * 2 } else { sides };
    let mut segs = Vec::with_capacity(count as usize + 1);
    for k in 0..count {
        let angle =
            -std::f64::consts::FRAC_PI_2 + std::f64::consts::TAU * f64::from(k) / f64::from(count);
        let f = match inner {
            Some(f) if k % 2 == 1 => f.clamp(0.01, 1.0),
            _ => 1.0,
        };
        let p = Point::new(cx + rx * f * angle.cos(), cy + ry * f * angle.sin());
        segs.push(if k == 0 {
            Seg::Move { p }
        } else {
            Seg::Line { p }
        });
    }
    segs.push(Seg::Close);
    PathData { segs }
}
