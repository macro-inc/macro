//! Gaussian blurs of premultiplied pixels, zero (transparent) beyond the
//! raster's tiles.
//!
//! Narrow blurs use exact Gaussian weights (each the integral of the
//! Gaussian over its pixel), wider ones three box blurs of matched variance
//! (constant cost per pixel at any radius). Both run separably over blocks
//! a tile wide, so memory stays small. Very wide blurs blur an
//! area-averaged reduced copy instead and scale it back up bilinearly,
//! subtracting what the reduction itself blurs.

use super::premul::{add_rows, add_scaled, load};
use crate::raster::{IRect, Raster, TILE};

/// Standard deviations under this use exact weights.
const TAPS_SIGMA: f32 = 3.0;
/// Standard deviations over this blur a reduced copy.
const DIRECT_SIGMA: f32 = 50.0;
/// The reduced copy's standard deviation, in its pixels.
const REDUCED_SIGMA: f32 = 25.0;
/// Output rows per block (more when the blur is wider).
const CHUNK_ROWS: i32 = 256;

/// How far a blur of standard deviation `sigma` reaches.
pub(super) fn reach(sigma: f32) -> i32 {
    if sigma > DIRECT_SIGMA {
        (3.0 * sigma).ceil() as i32
    } else {
        Kernel::gaussian(sigma).reach() as i32
    }
}

/// Blurs `area` of `src` (straight pixels in, premultiplied values out),
/// handing each block's values to `f(block, values)` row by row.
pub(super) fn blur<const C: usize>(
    src: &Raster,
    area: IRect,
    sigma: f32,
    f: impl FnMut(IRect, &[[f32; C]]),
) {
    if sigma > DIRECT_SIGMA {
        reduced(src, area, sigma, f);
    } else {
        direct(src, area, &Kernel::gaussian(sigma), f);
    }
}

/// A one-dimensional blur.
pub(super) enum Kernel {
    /// Weights from `-reach` to `reach`.
    Taps(Vec<f32>),
    /// Three box blurs, by radius.
    Boxes([usize; 3]),
}

/// The error function (Abramowitz and Stegun 7.1.26, within 1.5e-7).
fn erf(x: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.327_591_1 * x.abs());
    let poly = ((((1.061_405_429 * t - 1.453_152_027) * t + 1.421_413_741) * t - 0.284_496_736)
        * t
        + 0.254_829_592)
        * t;
    (1.0 - poly * (-x * x).exp()).copysign(x)
}

impl Kernel {
    /// A Gaussian of standard deviation `sigma`.
    pub fn gaussian(sigma: f32) -> Kernel {
        if sigma < TAPS_SIGMA {
            let s = f64::from(sigma.max(0.01));
            let r = (3.0 * s).ceil().max(1.0) as i64;
            let cdf = |x: f64| 0.5 * (1.0 + erf(x / (s * std::f64::consts::SQRT_2)));
            let w: Vec<f64> = (-r..=r)
                .map(|i| cdf(i as f64 + 0.5) - cdf(i as f64 - 0.5))
                .collect();
            let total: f64 = w.iter().sum();
            return Kernel::Taps(w.iter().map(|v| (v / total) as f32).collect());
        }
        // Box widths whose variances add up to sigma² (Kovesi).
        let s2 = f64::from(sigma) * f64::from(sigma);
        let ideal = (4.0 * s2 + 1.0).sqrt();
        let mut low = ideal.floor() as i64;
        if low % 2 == 0 {
            low -= 1;
        }
        let low = low.max(1);
        let lowf = low as f64;
        let m = ((12.0 * s2 - 3.0 * lowf * lowf - 12.0 * lowf - 9.0) / (-4.0 * lowf - 4.0))
            .round()
            .clamp(0.0, 3.0) as usize;
        let radius = |i: usize| (if i < m { low } else { low + 2 } as usize - 1) / 2;
        Kernel::Boxes([radius(0), radius(1), radius(2)])
    }

    /// How far it reaches to either side.
    pub fn reach(&self) -> usize {
        match self {
            Kernel::Taps(w) => w.len() / 2,
            Kernel::Boxes(r) => r.iter().sum(),
        }
    }

    /// Blurs `line` into `out`, which is `reach` shorter at each end:
    /// `out[i]` is centered on `line[i + reach]`.
    pub fn run<const C: usize>(
        &self,
        line: &[[f32; C]],
        out: &mut [[f32; C]],
        scratch: &mut [Vec<[f32; C]>; 2],
    ) {
        self.run_rows(line, 1, out, scratch);
    }

