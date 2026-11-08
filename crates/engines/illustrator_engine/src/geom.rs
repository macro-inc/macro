//! Geometry: affine maps, rectangles, and paths of lines and cubic curves.

use serde::{Deserialize, Serialize};

/// A point.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Point {
    /// Horizontal.
    pub x: f64,
    /// Vertical (down on the canvas).
    pub y: f64,
}

impl Point {
    /// A point.
    pub const fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    /// Distance to another point.
    pub fn distance(self, o: Point) -> f64 {
        ((self.x - o.x).powi(2) + (self.y - o.y).powi(2)).sqrt()
    }

    /// Linear interpolation toward `o`.
    pub fn lerp(self, o: Point, t: f64) -> Point {
        Point::new(self.x + (o.x - self.x) * t, self.y + (o.y - self.y) * t)
    }
}

/// An affine map `[a, b, c, d, e, f]`: `(x, y)` to `(a·x + c·y + e,
/// b·x + d·y + f)`, as PDF writes matrices.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Affine(pub [f64; 6]);

impl Default for Affine {
    fn default() -> Self {
        Affine::IDENTITY
    }
}

impl Affine {
    /// The identity.
    pub const IDENTITY: Affine = Affine([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

    /// A translation.
    pub fn translate(x: f64, y: f64) -> Affine {
        Affine([1.0, 0.0, 0.0, 1.0, x, y])
    }

    /// A scale.
    pub fn scale(sx: f64, sy: f64) -> Affine {
        Affine([sx, 0.0, 0.0, sy, 0.0, 0.0])
    }

    /// A rotation by `radians` (clockwise on a y-down canvas).
    pub fn rotate(radians: f64) -> Affine {
        let (s, c) = radians.sin_cos();
        Affine([c, s, -s, c, 0.0, 0.0])
    }

    /// From a matrix's numbers (`None` unless six finite numbers).
    pub fn from_slice(v: &[f64]) -> Option<Affine> {
        let m: [f64; 6] = v.try_into().ok()?;
        m.iter().all(|x| x.is_finite()).then_some(Affine(m))
    }

    /// This map, then `other`. PDF's `cm` sets the current matrix to
    /// `m.followed_by(&ctm)`.
    pub fn followed_by(&self, other: &Affine) -> Affine {
        let a = &self.0;
        let b = &other.0;
        Affine([
            a[0] * b[0] + a[1] * b[2],
            a[0] * b[1] + a[1] * b[3],
            a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4],
            a[4] * b[1] + a[5] * b[3] + b[5],
        ])
    }

    /// Maps a point.
    pub fn apply(&self, p: Point) -> Point {
        let m = &self.0;
        Point::new(
            m[0] * p.x + m[2] * p.y + m[4],
            m[1] * p.x + m[3] * p.y + m[5],
        )
    }

    /// Maps a vector (no translation).
    pub fn apply_vector(&self, p: Point) -> Point {
        let m = &self.0;
        Point::new(m[0] * p.x + m[2] * p.y, m[1] * p.x + m[3] * p.y)
    }

    /// The determinant.
    pub fn det(&self) -> f64 {
        self.0[0] * self.0[3] - self.0[1] * self.0[2]
    }

    /// The inverse, when it exists.
    pub fn invert(&self) -> Option<Affine> {
        let det = self.det();
        if det.abs() < 1e-12 || !det.is_finite() {
            return None;
        }
        let m = &self.0;
        let a = m[3] / det;
        let b = -m[1] / det;
        let c = -m[2] / det;
        let d = m[0] / det;
        Some(Affine([
            a,
            b,
            c,
            d,
            -(m[4] * a + m[5] * c),
            -(m[4] * b + m[5] * d),
        ]))
    }

    /// How much the map scales lengths on average (for stroke widths).
    pub fn scale_factor(&self) -> f64 {
        self.det().abs().sqrt()
    }

    /// As a tiny-skia transform.
    pub fn to_skia(&self) -> tiny_skia::Transform {
        let m = self.0.map(|v| v as f32);
        tiny_skia::Transform::from_row(m[0], m[1], m[2], m[3], m[4], m[5])
    }

    /// Whether every number is finite.
    pub fn is_finite(&self) -> bool {
        self.0.iter().all(|v| v.is_finite())
    }
}

/// A rectangle by its edges.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    /// Left.
    pub x0: f64,
    /// Top.
    pub y0: f64,
    /// Right.
    pub x1: f64,
    /// Bottom.
    pub y1: f64,
}

