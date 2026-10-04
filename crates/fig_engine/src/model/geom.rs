//! Points, rectangles, and affine transforms. Document coordinates are
//! `f64` so pages far from the origin keep sub-pixel precision at high zoom.

use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// A 2×3 affine transform mapping `(x, y)` to
/// `(m00·x + m01·y + m02, m10·x + m11·y + m12)` (Figma's layout).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    pub m00: f64,
    pub m01: f64,
    pub m02: f64,
    pub m10: f64,
    pub m11: f64,
    pub m12: f64,
}

impl Default for Affine {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Affine {
    pub const IDENTITY: Affine = Affine {
        m00: 1.0,
        m01: 0.0,
        m02: 0.0,
        m10: 0.0,
        m11: 1.0,
        m12: 0.0,
    };

    pub fn translate(x: f64, y: f64) -> Self {
        Affine {
            m02: x,
            m12: y,
            ..Self::IDENTITY
        }
    }

    pub fn scale(sx: f64, sy: f64) -> Self {
        Affine {
            m00: sx,
            m11: sy,
            ..Self::IDENTITY
        }
    }

    pub fn rotate(radians: f64) -> Self {
        let (s, c) = radians.sin_cos();
        Affine {
            m00: c,
            m01: -s,
            m02: 0.0,
            m10: s,
            m11: c,
            m12: 0.0,
        }
    }

    /// Matrix product `self × other` (apply `other`, then `self`).
    pub fn mul(&self, o: &Affine) -> Affine {
        Affine {
            m00: self.m00 * o.m00 + self.m01 * o.m10,
            m01: self.m00 * o.m01 + self.m01 * o.m11,
            m02: self.m00 * o.m02 + self.m01 * o.m12 + self.m02,
            m10: self.m10 * o.m00 + self.m11 * o.m10,
            m11: self.m10 * o.m01 + self.m11 * o.m11,
            m12: self.m10 * o.m02 + self.m11 * o.m12 + self.m12,
        }
    }

    pub fn apply(&self, p: Vec2) -> Vec2 {
        Vec2 {
            x: self.m00 * p.x + self.m01 * p.y + self.m02,
            y: self.m10 * p.x + self.m11 * p.y + self.m12,
        }
    }

    pub fn determinant(&self) -> f64 {
        self.m00 * self.m11 - self.m01 * self.m10
    }

    pub fn invert(&self) -> Option<Affine> {
        let det = self.determinant();
        if !det.is_finite() || det.abs() < 1e-12 {
            return None;
        }
        let inv = 1.0 / det;
        Some(Affine {
            m00: self.m11 * inv,
            m01: -self.m01 * inv,
            m02: (self.m01 * self.m12 - self.m11 * self.m02) * inv,
            m10: -self.m10 * inv,
            m11: self.m00 * inv,
            m12: (self.m10 * self.m02 - self.m00 * self.m12) * inv,
        })
    }

    pub fn is_finite(&self) -> bool {
        [self.m00, self.m01, self.m02, self.m10, self.m11, self.m12]
            .iter()
            .all(|v| v.is_finite())
    }

    /// The bounding box of `rect` after this transform.
    pub fn map_rect(&self, rect: &Rect) -> Rect {
        let pts = [
            self.apply(Vec2::new(rect.x, rect.y)),
            self.apply(Vec2::new(rect.x + rect.w, rect.y)),
            self.apply(Vec2::new(rect.x, rect.y + rect.h)),
            self.apply(Vec2::new(rect.x + rect.w, rect.y + rect.h)),
        ];
        Rect::bounding(pts.iter().copied())
    }

    /// How much the transform scales lengths (geometric mean of the axes).
    pub fn scale_factor(&self) -> f64 {
        self.determinant().abs().sqrt()
    }

    /// Rotation in degrees, clockwise as Figma's inspector shows it.
    pub fn rotation_degrees(&self) -> f64 {
        -self.m10.atan2(self.m00).to_degrees()
    }

    pub fn to_skia(&self) -> tiny_skia::Transform {
        tiny_skia::Transform::from_row(
            self.m00 as f32,
            self.m10 as f32,
            self.m01 as f32,
            self.m11 as f32,
            self.m02 as f32,
            self.m12 as f32,
        )
    }
}

/// An axis-aligned rectangle.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }

    /// The empty rectangle that any union replaces.
    pub const EMPTY: Rect = Rect {
        x: f64::INFINITY,
        y: f64::INFINITY,
        w: f64::NEG_INFINITY,
        h: f64::NEG_INFINITY,
    };

    pub fn is_empty(&self) -> bool {
        !(self.w >= 0.0 && self.h >= 0.0 && self.x.is_finite() && self.y.is_finite())
    }

    pub fn right(&self) -> f64 {
        self.x + self.w
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }

    pub fn bounding(points: impl IntoIterator<Item = Vec2>) -> Rect {
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in points {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        }
        if x0 > x1 {
            return Rect::EMPTY;
        }
        Rect::new(x0, y0, x1 - x0, y1 - y0)
    }

    pub fn union(&self, o: &Rect) -> Rect {
        if self.is_empty() {
            return *o;
        }
        if o.is_empty() {
            return *self;
        }
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        Rect::new(
            x,
            y,
            self.right().max(o.right()) - x,
            self.bottom().max(o.bottom()) - y,
        )
    }

    pub fn intersect(&self, o: &Rect) -> Rect {
        if self.is_empty() || o.is_empty() {
            return Rect::EMPTY;
        }
        let x = self.x.max(o.x);
        let y = self.y.max(o.y);
        let r = self.right().min(o.right());
        let b = self.bottom().min(o.bottom());
        if r < x || b < y {
            return Rect::EMPTY;
        }
        Rect::new(x, y, r - x, b - y)
    }

    pub fn intersects(&self, o: &Rect) -> bool {
        !self.is_empty()
            && !o.is_empty()
            && self.x <= o.right()
            && o.x <= self.right()
            && self.y <= o.bottom()
            && o.y <= self.bottom()
    }

    pub fn contains(&self, p: Vec2) -> bool {
        p.x >= self.x && p.x <= self.right() && p.y >= self.y && p.y <= self.bottom()
    }

    pub fn outset(&self, d: f64) -> Rect {
        if self.is_empty() {
            return *self;
        }
        Rect::new(self.x - d, self.y - d, self.w + 2.0 * d, self.h + 2.0 * d)
    }

    pub fn translate(&self, dx: f64, dy: f64) -> Rect {
        Rect::new(self.x + dx, self.y + dy, self.w, self.h)
    }
}