    /// Blurs down the columns of `rows` (rows `width` values long) into
    /// `out`, which is `reach` rows shorter at each end, a whole row at a
    /// time.
    pub fn run_rows<const C: usize>(
        &self,
        rows: &[[f32; C]],
        width: usize,
        out: &mut [[f32; C]],
        scratch: &mut [Vec<[f32; C]>; 2],
    ) {
        match self {
            Kernel::Taps(w) if width == 1 => {
                out.fill([0.0; C]);
                for (k, &wk) in w.iter().enumerate() {
                    add_rows(out, &rows[k..], wk);
                }
            }
            Kernel::Taps(w) => {
                // A row at a time, so it stays in cache.
                for (y, row) in out.chunks_exact_mut(width).enumerate() {
                    row.fill([0.0; C]);
                    for (k, &wk) in w.iter().enumerate() {
                        add_rows(row, &rows[(y + k) * width..], wk);
                    }
                }
            }
            Kernel::Boxes(radii) => {
                let [a, b] = scratch;
                a.clear();
                a.extend_from_slice(rows);
                for &r in radii {
                    box_rows(a, b, width, r);
                    std::mem::swap(a, b);
                }
                let skip = self.reach() * width;
                out.copy_from_slice(&a[skip..skip + out.len()]);
            }
        }
    }
}

/// A box blur of radius `r` rows down the columns of `src` (rows `width`
/// long) into `dst` (the same size), zero beyond its ends.
fn box_rows<const C: usize>(src: &[[f32; C]], dst: &mut Vec<[f32; C]>, width: usize, r: usize) {
    dst.clear();
    dst.resize(src.len(), [0.0; C]);
    if width == 1 {
        box_line(src, dst, r);
        return;
    }
    let h = src.len() / width;
    let inv = 1.0 / (2 * r + 1) as f32;
    let row = |y: usize| &src[y * width..(y + 1) * width];
    let mut sum = vec![[0.0f32; C]; width];
    for y in 0..(r + 1).min(h) {
        add_rows(&mut sum, row(y), 1.0);
    }
    for (y, out) in dst.chunks_exact_mut(width).enumerate() {
        let out = out.as_flattened_mut();
        for (o, &s) in out.iter_mut().zip(sum.as_flattened()) {
            *o = s * inv;
        }
        if y + r + 1 < h {
            add_rows(&mut sum, row(y + r + 1), 1.0);
        }
        if y >= r {
            add_rows(&mut sum, row(y - r), -1.0);
        }
    }
}

/// A box blur of radius `r` along one line (`dst` as long as `src`), zero
/// beyond its ends.
fn box_line<const C: usize>(src: &[[f32; C]], dst: &mut [[f32; C]], r: usize) {
    let n = src.len();
    let inv = 1.0 / (2 * r + 1) as f32;
    let add = |a: [f32; C], b: [f32; C]| std::array::from_fn::<f32, C, _>(|i| a[i] + b[i]);
    let sub = |a: [f32; C], b: [f32; C]| std::array::from_fn::<f32, C, _>(|i| a[i] - b[i]);
    let mut sum = [0.0f32; C];
    for &v in &src[..(r + 1).min(n)] {
        sum = add(sum, v);
    }
    for (i, d) in dst.iter_mut().enumerate() {
        *d = sum.map(|s| s * inv);
        if let Some(&v) = src.get(i + r + 1) {
            sum = add(sum, v);
        }
        if i >= r {
            sum = sub(sum, src[i - r]);
        }
    }
}

/// Whether any of the raster's tiles meets a canvas rectangle.
fn touches(src: &Raster, rect: IRect) -> bool {
    let (ox, oy) = src.origin();
    rect.translate(-ox, -oy)
        .tiles()
        .any(|(tx, ty)| src.tile(tx, ty).is_some())
}

/// Blurs separably in blocks a tile wide and [`CHUNK_ROWS`] tall (taller
/// for wide blurs): across each input row, then down whole rows.
fn direct<const C: usize>(
    src: &Raster,
    area: IRect,
    kernel: &Kernel,
    mut f: impl FnMut(IRect, &[[f32; C]]),
) {
    let r = kernel.reach() as i32;
    let chunk = CHUNK_ROWS.max(4 * r);
    let ox = src.origin().0;
    let mut raw = Vec::new();
    let mut line = Vec::new();
    let mut across = Vec::new();
    let mut values = Vec::new();
    let mut scratch = [Vec::new(), Vec::new()];
    let mut x = area.x;
    while x < area.right() {
        let x1 = (((x - ox).div_euclid(TILE) + 1) * TILE + ox).min(area.right());
        let mut y = area.y;
        while y < area.bottom() {
            let y1 = (y + chunk).min(area.bottom());
            let block = IRect::from_ltrb(x, y, x1, y1);
            y = y1;
            let input = block.outset(r);
            if !touches(src, input) {
                continue;
            }
            let (bw, bh) = (block.w as usize, block.h as usize);
            let (iw, ih) = (input.w as usize, input.h as usize);
            // Across each input row, into `across` (`ih` rows of `bw`).
            raw.resize(iw * ih * C, 0);
            src.read(input, &mut raw);
            line.resize(iw, [0.0; C]);
            across.resize(bw * ih, [0.0; C]);
            for (row, out) in raw.chunks_exact(iw * C).zip(across.chunks_exact_mut(bw)) {
                if row.iter().all(|&v| v == 0) {
                    out.fill([0.0; C]);
                    continue;
                }
                for (l, px) in line.iter_mut().zip(row.chunks_exact(C)) {
                    *l = load(px);
                }
                kernel.run(&line, out, &mut scratch);
            }
            // Down the rows, into `values`.
            values.resize(bw * bh, [0.0; C]);
            kernel.run_rows(&across, bw, &mut values, &mut scratch);
            f(block, &values);
        }
        x = x1;
    }
}

