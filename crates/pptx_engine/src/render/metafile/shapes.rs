//! GDI figure geometry in logical units: rectangles, ellipses, arcs, rounded
//! rectangles, Béziers, and `PolyDraw` point lists.

use crate::path::{Path, Point, Rect};
use std::f64::consts::{FRAC_PI_2, PI, TAU};

/// A point from logical coordinates.
pub(super) fn pt(x: f64, y: f64) -> Point {
    Point::new(x as f32, y as f32)
}

fn norm(l: f64, t: f64, r: f64, b: f64) -> (f64, f64, f64, f64) {
    (l.min(r), t.min(b), l.max(r), t.max(b))
}

/// `Rectangle`.
pub(super) fn rect(l: f64, t: f64, r: f64, b: f64) -> Path {
    let (l, t, r, b) = norm(l, t, r, b);
    Path::rect(Rect::from_ltrb(l as f32, t as f32, r as f32, b as f32))
}

/// `Ellipse`.
pub(super) fn ellipse(l: f64, t: f64, r: f64, b: f64) -> Path {
    let (l, t, r, b) = norm(l, t, r, b);
    Path::ellipse(Rect::from_ltrb(l as f32, t as f32, r as f32, b as f32))
}

/// `RoundRect` with corner ellipses `w` × `h`.
pub(super) fn round_rect(l: f64, t: f64, r: f64, b: f64, w: f64, h: f64) -> Path {
    let (l, t, r, b) = norm(l, t, r, b);
    let rw = (w.abs().min(r - l) / 2.0) as f32;
    let rh = (h.abs().min(b - t) / 2.0) as f32;
    if rw <= 0.0 || rh <= 0.0 {
        return rect(l, t, r, b);
    }
    let (l, t, r, b) = (l as f32, t as f32, r as f32, b as f32);
    let mut p = Path::new();
    p.move_to(Point::new(l + rw, t));
    p.line_to(Point::new(r - rw, t));
    p.arc(r - rw, t + rh, rw, rh, -FRAC_PI_2, FRAC_PI_2);
    p.line_to(Point::new(r, b - rh));
    p.arc(r - rw, b - rh, rw, rh, 0.0, FRAC_PI_2);
    p.line_to(Point::new(l + rw, b));
    p.arc(l + rw, b - rh, rw, rh, FRAC_PI_2, FRAC_PI_2);
    p.line_to(Point::new(l, t + rh));
    p.arc(l + rw, t + rh, rw, rh, PI, FRAC_PI_2);
    p.close();
    p
}

/// An elliptical arc in parametric form.
#[derive(Clone, Copy, Debug)]
pub(super) struct ArcGeom {
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    t0: f64,
    dt: f64,
}

impl ArcGeom {
    /// The GDI arc of the ellipse inscribed in a bounding box, from the radial
    /// through `start` to the radial through `end`. `increasing` gives the
    /// sweep direction in logical space; equal radials draw the full ellipse.
    pub(super) fn new(
        l: f64,
        t: f64,
        r: f64,
        b: f64,
        start: (f64, f64),
        end: (f64, f64),
        increasing: bool,
    ) -> Option<Self> {
        let (l, t, r, b) = norm(l, t, r, b);
        let (rx, ry) = ((r - l) / 2.0, (b - t) / 2.0);
        if !(rx > 0.0 && ry > 0.0 && rx.is_finite() && ry.is_finite()) {
            return None;
        }
        let (cx, cy) = (l + rx, t + ry);
        let angle = |p: (f64, f64)| ((p.1 - cy) / ry).atan2((p.0 - cx) / rx);
        let t0 = angle(start);
        let mut dt = angle(end) - t0;
        if increasing {
            if dt <= 1e-12 {
                dt += TAU;
            }
        } else if dt >= -1e-12 {
            dt -= TAU;
        }
        Some(Self {
            cx,
            cy,
            rx,
            ry,
            t0,
            dt,
        })
    }

    /// The point at parametric angle `t`.
    fn at(&self, t: f64) -> (f64, f64) {
        (self.cx + self.rx * t.cos(), self.cy + self.ry * t.sin())
    }

    /// First point of the arc.
    pub(super) fn start(&self) -> (f64, f64) {
        self.at(self.t0)
    }

