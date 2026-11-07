//! Resampling under any affine map: each output pixel's center is mapped
//! back into the source and sampled there (nearest, bilinear, or bicubic
//! with Keys' `a = -0.5`) from premultiplied values, then unpremultiplied.
//!
//! Where the map shrinks the source by more than half (an output pixel
//! spans over two source pixels along either of its sides), each output
//! pixel instead averages a grid of bilinear samples spread over its
//! footprint, so downscales do not alias. Nearest neighbor never averages:
//! it keeps hard pixels hard.
//!
//! The output is processed a tile at a time, each reading only the source
//! area it maps back to (split smaller while that area is large, and read
//! pixel by pixel when even a small block maps back to too much).

use super::Interpolation;
use crate::edit::filters::premul::{add_scaled, load, store};
use crate::raster::{IRect, Raster};

/// Farthest the output reaches from the canvas origin, in pixels.
const MAX_COORD: f64 = (1 << 21) as f64;
/// Most samples along each side of an output pixel when averaging.
const MAX_SUBSAMPLES: usize = 16;
/// Most source pixels a block reads before it is split.
const MAX_SOURCE: i64 = 1 << 20;
/// Smallest block side worth splitting.
const MIN_BLOCK: i32 = 16;
/// The most output pixels a resampling makes (a billion: more than any
/// layer the engine can hold); a map that would make more leaves nothing.
const MAX_OUTPUT: i64 = 1 << 30;

/// The raster's pixels mapped through `m`, resampled.
pub(super) fn resample(src: &Raster, m: [f64; 6], interpolation: Interpolation) -> Raster {
    match src.channels() {
        4 => run::<4>(src, m, interpolation),
        1 => run::<1>(src, m, interpolation),
        c => Raster::new(c),
    }
}

fn run<const C: usize>(src: &Raster, m: [f64; 6], interpolation: Interpolation) -> Raster {
    let mut out = Raster::new(C as u8);
    let Some(content) = src.content_bounds() else {
        return out;
    };
    let [a, b, c, d, e, f] = m;
    let det = a * d - b * c;
    if !det.is_finite() || det.abs() < 1e-12 {
        return out;
    }
    let inv = [
        d / det,
        -b / det,
        -c / det,
        a / det,
        (c * f - d * e) / det,
        (b * e - a * f) / det,
    ];
    // The content's corners mapped give the output's bounds.
    let (l, t) = (f64::from(content.x), f64::from(content.y));
    let (r, btm) = (f64::from(content.right()), f64::from(content.bottom()));
    let corners =
        [(l, t), (r, t), (l, btm), (r, btm)].map(|(x, y)| (a * x + c * y + e, b * x + d * y + f));
    let snap = |v: f64| {
        let n = v.round();
        if (v - n).abs() < 1e-6 { n } else { v }
    };
    let xs = corners.map(|p| snap(p.0));
    let ys = corners.map(|p| snap(p.1));
    let lo = |v: [f64; 4]| v.iter().copied().fold(f64::INFINITY, f64::min).floor();
    let hi = |v: [f64; 4]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max).ceil();
    let clamp = |v: f64| v.clamp(-MAX_COORD, MAX_COORD) as i32;
    let rect = IRect::from_ltrb(clamp(lo(xs)), clamp(lo(ys)), clamp(hi(xs)), clamp(hi(ys)));
    if rect.is_empty() || rect.area() > MAX_OUTPUT {
        return out;
    }
    out.set_origin((rect.x, rect.y));
    // How many samples to average along each side of an output pixel.
    let average = |dx: f64, dy: f64| {
        let span = dx.hypot(dy);
        if interpolation != Interpolation::Nearest && span > 2.0 {
            (span.ceil() as usize).min(MAX_SUBSAMPLES)
        } else {
            1
        }
    };
    let sampler = Sampler {
        src,
        content,
        inv,
        interpolation,
        sub: (average(inv[0], inv[1]), average(inv[2], inv[3])),
        margin: match interpolation {
            Interpolation::Nearest => 1,
            Interpolation::Bilinear => 2,
            Interpolation::Bicubic => 3,
        },
    };
    for (tx, ty) in IRect::new(0, 0, rect.w, rect.h).tiles() {
        let block = IRect::tile(tx, ty)
            .translate(rect.x, rect.y)
            .intersect(&rect);
        sampler.block::<C>(&mut out, block);
    }
    out
}

/// Samples the source for blocks of output.
struct Sampler<'a> {
    src: &'a Raster,
    content: IRect,
    /// The inverse map: output canvas to source canvas.
    inv: [f64; 6],
    interpolation: Interpolation,
    /// Samples averaged across and down each output pixel.
    sub: (usize, usize),
    /// Source pixels read around what a block maps back to.
    margin: i32,
}