/// Blurs a reduced copy and scales it back up.
fn reduced<const C: usize>(
    src: &Raster,
    area: IRect,
    sigma: f32,
    mut f: impl FnMut(IRect, &[[f32; C]]),
) {
    let k = (sigma / REDUCED_SIGMA).ceil().max(2.0) as i32;
    let input = area.outset((3.0 * sigma).ceil() as i32);
    let (lw, lh) = (
        (input.w as usize).div_ceil(k as usize),
        (input.h as usize).div_ceil(k as usize),
    );
    // Area averages of k × k blocks.
    let mut low = vec![[0.0f32; C]; lw * lh];
    let mut raw = vec![0u8; input.w as usize * C];
    let inv = 1.0 / (k * k) as f32;
    for row in 0..input.h {
        let y = input.y + row;
        if !touches(src, IRect::new(input.x, y, input.w, 1)) {
            continue;
        }
        src.read(IRect::new(input.x, y, input.w, 1), &mut raw);
        let cells = &mut low[(row / k) as usize * lw..][..lw];
        for (i, px) in raw.chunks_exact(C).enumerate() {
            add_scaled(&mut cells[i / k as usize], &load(px), inv);
        }
    }
    // Reducing averages over a box (variance (k² - 1) / 12) and scaling up
    // bilinearly over a tent (k² / 6): blur the copy by the rest.
    let kf = k as f32;
    let rest = (sigma * sigma - kf * kf / 4.0).max(0.0).sqrt() / kf;
    let kernel = Kernel::gaussian(rest);
    blur_in_place(&mut low, lw, lh, &kernel);
    // Scale back up, a tile at a time.
    let mut values = Vec::new();
    for (tx, ty) in area.tiles() {
        let block = IRect::tile(tx, ty).intersect(&area);
        // Nothing there, and nothing worth a level arriving.
        let cells = |lo: i32, hi: i32, start: i32, n: usize| {
            let first = ((lo - start) / k - 1).clamp(0, n as i32 - 1) as usize;
            let last = ((hi - start) / k + 1).clamp(0, n as i32 - 1) as usize;
            first..=last
        };
        let (xs, ys) = (
            cells(block.x, block.right(), input.x, lw),
            cells(block.y, block.bottom(), input.y, lh),
        );
        let faint = ys
            .clone()
            .all(|j| low[j * lw..][xs.clone()].iter().all(|v| v[C - 1] < 0.5));
        if faint && !touches(src, block) {
            continue;
        }
        values.clear();
        for y in block.y..block.bottom() {
            let v = (y as f32 + 0.5 - input.y as f32) / kf - 0.5;
            for x in block.x..block.right() {
                let u = (x as f32 + 0.5 - input.x as f32) / kf - 0.5;
                values.push(bilinear(&low, lw, lh, u, v));
            }
        }
        f(block, &values);
    }
}

/// Blurs a `w × h` grid of values in place (zero beyond it).
fn blur_in_place<const C: usize>(grid: &mut [[f32; C]], w: usize, h: usize, kernel: &Kernel) {
    let r = kernel.reach();
    let mut scratch = [Vec::new(), Vec::new()];
    let mut line = Vec::new();
    let mut out = Vec::new();
    for (len, count, stride, step) in [(w, h, 1, w), (h, w, w, 1)] {
        line.clear();
        line.resize(len + 2 * r, [0.0; C]);
        out.resize(len, [0.0; C]);
        for i in 0..count {
            for (j, l) in line[r..r + len].iter_mut().enumerate() {
                *l = grid[i * step + j * stride];
            }
            kernel.run(&line, &mut out, &mut scratch);
            for (j, &o) in out.iter().enumerate() {
                grid[i * step + j * stride] = o;
            }
        }
    }
}

/// The grid's value at `(u, v)` (cell centers at whole numbers), zero
/// beyond it.
fn bilinear<const C: usize>(grid: &[[f32; C]], w: usize, h: usize, u: f32, v: f32) -> [f32; C] {
    let (u0, v0) = (u.floor(), v.floor());
    let (fu, fv) = (u - u0, v - v0);
    let mut out = [0.0; C];
    for (dy, wy) in [(0, 1.0 - fv), (1, fv)] {
        for (dx, wx) in [(0, 1.0 - fu), (1, fu)] {
            let (x, y) = (u0 as i64 + dx, v0 as i64 + dy);
            if x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h {
                add_scaled(&mut out, &grid[y as usize * w + x as usize], wx * wy);
            }
        }
    }
    out
}
