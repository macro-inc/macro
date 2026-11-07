//! Backend-independent 2D geometry: points, rectangles, affine transforms, and paths.

use std::f64::consts::PI;

/// A point (in points unless stated otherwise).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    /// Horizontal coordinate.
    pub x: f32,
    /// Vertical coordinate (down is positive).
    pub y: f32,
}

impl Point {
    /// Creates a point.
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

/// An axis-aligned rectangle.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    /// Left edge.
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width (non-negative).
    pub w: f32,
    /// Height (non-negative).
    pub h: f32,
}

impl Rect {
    /// From origin and size.
    pub const fn from_xywh(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }

    /// From edges.
    pub fn from_ltrb(l: f32, t: f32, r: f32, b: f32) -> Self {
        Self {
            x: l,
            y: t,
            w: (r - l).max(0.0),
            h: (b - t).max(0.0),
        }
    }

    /// Right edge.
    pub fn right(&self) -> f32 {
        self.x + self.w
    }

    /// Bottom edge.
    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }

    /// Center point.
    pub fn center(&self) -> Point {
        Point::new(self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Smallest rectangle containing both.
    pub fn union(&self, o: &Rect) -> Rect {
        Rect::from_ltrb(
            self.x.min(o.x),
            self.y.min(o.y),
            self.right().max(o.right()),
            self.bottom().max(o.bottom()),
        )
    }

    /// Grows (or shrinks, if negative) every edge by `d`.
    pub fn outset(&self, d: f32) -> Rect {
        Rect::from_ltrb(self.x - d, self.y - d, self.right() + d, self.bottom() + d)
    }

    /// Whether the point lies inside.
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x <= self.right() && p.y >= self.y && p.y <= self.bottom()
    }
}

/// A 2D affine transform `[a c e; b d f]` (maps `(x, y)` to `(a x + c y + e, b x + d y + f)`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    /// x scale / rotation component.
    pub a: f64,
    /// y shear / rotation component.
    pub b: f64,
    /// x shear / rotation component.
    pub c: f64,
    /// y scale / rotation component.
    pub d: f64,
    /// x translation.
    pub e: f64,
    /// y translation.
    pub f: f64,
}

impl Default for Affine {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Affine {
    /// The identity transform.
    pub const IDENTITY: Affine = Affine {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    /// Translation.
    pub fn translate(x: f64, y: f64) -> Self {
        Self {
            e: x,
            f: y,
            ..Self::IDENTITY
        }
    }

    /// Scale.
    pub fn scale(sx: f64, sy: f64) -> Self {
        Self {
            a: sx,
            d: sy,
            ..Self::IDENTITY
        }
    }

    /// Rotation by `deg` degrees (clockwise on screen, as y points down).
    pub fn rotate(deg: f64) -> Self {
        let (s, c) = (deg * PI / 180.0).sin_cos();
        Self {
            a: c,
            b: s,
            c: -s,
            d: c,
            e: 0.0,
            f: 0.0,
        }
    }

    /// `self ∘ other`: `other` is applied first, then `self` (Skia's pre-concat).
    pub fn pre_concat(&self, other: &Affine) -> Affine {
        let (s, o) = (self, other);
        Affine {
            a: s.a * o.a + s.c * o.b,
            b: s.b * o.a + s.d * o.b,
            c: s.a * o.c + s.c * o.d,
            d: s.b * o.c + s.d * o.d,
            e: s.a * o.e + s.c * o.f + s.e,
            f: s.b * o.e + s.d * o.f + s.f,
        }
    }

    /// `other ∘ self`: `self` is applied first, then `other` (Skia's post-concat).
    pub fn post_concat(&self, other: &Affine) -> Affine {
        other.pre_concat(self)
    }

    /// Maps a point.
    pub fn apply(&self, p: Point) -> Point {
        let (x, y) = (f64::from(p.x), f64::from(p.y));
        Point::new(
            (self.a * x + self.c * y + self.e) as f32,
            (self.b * x + self.d * y + self.f) as f32,
        )
    }

    /// The inverse transform, if invertible.
    pub fn invert(&self) -> Option<Affine> {
        let det = self.a * self.d - self.b * self.c;
        if det.abs() < 1e-12 {
            return None;
        }
        let inv = 1.0 / det;
        Some(Affine {
            a: self.d * inv,
            b: -self.b * inv,
            c: -self.c * inv,
            d: self.a * inv,
            e: (self.c * self.f - self.d * self.e) * inv,
            f: (self.b * self.e - self.a * self.f) * inv,
        })
    }

    /// Average scale factor (for stroke widths under non-uniform transforms).
    pub fn mean_scale(&self) -> f64 {
        ((self.a * self.d - self.b * self.c).abs()).sqrt()
    }
}

/// One path segment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PathEl {
    /// Start a new sub-path.
    MoveTo(Point),
    /// Straight line.
    LineTo(Point),
    /// Quadratic Bézier (control, end).
    QuadTo(Point, Point),
    /// Cubic Bézier (control 1, control 2, end).
    CubicTo(Point, Point, Point),
    /// Close the current sub-path.
    Close,
}

/// A vector path made of [`PathEl`]s.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Path {
    /// The segments.
    pub els: Vec<PathEl>,
    current: Point,
    start: Point,
}