impl Rect {
    /// A rectangle from any two corners.
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Rect {
        Rect {
            x0: x0.min(x1),
            y0: y0.min(y1),
            x1: x0.max(x1),
            y1: y0.max(y1),
        }
    }

    /// A rectangle from its origin and size.
    pub fn from_xywh(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect::new(x, y, x + w, y + h)
    }

    /// Width.
    pub fn width(&self) -> f64 {
        self.x1 - self.x0
    }

    /// Height.
    pub fn height(&self) -> f64 {
        self.y1 - self.y0
    }

    /// Whether it has no area.
    pub fn is_empty(&self) -> bool {
        !(self.width() > 0.0 && self.height() > 0.0)
    }

    /// The smallest rectangle holding both.
    pub fn union(&self, o: &Rect) -> Rect {
        Rect {
            x0: self.x0.min(o.x0),
            y0: self.y0.min(o.y0),
            x1: self.x1.max(o.x1),
            y1: self.y1.max(o.y1),
        }
    }

    /// The overlap (possibly empty).
    pub fn intersect(&self, o: &Rect) -> Rect {
        Rect {
            x0: self.x0.max(o.x0),
            y0: self.y0.max(o.y0),
            x1: self.x1.min(o.x1),
            y1: self.y1.min(o.y1),
        }
    }

    /// Whether they overlap.
    pub fn intersects(&self, o: &Rect) -> bool {
        !self.intersect(o).is_empty()
    }

    /// Whether a point is inside.
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x0 && p.x <= self.x1 && p.y >= self.y0 && p.y <= self.y1
    }

    /// Whether `o` is inside.
    pub fn contains_rect(&self, o: &Rect) -> bool {
        o.x0 >= self.x0 && o.y0 >= self.y0 && o.x1 <= self.x1 && o.y1 <= self.y1
    }

    /// Grown by `d` on every side.
    pub fn outset(&self, d: f64) -> Rect {
        Rect {
            x0: self.x0 - d,
            y0: self.y0 - d,
            x1: self.x1 + d,
            y1: self.y1 + d,
        }
    }

    /// The bounds of its corners mapped.
    pub fn transform(&self, m: &Affine) -> Rect {
        let pts = [
            m.apply(Point::new(self.x0, self.y0)),
            m.apply(Point::new(self.x1, self.y0)),
            m.apply(Point::new(self.x0, self.y1)),
            m.apply(Point::new(self.x1, self.y1)),
        ];
        bounds_of(&pts).unwrap_or_default()
    }

    /// As a tiny-skia rectangle (`None` when empty or not finite).
    pub fn to_skia(&self) -> Option<tiny_skia::Rect> {
        tiny_skia::Rect::from_ltrb(
            self.x0 as f32,
            self.y0 as f32,
            self.x1 as f32,
            self.y1 as f32,
        )
    }

    /// The center.
    pub fn center(&self) -> Point {
        Point::new((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)
    }
}

/// The bounds of points.
pub fn bounds_of(points: &[Point]) -> Option<Rect> {
    let first = points.first()?;
    let mut r = Rect {
        x0: first.x,
        y0: first.y,
        x1: first.x,
        y1: first.y,
    };
    for p in &points[1..] {
        r.x0 = r.x0.min(p.x);
        r.y0 = r.y0.min(p.y);
        r.x1 = r.x1.max(p.x);
        r.y1 = r.y1.max(p.y);
    }
    Some(r)
}

/// A path segment.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Seg {
    /// Starts a subpath.
    Move {
        /// Where.
        p: Point,
    },
    /// A straight line.
    Line {
        /// To.
        p: Point,
    },
    /// A cubic curve.
    Cubic {
        /// First control point.
        c1: Point,
        /// Second control point.
        c2: Point,
        /// End.
        p: Point,
    },
    /// Closes the subpath.
    Close,
}

/// A path: subpaths of lines and cubic curves.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PathData {
    /// Segments, in order.
    pub segs: Vec<Seg>,
}

impl PathData {
    /// Whether the path draws nothing.
    pub fn is_empty(&self) -> bool {
        !self
            .segs
            .iter()
            .any(|s| matches!(s, Seg::Line { .. } | Seg::Cubic { .. } | Seg::Close))
    }

    /// The path mapped.
    pub fn transform(&self, m: &Affine) -> PathData {
        PathData {
            segs: self
                .segs
                .iter()
                .map(|s| match *s {
                    Seg::Move { p } => Seg::Move { p: m.apply(p) },
                    Seg::Line { p } => Seg::Line { p: m.apply(p) },
                    Seg::Cubic { c1, c2, p } => Seg::Cubic {
                        c1: m.apply(c1),
                        c2: m.apply(c2),
                        p: m.apply(p),
                    },
                    Seg::Close => Seg::Close,
                })
                .collect(),
        }
    }