    /// Last point of the arc.
    pub(super) fn end(&self) -> (f64, f64) {
        self.at(self.t0 + self.dt)
    }

    /// Appends the arc to `p` (whose current point is the arc's start).
    fn append(&self, p: &mut Path) {
        p.arc(
            self.cx as f32,
            self.cy as f32,
            self.rx as f32,
            self.ry as f32,
            self.t0,
            self.dt,
        );
    }

    /// `Arc`: the open arc.
    pub(super) fn arc_path(&self) -> Path {
        let mut p = Path::new();
        let (x, y) = self.start();
        p.move_to(pt(x, y));
        self.append(&mut p);
        p
    }

    /// `Chord`: the arc closed by a straight line.
    pub(super) fn chord_path(&self) -> Path {
        let mut p = self.arc_path();
        p.close();
        p
    }

    /// `Pie`: the arc closed through the center.
    pub(super) fn pie_path(&self) -> Path {
        let mut p = Path::new();
        p.move_to(pt(self.cx, self.cy));
        let (x, y) = self.start();
        p.line_to(pt(x, y));
        self.append(&mut p);
        p.close();
        p
    }

    /// `ArcTo`: a line from `from` to the arc's start, then the arc.
    pub(super) fn arc_to_path(&self, from: (f64, f64)) -> Path {
        let mut p = Path::new();
        p.move_to(pt(from.0, from.1));
        let (x, y) = self.start();
        p.line_to(pt(x, y));
        self.append(&mut p);
        p
    }
}

/// A polyline (closed = polygon).
pub(super) fn poly(points: &[(f64, f64)], closed: bool) -> Path {
    let mut p = Path::new();
    for (i, &(x, y)) in points.iter().enumerate() {
        if i == 0 {
            p.move_to(pt(x, y));
        } else {
            p.line_to(pt(x, y));
        }
    }
    if closed && points.len() > 1 {
        p.close();
    }
    p
}

/// A polyline continuing from `from` (`PolylineTo`).
pub(super) fn poly_to(from: (f64, f64), points: &[(f64, f64)]) -> Path {
    let mut p = Path::new();
    p.move_to(pt(from.0, from.1));
    for &(x, y) in points {
        p.line_to(pt(x, y));
    }
    p
}

/// Cubic Béziers: with `from`, every point triple continues from it
/// (`PolyBezierTo`); without, the first point starts the curve (`PolyBezier`).
pub(super) fn bezier(points: &[(f64, f64)], from: Option<(f64, f64)>) -> Path {
    let mut p = Path::new();
    let rest = match from {
        Some(f) => {
            p.move_to(pt(f.0, f.1));
            points
        }
        None => {
            let Some((&first, rest)) = points.split_first() else {
                return p;
            };
            p.move_to(pt(first.0, first.1));
            rest
        }
    };
    for c in rest.chunks_exact(3) {
        p.cubic_to(pt(c[0].0, c[0].1), pt(c[1].0, c[1].1), pt(c[2].0, c[2].1));
    }
    p
}

/// `PolyDraw`: points tagged `PT_MOVETO`/`PT_LINETO`/`PT_BEZIERTO` (| `PT_CLOSEFIGURE`).
/// Returns the path (starting at `from`) and the last point.
pub(super) fn poly_draw(
    points: &[(f64, f64)],
    types: &[u8],
    from: (f64, f64),
) -> (Path, (f64, f64)) {
    let mut p = Path::new();
    p.move_to(pt(from.0, from.1));
    let mut last = from;
    let n = points.len().min(types.len());
    let mut i = 0;
    while i < n {
        let close = types[i] & 1 != 0;
        match types[i] & !1 {
            6 => {
                p.move_to(pt(points[i].0, points[i].1));
                last = points[i];
                i += 1;
            }
            2 => {
                p.line_to(pt(points[i].0, points[i].1));
                last = points[i];
                if close {
                    p.close();
                }
                i += 1;
            }
            4 if i + 2 < n => {
                let (a, b, c) = (points[i], points[i + 1], points[i + 2]);
                p.cubic_to(pt(a.0, a.1), pt(b.0, b.1), pt(c.0, c.1));
                last = c;
                if types[i + 2] & 1 != 0 {
                    p.close();
                }
                i += 3;
            }
            _ => i += 1,
        }
    }
    (p, last)
}
