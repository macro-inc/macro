//! Image comparison for fidelity scoring (against reference renders) and
//! compact render fingerprints (for regression tests without reference images).

use crate::render::scene::Raster;
use serde::{Deserialize, Serialize};

/// Similarity of a render to a reference image.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Score {
    /// Mean structural similarity of luminance (1 = identical).
    pub ssim: f32,
    /// Fraction of pixels whose color differs noticeably after a small blur.
    pub mismatch: f32,
}

/// Width of the luminance grid stored in a [`fingerprint`].
pub const FINGERPRINT_COLUMNS: u32 = 32;

/// A per-channel difference (0–255) above which a pixel counts as mismatched.
const MISMATCH_THRESHOLD: f32 = 40.0;

/// Straight RGB composited over white.
fn rgb_over_white(r: &Raster) -> Vec<[f32; 3]> {
    r.pixels
        .chunks_exact(4)
        .map(|p| {
            let a = 255.0 - f32::from(p[3]);
            [
                f32::from(p[0]) + a,
                f32::from(p[1]) + a,
                f32::from(p[2]) + a,
            ]
        })
        .collect()
}

/// Area-averaged resample of an RGB plane.
fn resample(px: &[[f32; 3]], w: u32, h: u32, nw: u32, nh: u32) -> Vec<[f32; 3]> {
    let (w, h, nw, nh) = (
        w as usize,
        h as usize,
        nw.max(1) as usize,
        nh.max(1) as usize,
    );
    let mut out = vec![[0.0f32; 3]; nw * nh];
    for (oy, row) in out.chunks_exact_mut(nw).enumerate() {
        let y0 = oy * h / nh;
        let y1 = ((oy + 1) * h / nh).max(y0 + 1).min(h);
        for (ox, cell) in row.iter_mut().enumerate() {
            let x0 = ox * w / nw;
            let x1 = ((ox + 1) * w / nw).max(x0 + 1).min(w);
            let mut acc = [0.0f32; 3];
            for y in y0..y1 {
                for p in &px[y * w + x0..y * w + x1] {
                    acc[0] += p[0];
                    acc[1] += p[1];
                    acc[2] += p[2];
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as f32;
            *cell = [acc[0] / n, acc[1] / n, acc[2] / n];
        }
    }
    out
}

fn luma(p: [f32; 3]) -> f32 {
    0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
}

/// 3×3 box blur of an RGB plane.
fn blur(px: &[[f32; 3]], w: usize, h: usize) -> Vec<[f32; 3]> {
    let mut out = vec![[0.0f32; 3]; px.len()];
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0.0f32; 3];
            let mut n = 0.0;
            for yy in y.saturating_sub(1)..(y + 2).min(h) {
                for xx in x.saturating_sub(1)..(x + 2).min(w) {
                    let p = px[yy * w + xx];
                    acc[0] += p[0];
                    acc[1] += p[1];
                    acc[2] += p[2];
                    n += 1.0;
                }
            }
            out[y * w + x] = [acc[0] / n, acc[1] / n, acc[2] / n];
        }
    }
    out
}