    /// A rectangle as a closed path.
    pub fn rect(r: Rect) -> PathData {
        PathData {
            segs: vec![
                Seg::Move {
                    p: Point::new(r.x0, r.y0),
                },
                Seg::Line {
                    p: Point::new(r.x1, r.y0),
                },
                Seg::Line {
                    p: Point::new(r.x1, r.y1),
                },
                Seg::Line {
                    p: Point::new(r.x0, r.y1),
                },
                Seg::Close,
            ],
        }
    }

    /// The bounds of the control polygon (a little larger than the curve's).
    pub fn control_bounds(&self) -> Option<Rect> {
        let pts: Vec<Point> = self
            .segs
            .iter()
            .flat_map(|s| match *s {
                Seg::Move { p } | Seg::Line { p } => vec![p],
                Seg::Cubic { c1, c2, p } => vec![c1, c2, p],
                Seg::Close => vec![],
            })
            .collect();
        bounds_of(&pts)
    }

    /// The exact bounds of the curve.
    pub fn bounds(&self) -> Option<Rect> {
        let mut pts = Vec::new();
        let mut current = Point::default();
        for s in &self.segs {
            match *s {
                Seg::Move { p } | Seg::Line { p } => {
                    pts.push(p);
                    current = p;
                }
                Seg::Cubic { c1, c2, p } => {
                    pts.push(current);
                    pts.push(p);
                    for t in cubic_extrema(current, c1, c2, p) {
                        pts.push(cubic_at(current, c1, c2, p, t));
                    }
                    current = p;
                }
                Seg::Close => {}
            }
        }
        bounds_of(&pts)
    }

    /// The path as polylines (curves flattened to within `tolerance`),
    /// one per subpath, with whether each is closed.
    pub fn flatten(&self, tolerance: f64) -> Vec<(Vec<Point>, bool)> {
        let mut out: Vec<(Vec<Point>, bool)> = Vec::new();
        let mut current = Point::default();
        let mut start = Point::default();
        for s in &self.segs {
            match *s {
                Seg::Move { p } => {
                    out.push((vec![p], false));
                    current = p;
                    start = p;
                }
                Seg::Line { p } => {
                    if out.is_empty() {
                        out.push((vec![current], false));
                    }
                    out.last_mut().expect("pushed").0.push(p);
                    current = p;
                }
                Seg::Cubic { c1, c2, p } => {
                    if out.is_empty() {
                        out.push((vec![current], false));
                    }
                    let poly = &mut out.last_mut().expect("pushed").0;
                    let len = current.distance(c1) + c1.distance(c2) + c2.distance(p);
                    let n = ((len / tolerance.max(1e-3)).sqrt().ceil() as usize).clamp(1, 256);
                    for k in 1..=n {
                        poly.push(cubic_at(current, c1, c2, p, k as f64 / n as f64));
                    }
                    current = p;
                }
                Seg::Close => {
                    if let Some(last) = out.last_mut() {
                        last.1 = true;
                    }
                    current = start;
                }
            }
        }
        out
    }

    /// As a tiny-skia path (`None` when it draws nothing).
    pub fn to_skia(&self) -> Option<tiny_skia::Path> {
        let mut pb = tiny_skia::PathBuilder::new();
        for s in &self.segs {
            match *s {
                Seg::Move { p } => pb.move_to(p.x as f32, p.y as f32),
                Seg::Line { p } => pb.line_to(p.x as f32, p.y as f32),
                Seg::Cubic { c1, c2, p } => pb.cubic_to(
                    c1.x as f32,
                    c1.y as f32,
                    c2.x as f32,
                    c2.y as f32,
                    p.x as f32,
                    p.y as f32,
                ),
                Seg::Close => pb.close(),
            }
        }
        pb.finish()
    }

    /// From a tiny-skia path (quadratics raised to cubics).
    pub fn from_skia(path: &tiny_skia::Path) -> PathData {
        use tiny_skia::PathSegment;
        let mut segs = Vec::new();
        let mut current = Point::default();
        let pt = |p: tiny_skia::Point| Point::new(f64::from(p.x), f64::from(p.y));
        for s in path.segments() {
            match s {
                PathSegment::MoveTo(p) => {
                    current = pt(p);
                    segs.push(Seg::Move { p: current });
                }
                PathSegment::LineTo(p) => {
                    current = pt(p);
                    segs.push(Seg::Line { p: current });
                }
                PathSegment::QuadTo(q, p) => {
                    let (q, p) = (pt(q), pt(p));
                    segs.push(Seg::Cubic {
                        c1: current.lerp(q, 2.0 / 3.0),
                        c2: p.lerp(q, 2.0 / 3.0),
                        p,
                    });
                    current = p;
                }
                PathSegment::CubicTo(c1, c2, p) => {
                    current = pt(p);
                    segs.push(Seg::Cubic {
                        c1: pt(c1),
                        c2: pt(c2),
                        p: current,
                    });
                }
                PathSegment::Close => segs.push(Seg::Close),
            }
        }
        PathData { segs }
    }