impl Sampler<'_> {
    /// Where an output canvas point comes from in the source.
    fn back(&self, x: f64, y: f64) -> (f64, f64) {
        let m = &self.inv;
        (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
    }

    /// Fills one block of the output.
    fn block<const C: usize>(&self, out: &mut Raster, block: IRect) {
        let corners = [
            (block.x, block.y),
            (block.right(), block.y),
            (block.x, block.bottom()),
            (block.right(), block.bottom()),
        ]
        .map(|(x, y)| self.back(f64::from(x), f64::from(y)));
        let lo = |v: [f64; 4]| v.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = |v: [f64; 4]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let (us, vs) = (corners.map(|p| p.0), corners.map(|p| p.1));
        let whole = |v: f64| v.clamp(-MAX_COORD, MAX_COORD) as i32;
        let need = IRect::from_ltrb(
            whole(lo(us).floor()) - self.margin,
            whole(lo(vs).floor()) - self.margin,
            whole(hi(us).ceil()) + self.margin,
            whole(hi(vs).ceil()) + self.margin,
        )
        .intersect(&self.content.outset(self.margin));
        if need.is_empty() {
            return;
        }
        let sparse = need.area() > MAX_SOURCE;
        if sparse && block.w >= 2 * MIN_BLOCK && block.h >= 2 * MIN_BLOCK {
            let (hw, hh) = (block.w / 2, block.h / 2);
            for part in [
                IRect::new(block.x, block.y, hw, hh),
                IRect::new(block.x + hw, block.y, block.w - hw, hh),
                IRect::new(block.x, block.y + hh, hw, block.h - hh),
                IRect::new(block.x + hw, block.y + hh, block.w - hw, block.h - hh),
            ] {
                self.block::<C>(out, part);
            }
            return;
        }
        let grid = if sparse {
            // Shrinking so far that even a small block maps back to more
            // than is worth reading whole: read only what is sampled.
            Grid {
                px: Vec::new(),
                raw: Vec::new(),
                rect: need,
                sparse: Some(self.src),
            }
        } else {
            let raw = self.src.read_vec(need);
            if raw.iter().all(|&v| v == 0) {
                return;
            }
            Grid {
                px: if self.interpolation == Interpolation::Nearest {
                    Vec::new()
                } else {
                    raw.chunks_exact(C).map(load::<C>).collect()
                },
                raw,
                rect: need,
                sparse: None,
            }
        };
        let mut data = vec![0u8; block.area() as usize * C];
        let (n0, n1) = self.sub;
        for (row, line) in data.chunks_exact_mut(block.w as usize * C).enumerate() {
            let y = f64::from(block.y + row as i32) + 0.5;
            let Some((x0, x1)) = self.span(y, block) else {
                continue;
            };
            for x in x0..x1 {
                let px = &mut line[((x - block.x) as usize) * C..][..C];
                let cx = f64::from(x) + 0.5;
                if self.interpolation == Interpolation::Nearest {
                    let (u, v) = self.back(cx, y);
                    grid.nearest(u, v, px);
                    continue;
                }
                let value = if n0 * n1 > 1 {
                    let mut sum = [0.0f32; C];
                    for j in 0..n1 {
                        let sy = y - 0.5 + (j as f64 + 0.5) / n1 as f64;
                        for i in 0..n0 {
                            let sx = cx - 0.5 + (i as f64 + 0.5) / n0 as f64;
                            let (u, v) = self.back(sx, sy);
                            add_scaled(&mut sum, &grid.bilinear(u, v), 1.0);
                        }
                    }
                    let k = 1.0 / (n0 * n1) as f32;
                    sum.map(|s| s * k)
                } else {
                    let (u, v) = self.back(cx, y);
                    match self.interpolation {
                        Interpolation::Bicubic => grid.bicubic(u, v),
                        _ => grid.bilinear(u, v),
                    }
                };
                store(value, px);
            }
        }
        out.write(block, &data);
    }

    /// The output pixels of row `y` (at pixel centers) within `block` that
    /// map back near the content.
    fn span(&self, y: f64, block: IRect) -> Option<(i32, i32)> {
        let reach = self.content.outset(self.margin + 1);
        let m = &self.inv;
        let (mut lo, mut hi) = (f64::from(block.x), f64::from(block.right()));
        for (base, slope, min, max) in [
            (m[2] * y + m[4], m[0], reach.x, reach.right()),
            (m[3] * y + m[5], m[1], reach.y, reach.bottom()),
        ] {
            let (min, max) = (f64::from(min), f64::from(max));
            if slope.abs() < 1e-12 {
                if base < min || base > max {
                    return None;
                }
                continue;
            }
            // base + slope · (x + 0.5) within min..max.
            let (a, b) = ((min - base) / slope - 0.5, (max - base) / slope - 0.5);
            lo = lo.max(a.min(b).floor() - 1.0);
            hi = hi.min(a.max(b).ceil() + 1.0);
        }
        (lo < hi).then_some((lo as i32, hi as i32))
    }
}