impl Path {
    /// An empty path.
    pub fn new() -> Self {
        Self::default()
    }

    /// A rectangle path.
    pub fn rect(r: Rect) -> Self {
        let mut p = Self::new();
        p.move_to(Point::new(r.x, r.y));
        p.line_to(Point::new(r.right(), r.y));
        p.line_to(Point::new(r.right(), r.bottom()));
        p.line_to(Point::new(r.x, r.bottom()));
        p.close();
        p
    }

    /// An ellipse inscribed in `r`.
    pub fn ellipse(r: Rect) -> Self {
        let mut p = Self::new();
        let (cx, cy, rx, ry) = (r.x + r.w / 2.0, r.y + r.h / 2.0, r.w / 2.0, r.h / 2.0);
        p.move_to(Point::new(cx + rx, cy));
        p.arc(cx, cy, rx, ry, 0.0, 2.0 * PI);
        p.close();
        p
    }

    /// Whether the path has no segments.
    pub fn is_empty(&self) -> bool {
        self.els.is_empty()
    }

    /// The current point.
    pub fn current(&self) -> Point {
        self.current
    }

    /// Starts a sub-path.
    pub fn move_to(&mut self, p: Point) {
        self.els.push(PathEl::MoveTo(p));
        self.current = p;
        self.start = p;
    }

    fn ensure_started(&mut self) {
        if self.els.is_empty() {
            self.els.push(PathEl::MoveTo(self.current));
            self.start = self.current;
        }
    }

    /// Adds a line.
    pub fn line_to(&mut self, p: Point) {
        self.ensure_started();
        self.els.push(PathEl::LineTo(p));
        self.current = p;
    }

    /// Adds a quadratic Bézier.
    pub fn quad_to(&mut self, c: Point, p: Point) {
        self.ensure_started();
        self.els.push(PathEl::QuadTo(c, p));
        self.current = p;
    }

    /// Adds a cubic Bézier.
    pub fn cubic_to(&mut self, c1: Point, c2: Point, p: Point) {
        self.ensure_started();
        self.els.push(PathEl::CubicTo(c1, c2, p));
        self.current = p;
    }

    /// Closes the current sub-path.
    pub fn close(&mut self) {
        if !self.els.is_empty() && !matches!(self.els.last(), Some(PathEl::Close)) {
            self.els.push(PathEl::Close);
        }
        self.current = self.start;
    }

    /// Appends all segments of `other`.
    pub fn extend(&mut self, other: &Path) {
        self.els.extend_from_slice(&other.els);
        self.current = other.current;
        self.start = other.start;
    }

    /// Adds an elliptical arc around `(cx, cy)` from parametric angle `t0` sweeping `dt` radians.
    pub fn arc(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, t0: f64, dt: f64) {
        if dt == 0.0 {
            return;
        }
        let segments = (dt.abs() / (PI / 2.0)).ceil().max(1.0) as usize;
        let step = dt / segments as f64;
        let k = 4.0 / 3.0 * (step / 4.0).tan();
        let (cx, cy, rx, ry) = (f64::from(cx), f64::from(cy), f64::from(rx), f64::from(ry));
        let mut t = t0;
        for _ in 0..segments {
            let (s0, c0) = t.sin_cos();
            let (s1, c1) = (t + step).sin_cos();
            let p1 = Point::new(
                (cx + rx * (c0 - k * s0)) as f32,
                (cy + ry * (s0 + k * c0)) as f32,
            );
            let p2 = Point::new(
                (cx + rx * (c1 + k * s1)) as f32,
                (cy + ry * (s1 - k * c1)) as f32,
            );
            let p3 = Point::new((cx + rx * c1) as f32, (cy + ry * s1) as f32);
            self.cubic_to(p1, p2, p3);
            t += step;
        }
    }

    /// DrawingML `arcTo`: continue from the current point along an ellipse with
    /// radii `wr`/`hr`, starting at visual angle `st_deg`, sweeping `sw_deg`.
    pub fn arc_to_ooxml(&mut self, wr: f32, hr: f32, st_deg: f64, sw_deg: f64) {
        let (rx, ry) = (f64::from(wr), f64::from(hr));
        if rx <= 0.0 || ry <= 0.0 {
            return;
        }
        // Visual angle θ on the ellipse corresponds to parametric angle t with
        // (rx cos t, ry sin t) ∥ (cos θ, sin θ).
        let param = |deg: f64| {
            let th = deg.to_radians();
            (rx * th.sin()).atan2(ry * th.cos())
        };
        let t0 = param(st_deg);
        let mut t1 = param(st_deg + sw_deg);
        let sweep = sw_deg.to_radians();
        if sweep.abs() >= 2.0 * PI - 1e-9 {
            t1 = t0 + 2.0 * PI * sweep.signum();
        } else {
            // Unwrap t1 so the parametric sweep has the sign of the visual sweep.
            while sweep > 0.0 && t1 < t0 {
                t1 += 2.0 * PI;
            }
            while sweep < 0.0 && t1 > t0 {
                t1 -= 2.0 * PI;
            }
        }
        let cur = self.current;
        let cx = f64::from(cur.x) - rx * t0.cos();
        let cy = f64::from(cur.y) - ry * t0.sin();
        self.arc(cx as f32, cy as f32, rx as f32, ry as f32, t0, t1 - t0);
    }