    /// SVG path data.
    pub fn to_svg(&self) -> String {
        use std::fmt::Write;
        let mut out = String::new();
        let n = |v: f64| {
            let s = format!("{:.3}", v);
            let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
            if s == "-0" { "0".to_string() } else { s }
        };
        for s in &self.segs {
            let _ = match *s {
                Seg::Move { p } => write!(out, "M{} {}", n(p.x), n(p.y)),
                Seg::Line { p } => write!(out, "L{} {}", n(p.x), n(p.y)),
                Seg::Cubic { c1, c2, p } => write!(
                    out,
                    "C{} {} {} {} {} {}",
                    n(c1.x),
                    n(c1.y),
                    n(c2.x),
                    n(c2.y),
                    n(p.x),
                    n(p.y)
                ),
                Seg::Close => write!(out, "Z"),
            };
        }
        out
    }
}

/// The point at `t` on a cubic curve.
pub fn cubic_at(p0: Point, p1: Point, p2: Point, p3: Point, t: f64) -> Point {
    let u = 1.0 - t;
    let a = u * u * u;
    let b = 3.0 * u * u * t;
    let c = 3.0 * u * t * t;
    let d = t * t * t;
    Point::new(
        a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    )
}

/// Parameters in `(0, 1)` where a cubic's x or y turns.
fn cubic_extrema(p0: Point, p1: Point, p2: Point, p3: Point) -> Vec<f64> {
    let mut out = Vec::new();
    for (a0, a1, a2, a3) in [(p0.x, p1.x, p2.x, p3.x), (p0.y, p1.y, p2.y, p3.y)] {
        // Derivative coefficients: a t² + b t + c.
        let a = -a0 + 3.0 * a1 - 3.0 * a2 + a3;
        let b = 2.0 * (a0 - 2.0 * a1 + a2);
        let c = a1 - a0;
        if a.abs() < 1e-12 {
            if b.abs() > 1e-12 {
                out.push(-c / b);
            }
        } else {
            let disc = b * b - 4.0 * a * c;
            if disc >= 0.0 {
                let s = disc.sqrt();
                out.push((-b + s) / (2.0 * a));
                out.push((-b - s) / (2.0 * a));
            }
        }
    }
    out.retain(|t| *t > 0.0 && *t < 1.0);
    out
}

/// Whether a point is inside polygons (winding or even-odd).
pub fn polygons_contain(polys: &[(Vec<Point>, bool)], p: Point, even_odd: bool) -> bool {
    let mut winding = 0i32;
    for (poly, _) in polys {
        let n = poly.len();
        if n < 2 {
            continue;
        }
        for k in 0..n {
            let a = poly[k];
            let b = poly[(k + 1) % n];
            if a.y <= p.y {
                if b.y > p.y && cross(a, b, p) > 0.0 {
                    winding += 1;
                }
            } else if b.y <= p.y && cross(a, b, p) < 0.0 {
                winding -= 1;
            }
        }
    }
    if even_odd {
        winding % 2 != 0
    } else {
        winding != 0
    }
}

fn cross(a: Point, b: Point, p: Point) -> f64 {
    (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
}

/// The distance from a point to polylines' edges.
pub fn distance_to_polylines(polys: &[(Vec<Point>, bool)], p: Point) -> f64 {
    let mut best = f64::INFINITY;
    for (poly, closed) in polys {
        let n = poly.len();
        let edges = if *closed { n } else { n.saturating_sub(1) };
        for k in 0..edges {
            let a = poly[k];
            let b = poly[(k + 1) % n];
            best = best.min(segment_distance(a, b, p));
        }
        if n == 1 {
            best = best.min(poly[0].distance(p));
        }
    }
    best
}

fn segment_distance(a: Point, b: Point, p: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-18 {
        return a.distance(p);
    }
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).clamp(0.0, 1.0);
    Point::new(a.x + t * dx, a.y + t * dy).distance(p)
}

#[cfg(test)]
mod test;