/// Source pixels around what a block maps back to.
struct Grid<'a, const C: usize> {
    /// Premultiplied values (not for nearest neighbor, nor when sparse).
    px: Vec<[f32; C]>,
    /// The samples as read (not when sparse).
    raw: Vec<u8>,
    rect: IRect,
    /// The source, when it is read a pixel at a time instead.
    sparse: Option<&'a Raster>,
}

impl<const C: usize> Grid<'_, C> {
    /// The samples of grid pixel `(i, j)` (inside the grid).
    fn samples(&self, i: i64, j: i64) -> [u8; 4] {
        match self.sparse {
            Some(src) => src.get(self.rect.x + i as i32, self.rect.y + j as i32),
            None => {
                let at = (j as usize * self.rect.w as usize + i as usize) * C;
                let mut px = [0u8; 4];
                px[..C].copy_from_slice(&self.raw[at..at + C]);
                px
            }
        }
    }

    /// The value of grid pixel `(i, j)`, zero outside.
    fn at(&self, i: i64, j: i64) -> [f32; C] {
        if i < 0 || j < 0 || i >= i64::from(self.rect.w) || j >= i64::from(self.rect.h) {
            return [0.0; C];
        }
        if self.px.is_empty() {
            return load::<C>(&self.samples(i, j));
        }
        self.px[j as usize * self.rect.w as usize + i as usize]
    }

    /// The source pixel containing canvas point `(u, v)`, copied as is.
    fn nearest(&self, u: f64, v: f64, out: &mut [u8]) {
        let (i, j) = (
            u.floor() - f64::from(self.rect.x),
            v.floor() - f64::from(self.rect.y),
        );
        if i < 0.0 || j < 0.0 || i >= f64::from(self.rect.w) || j >= f64::from(self.rect.h) {
            return;
        }
        out.copy_from_slice(&self.samples(i as i64, j as i64)[..C]);
    }

    /// Bilinear value at canvas point `(u, v)`.
    fn bilinear(&self, u: f64, v: f64) -> [f32; C] {
        let (fx, fy) = (
            u - 0.5 - f64::from(self.rect.x),
            v - 0.5 - f64::from(self.rect.y),
        );
        let (x0, y0) = (fx.floor(), fy.floor());
        let (tx, ty) = ((fx - x0) as f32, (fy - y0) as f32);
        let (i, j) = (x0 as i64, y0 as i64);
        let mut out = [0.0f32; C];
        add_scaled(&mut out, &self.at(i, j), (1.0 - tx) * (1.0 - ty));
        add_scaled(&mut out, &self.at(i + 1, j), tx * (1.0 - ty));
        add_scaled(&mut out, &self.at(i, j + 1), (1.0 - tx) * ty);
        add_scaled(&mut out, &self.at(i + 1, j + 1), tx * ty);
        out
    }

    /// Bicubic value at canvas point `(u, v)`.
    fn bicubic(&self, u: f64, v: f64) -> [f32; C] {
        let (fx, fy) = (
            u - 0.5 - f64::from(self.rect.x),
            v - 0.5 - f64::from(self.rect.y),
        );
        let (x0, y0) = (fx.floor(), fy.floor());
        let (wx, wy) = (keys((fx - x0) as f32), keys((fy - y0) as f32));
        let (i, j) = (x0 as i64 - 1, y0 as i64 - 1);
        let (w, h) = (i64::from(self.rect.w), i64::from(self.rect.h));
        let mut out = [0.0f32; C];
        if !self.px.is_empty() && i >= 0 && j >= 0 && i + 4 <= w && j + 4 <= h {
            let stride = w as usize;
            for (dy, &ky) in wy.iter().enumerate() {
                let row = &self.px[(j as usize + dy) * stride + i as usize..][..4];
                let mut acc = [0.0f32; C];
                for (v, &kx) in row.iter().zip(&wx) {
                    add_scaled(&mut acc, v, kx);
                }
                add_scaled(&mut out, &acc, ky);
            }
        } else {
            for (dy, &ky) in wy.iter().enumerate() {
                for (dx, &kx) in wx.iter().enumerate() {
                    add_scaled(&mut out, &self.at(i + dx as i64, j + dy as i64), kx * ky);
                }
            }
        }
        out
    }
}

/// Keys' cubic convolution weights (`a = -0.5`) for the four pixels around
/// a point `t` (`0..1`) past the second.
fn keys(t: f32) -> [f32; 4] {
    let (t2, t3) = (t * t, t * t * t);
    [
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1.0,
        -1.5 * t3 + 2.0 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2,
    ]
}