    /// Maps every point through `t`.
    pub fn transform(&self, t: &Affine) -> Path {
        let els = self
            .els
            .iter()
            .map(|el| match *el {
                PathEl::MoveTo(p) => PathEl::MoveTo(t.apply(p)),
                PathEl::LineTo(p) => PathEl::LineTo(t.apply(p)),
                PathEl::QuadTo(c, p) => PathEl::QuadTo(t.apply(c), t.apply(p)),
                PathEl::CubicTo(a, b, p) => PathEl::CubicTo(t.apply(a), t.apply(b), t.apply(p)),
                PathEl::Close => PathEl::Close,
            })
            .collect();
        Path {
            els,
            current: t.apply(self.current),
            start: t.apply(self.start),
        }
    }

    /// Bounding box of all points (including control points).
    pub fn bounds(&self) -> Option<Rect> {
        let mut it = self.els.iter().flat_map(|el| match *el {
            PathEl::MoveTo(p) | PathEl::LineTo(p) => vec![p],
            PathEl::QuadTo(c, p) => vec![c, p],
            PathEl::CubicTo(a, b, p) => vec![a, b, p],
            PathEl::Close => vec![],
        });
        let first = it.next()?;
        let (mut l, mut t, mut r, mut b) = (first.x, first.y, first.x, first.y);
        for p in it {
            l = l.min(p.x);
            t = t.min(p.y);
            r = r.max(p.x);
            b = b.max(p.y);
        }
        Some(Rect::from_ltrb(l, t, r, b))
    }

    /// Approximates the path by polylines (one per sub-path) with tolerance `tol`.
    pub fn flatten(&self, tol: f32) -> Vec<Vec<Point>> {
        let mut out: Vec<Vec<Point>> = Vec::new();
        let mut cur = Point::default();
        let mut start = Point::default();
        for el in &self.els {
            match *el {
                PathEl::MoveTo(p) => {
                    out.push(vec![p]);
                    cur = p;
                    start = p;
                }
                PathEl::LineTo(p) => {
                    push_pt(&mut out, cur, p);
                    cur = p;
                }
                PathEl::QuadTo(c, p) => {
                    let n = curve_steps(cur, c, c, p, tol);
                    for i in 1..=n {
                        let t = i as f32 / n as f32;
                        let mt = 1.0 - t;
                        let q = Point::new(
                            mt * mt * cur.x + 2.0 * mt * t * c.x + t * t * p.x,
                            mt * mt * cur.y + 2.0 * mt * t * c.y + t * t * p.y,
                        );
                        push_pt(&mut out, cur, q);
                    }
                    cur = p;
                }
                PathEl::CubicTo(a, b, p) => {
                    let n = curve_steps(cur, a, b, p, tol);
                    let p0 = cur;
                    for i in 1..=n {
                        let t = i as f32 / n as f32;
                        let mt = 1.0 - t;
                        let q = Point::new(
                            mt * mt * mt * p0.x
                                + 3.0 * mt * mt * t * a.x
                                + 3.0 * mt * t * t * b.x
                                + t * t * t * p.x,
                            mt * mt * mt * p0.y
                                + 3.0 * mt * mt * t * a.y
                                + 3.0 * mt * t * t * b.y
                                + t * t * t * p.y,
                        );
                        push_pt(&mut out, p0, q);
                    }
                    cur = p;
                }
                PathEl::Close => {
                    push_pt(&mut out, cur, start);
                    cur = start;
                }
            }
        }
        out
    }

    /// Even-odd/non-zero agnostic point containment (non-zero winding rule).
    pub fn contains(&self, p: Point, tol: f32) -> bool {
        let mut winding = 0i32;
        for poly in self.flatten(tol) {
            let n = poly.len();
            if n < 2 {
                continue;
            }
            for i in 0..n {
                let a = poly[i];
                let b = poly[(i + 1) % n];
                if a.y <= p.y {
                    if b.y > p.y && cross(a, b, p) > 0.0 {
                        winding += 1;
                    }
                } else if b.y <= p.y && cross(a, b, p) < 0.0 {
                    winding -= 1;
                }
            }
        }
        winding != 0
    }
}

fn cross(a: Point, b: Point, p: Point) -> f32 {
    (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
}

fn push_pt(out: &mut Vec<Vec<Point>>, from: Point, p: Point) {
    match out.last_mut() {
        Some(poly) => poly.push(p),
        None => out.push(vec![from, p]),
    }
}

fn curve_steps(p0: Point, a: Point, b: Point, p: Point, tol: f32) -> usize {
    let len = dist(p0, a) + dist(a, b) + dist(b, p);
    ((len / tol.max(0.01)).sqrt().ceil() as usize).clamp(1, 256)
}

fn dist(a: Point, b: Point) -> f32 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

#[cfg(test)]
mod test;