/// Mean SSIM over 8×8 windows (stride 4) of two luminance planes.
fn ssim(a: &[f32], b: &[f32], w: usize, h: usize) -> f32 {
    const C1: f64 = (0.01 * 255.0) * (0.01 * 255.0);
    const C2: f64 = (0.03 * 255.0) * (0.03 * 255.0);
    if w < 8 || h < 8 {
        return if a == b { 1.0 } else { 0.0 };
    }
    let mut total = 0.0f64;
    let mut count = 0usize;
    let mut y = 0;
    while y + 8 <= h {
        let mut x = 0;
        while x + 8 <= w {
            let (mut sa, mut sb, mut saa, mut sbb, mut sab) =
                (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
            for yy in y..y + 8 {
                for xx in x..x + 8 {
                    let (va, vb) = (f64::from(a[yy * w + xx]), f64::from(b[yy * w + xx]));
                    sa += va;
                    sb += vb;
                    saa += va * va;
                    sbb += vb * vb;
                    sab += va * vb;
                }
            }
            let n = 64.0;
            let (ma, mb) = (sa / n, sb / n);
            let va = saa / n - ma * ma;
            let vb = sbb / n - mb * mb;
            let cov = sab / n - ma * mb;
            total += ((2.0 * ma * mb + C1) * (2.0 * cov + C2))
                / ((ma * ma + mb * mb + C1) * (va + vb + C2));
            count += 1;
            x += 4;
        }
        y += 4;
    }
    (total / count as f64) as f32
}

/// Brings both images to `a`'s size (the reference is resampled when its size differs).
fn aligned(a: &Raster, b: &Raster) -> (Vec<[f32; 3]>, Vec<[f32; 3]>, usize, usize) {
    let pa = rgb_over_white(a);
    let pb = rgb_over_white(b);
    let pb = if (a.width, a.height) == (b.width, b.height) {
        pb
    } else {
        resample(&pb, b.width, b.height, a.width, a.height)
    };
    (pa, pb, a.width as usize, a.height as usize)
}

/// Scores `ours` against `reference`.
pub fn compare(ours: &Raster, reference: &Raster) -> Score {
    let (pa, pb, w, h) = aligned(ours, reference);
    if w == 0 || h == 0 {
        return Score {
            ssim: 0.0,
            mismatch: 1.0,
        };
    }
    let (ba, bb) = (blur(&pa, w, h), blur(&pb, w, h));
    let mismatched = ba
        .iter()
        .zip(&bb)
        .filter(|(x, y)| (0..3).any(|c| (x[c] - y[c]).abs() > MISMATCH_THRESHOLD))
        .count();
    // Structural similarity at half resolution forgives anti-aliasing differences.
    let (hw, hh) = ((w / 2).max(1), (h / 2).max(1));
    let la: Vec<f32> = resample(&pa, w as u32, h as u32, hw as u32, hh as u32)
        .into_iter()
        .map(luma)
        .collect();
    let lb: Vec<f32> = resample(&pb, w as u32, h as u32, hw as u32, hh as u32)
        .into_iter()
        .map(luma)
        .collect();
    Score {
        ssim: ssim(&la, &lb, hw, hh),
        mismatch: mismatched as f32 / (w * h) as f32,
    }
}

/// A visual diff: the reference in faded gray, mismatched pixels in red.
pub fn diff_image(ours: &Raster, reference: &Raster) -> Raster {
    let (pa, pb, w, h) = aligned(ours, reference);
    let (ba, bb) = (blur(&pa, w, h), blur(&pb, w, h));
    let mut out = Raster::new(w as u32, h as u32);
    for (i, px) in out.pixels.chunks_exact_mut(4).enumerate() {
        let differs = (0..3).any(|c| (ba[i][c] - bb[i][c]).abs() > MISMATCH_THRESHOLD);
        let g = (luma(pb[i]) * 0.35 + 255.0 * 0.65).clamp(0.0, 255.0) as u8;
        let rgb = if differs { [220, 30, 30] } else { [g, g, g] };
        px.copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
    }
    out
}

/// A compact luminance fingerprint: a [`FINGERPRINT_COLUMNS`]-wide grid of
/// 4-bit cells as hex, row-major.
pub fn fingerprint(r: &Raster) -> String {
    let cols = FINGERPRINT_COLUMNS;
    let rows = ((r.height as f32 * cols as f32 / r.width.max(1) as f32).round() as u32).max(1);
    resample(&rgb_over_white(r), r.width, r.height, cols, rows)
        .into_iter()
        .map(|p| {
            let v = (luma(p) / 16.0).floor().clamp(0.0, 15.0) as u32;
            char::from_digit(v, 16).unwrap_or('0')
        })
        .collect()
}

/// Distance between two fingerprints: `(mean cell difference, largest cell difference)`,
/// in 4-bit levels. Grids of different shapes are infinitely far apart.
pub fn fingerprint_distance(a: &str, b: &str) -> (f32, u32) {
    if a.len() != b.len() || a.is_empty() {
        return (f32::INFINITY, u32::MAX);
    }
    let mut sum = 0u32;
    let mut max = 0u32;
    for (x, y) in a.chars().zip(b.chars()) {
        let d = x
            .to_digit(16)
            .unwrap_or(0)
            .abs_diff(y.to_digit(16).unwrap_or(0));
        sum += d;
        max = max.max(d);
    }
    (sum as f32 / a.len() as f32, max)
}

pub mod corpus;

#[cfg(test)]
mod test;
