//! Exact transforms: maps that carry whole pixels onto whole pixels (flips,
//! quarter turns, whole-pixel moves), done by moving samples.

use crate::raster::{IRect, Raster, TILE};

/// Largest translation an exact map takes.
const MAX_SHIFT: f64 = (1 << 24) as f64;

/// A map of whole pixels: the axes permuted and negated, then a whole-pixel
/// translation (as a matrix `[a, b, c, d, e, f]`, `(x, y)` to
/// `(a·x + c·y + e, b·x + d·y + f)`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Exact {
    a: i32,
    b: i32,
    c: i32,
    d: i32,
    e: i32,
    f: i32,
}

impl Exact {
    /// The map from its matrix entries (no check).
    pub const fn new(a: i32, b: i32, c: i32, d: i32, e: i32, f: i32) -> Exact {
        Exact { a, b, c, d, e, f }
    }

    /// `m` as an exact map, when it carries pixels onto pixels (within
    /// rounding error).
    pub fn from_matrix(m: [f64; 6]) -> Option<Exact> {
        let near = |v: f64, tolerance: f64| {
            let r = v.round();
            ((v - r).abs() <= tolerance && r.abs() <= MAX_SHIFT).then_some(r as i32)
        };
        let [a, b, c, d] = [m[0], m[1], m[2], m[3]].map(|v| near(v, 1e-9));
        let (a, b, c, d) = (a?, b?, c?, d?);
        let unit = |v: i32| v == 1 || v == -1;
        let permutes =
            (unit(a) && unit(d) && b == 0 && c == 0) || (unit(b) && unit(c) && a == 0 && d == 0);
        if !permutes {
            return None;
        }
        Some(Exact::new(a, b, c, d, near(m[4], 1e-6)?, near(m[5], 1e-6)?))
    }

    /// Where pixel `(i, j)` lands: its center's image, less half a pixel.
    fn map(&self, i: i32, j: i32) -> (i32, i32) {
        (
            self.a * i + self.c * j + self.e + (self.a + self.c - 1) / 2,
            self.b * i + self.d * j + self.f + (self.b + self.d - 1) / 2,
        )
    }

    /// Where a rectangle of pixels lands.
    fn map_rect(&self, r: IRect) -> IRect {
        let (x0, y0) = self.map(r.x, r.y);
        let (x1, y1) = self.map(r.right() - 1, r.bottom() - 1);
        IRect::from_ltrb(x0.min(x1), y0.min(y1), x0.max(x1) + 1, y0.max(y1) + 1)
    }

    /// The raster's pixels moved by the map, its grid starting at the
    /// moved content's top left (a translation just moves the grid).
    pub fn apply(&self, src: &Raster) -> Raster {
        if self.a == 1 && self.d == 1 {
            let mut out = src.clone();
            out.translate(self.e, self.f);
            return out;
        }
        let c = src.channels() as usize;
        let mut out = Raster::new(src.channels());
        let Some(content) = src.content_bounds() else {
            return out;
        };
        let dest = self.map_rect(content);
        out.set_origin((dest.x, dest.y));
        let mut buf = Vec::new();
        for (tx, ty) in src.tile_keys() {
            let Some(tile) = src.tile(tx, ty) else {
                continue;
            };
            let tr = src.tile_rect(tx, ty);
            let part = tr.intersect(&content);
            if part.is_empty() {
                continue;
            }
            let dr = self.map_rect(part);
            buf.clear();
            buf.resize(dr.area() as usize * c, 0);
            for j in part.y..part.bottom() {
                for i in part.x..part.right() {
                    let s = ((j - tr.y) * TILE + (i - tr.x)) as usize * c;
                    let (x, y) = self.map(i, j);
                    let d = ((y - dr.y) * dr.w + (x - dr.x)) as usize * c;
                    buf[d..d + c].copy_from_slice(&tile[s..s + c]);
                }
            }
            out.write(dr, &buf);
        }
        out
    }
}
