//! Blend mode arithmetic: every Photoshop mode on straight colors in
//! `0..=1`, and compositing a source pixel over a backdrop with a mode.
//!
//! The separable modes follow the W3C compositing formulas, except where
//! Photoshop's own renders differ: Linear Light and Vivid Light treat 128
//! (not 127.5) as neutral, Vivid Light lets the source's extremes win, and
//! Soft Light is the W3C/PDF formula, whose polynomial for dark backdrops
//! Photoshop matches. The non-separable modes use
//! `Lum = 0.3R + 0.59G + 0.11B` with the spec's `SetLum`, `ClipColor`, and
//! `SetSat`. Compositing is `Cr = (1 - ab)·Cs + ab·B(Cb, Cs)`, then
//! source-over.

use crate::model::BlendMode;

/// Photoshop's neutral gray for the light modes: 128 of 255.
const MID: f32 = 128.0 / 255.0;

/// The blended color of a source over a backdrop (both straight RGB in
/// `0..=1`) before alpha compositing: Photoshop's `B(Cb, Cs)`.
pub fn blend(mode: BlendMode, backdrop: [f32; 3], source: [f32; 3]) -> [f32; 3] {
    let (b, s) = (backdrop, source);
    match mode {
        BlendMode::PassThrough | BlendMode::Normal | BlendMode::Dissolve => s,
        BlendMode::DarkerColor => {
            if lum(s) < lum(b) {
                s
            } else {
                b
            }
        }
        BlendMode::LighterColor => {
            if lum(s) > lum(b) {
                s
            } else {
                b
            }
        }
        BlendMode::Hue => set_lum(set_sat(s, sat(b)), lum(b)),
        BlendMode::Saturation => set_lum(set_sat(b, sat(s)), lum(b)),
        BlendMode::Color => set_lum(s, lum(b)),
        BlendMode::Luminosity => set_lum(b, lum(s)),
        _ => [
            channel(mode, b[0], s[0]),
            channel(mode, b[1], s[1]),
            channel(mode, b[2], s[2]),
        ],
    }
}

/// Composites a straight RGBA source (with `opacity` applied to its alpha)
/// over a straight RGBA backdrop with a blend mode; returns straight RGBA.
///
/// Dissolve needs a pixel position to pick pixels, so here it composites
/// like Normal.
pub fn composite(mode: BlendMode, backdrop: [f32; 4], source: [f32; 4], opacity: f32) -> [f32; 4] {
    let ab = backdrop[3].clamp(0.0, 1.0);
    let mut px = [backdrop[0] * ab, backdrop[1] * ab, backdrop[2] * ab, ab];
    let alpha = (source[3] * opacity).clamp(0.0, 1.0);
    composite_px(mode, &mut px, [source[0], source[1], source[2]], alpha, 1.0);
    unpremultiply(px)
}

/// One channel of a separable mode.
#[inline]
fn channel(mode: BlendMode, b: f32, s: f32) -> f32 {
    match mode {
        BlendMode::Darken => b.min(s),
        BlendMode::Multiply => b * s,
        BlendMode::ColorBurn => {
            if b >= 1.0 {
                1.0
            } else if s <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - b) / s).min(1.0)
            }
        }
        BlendMode::LinearBurn => (b + s - 1.0).max(0.0),
        BlendMode::Lighten => b.max(s),
        BlendMode::Screen => b + s - b * s,
        BlendMode::ColorDodge => {
            if b <= 0.0 {
                0.0
            } else if s >= 1.0 {
                1.0
            } else {
                (b / (1.0 - s)).min(1.0)
            }
        }
        BlendMode::LinearDodge => (b + s).min(1.0),
        BlendMode::Overlay => hard_light(s, b),
        BlendMode::SoftLight => soft_light(b, s),
        BlendMode::HardLight => hard_light(b, s),
        BlendMode::VividLight => vivid_light(b, s),
        BlendMode::LinearLight => (b + 2.0 * (s - MID)).clamp(0.0, 1.0),
        BlendMode::PinLight => {
            if s <= 0.5 {
                b.min(2.0 * s)
            } else {
                b.max(2.0 * s - 1.0)
            }
        }
        BlendMode::HardMix => {
            // Ties (complementary values) go to the backdrop's side.
            let t = b + s - 1.0;
            if t > 0.5 / 255.0 || (t > -0.5 / 255.0 && b > 0.5) {
                1.0
            } else {
                0.0
            }
        }
        BlendMode::Difference => (b - s).abs(),
        BlendMode::Exclusion => b + s - 2.0 * b * s,
        BlendMode::Subtract => (b - s).max(0.0),
        BlendMode::Divide => {
            if s <= 0.0 {
                if b > 0.0 { 1.0 } else { 0.0 }
            } else {
                (b / s).min(1.0)
            }
        }
        _ => s,
    }
}

fn hard_light(b: f32, s: f32) -> f32 {
    if s <= 0.5 {
        b * 2.0 * s
    } else {
        let s2 = 2.0 * s - 1.0;
        b + s2 - b * s2
    }
}

fn soft_light(b: f32, s: f32) -> f32 {
    if s <= 0.5 {
        b - (1.0 - 2.0 * s) * b * (1.0 - b)
    } else {
        let d = if b <= 0.25 {
            ((16.0 * b - 12.0) * b + 4.0) * b
        } else {
            b.sqrt()
        };
        b + (2.0 * s - 1.0) * (d - b)
    }
}

/// Color Burn below 128 and Color Dodge above, each scaled so 128 is
/// neutral; a black or white source wins whatever the backdrop.
fn vivid_light(b: f32, s: f32) -> f32 {
    if s < MID {
        if s <= 0.0 {
            return 0.0;
        }
        (1.0 - (1.0 - b) * MID / s).max(0.0)
    } else {
        if s >= 1.0 {
            return 1.0;
        }
        let d = 2.0 * (s - MID);
        (b / (1.0 - d)).min(1.0)
    }
}

/// The luminosity non-separable modes use.
#[inline]
pub(crate) fn lum(c: [f32; 3]) -> f32 {
    0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
}

fn clip_color(c: [f32; 3]) -> [f32; 3] {
    let l = lum(c);
    let n = c[0].min(c[1]).min(c[2]);
    let x = c[0].max(c[1]).max(c[2]);
    let mut out = c;
    if n < 0.0 && l - n > f32::EPSILON {
        out = out.map(|v| l + (v - l) * l / (l - n));
    }
    if x > 1.0 && x - l > f32::EPSILON {
        out = out.map(|v| l + (v - l) * (1.0 - l) / (x - l));
    }
    out.map(|v| v.clamp(0.0, 1.0))
}

/// `c` moved to luminosity `l`, kept in gamut.
pub(crate) fn set_lum(c: [f32; 3], l: f32) -> [f32; 3] {
    let d = l - lum(c);
    clip_color([c[0] + d, c[1] + d, c[2] + d])
}

fn sat(c: [f32; 3]) -> f32 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}

fn set_sat(c: [f32; 3], s: f32) -> [f32; 3] {
    // Indices of the smallest, middle, and largest components.
    let mut idx = [0usize, 1, 2];
    idx.sort_by(|&a, &b| c[a].total_cmp(&c[b]));
    let [lo, mid, hi] = idx;
    let mut out = [0.0; 3];
    if c[hi] > c[lo] {
        out[mid] = (c[mid] - c[lo]) * s / (c[hi] - c[lo]);
        out[hi] = s;
    }
    out
}

/// The modes whose fill opacity Photoshop applies inside the blend rather
/// than as coverage.
pub(crate) fn fill_inside(mode: BlendMode) -> bool {
    matches!(
        mode,
        BlendMode::ColorBurn
            | BlendMode::LinearBurn
            | BlendMode::ColorDodge
            | BlendMode::LinearDodge
            | BlendMode::VividLight
            | BlendMode::LinearLight
            | BlendMode::HardMix
            | BlendMode::Difference
    )
}

/// `B(Cb, Cs)` at fill opacity `fill` for the modes that take fill inside
/// the blend: the source moves toward the color the mode leaves unchanged
/// (black for the dodges and Difference, white for the burns, 128 gray for
/// the lights), and Hard Mix softens into a steep ramp.
fn blend_fill(mode: BlendMode, b: [f32; 3], s: [f32; 3], fill: f32) -> [f32; 3] {
    let toward = |neutral: f32| s.map(|v| neutral + (v - neutral) * fill);
    match mode {
        BlendMode::ColorDodge | BlendMode::LinearDodge | BlendMode::Difference => {
            blend(mode, b, toward(0.0))
        }
        BlendMode::ColorBurn | BlendMode::LinearBurn => blend(mode, b, toward(1.0)),
        BlendMode::VividLight | BlendMode::LinearLight => blend(mode, b, toward(MID)),
        BlendMode::HardMix => {
            let k = 1.0 - fill;
            std::array::from_fn(|i| {
                if k <= 1e-4 {
                    channel(mode, b[i], s[i])
                } else {
                    ((b[i] - (1.0 - s[i]) * fill) / k).clamp(0.0, 1.0)
                }
            })
        }
        _ => blend(mode, b, s),
    }
}

/// Composites a straight source color with coverage `alpha` onto a
/// premultiplied pixel, at fill opacity `fill`.
///
/// Fill is coverage for most modes; for [`fill_inside`] modes it weakens
/// the blend while the source keeps its full coverage over the backdrop,
/// and only the part over transparency fades with it.
#[inline]
pub(crate) fn composite_px(mode: BlendMode, d: &mut [f32; 4], cs: [f32; 3], alpha: f32, fill: f32) {
    if alpha <= 0.0 {
        return;
    }
    let ab = d[3];
    if fill < 1.0 && fill_inside(mode) {
        if ab <= 0.0 {
            let a = alpha * fill;
            *d = [cs[0] * a, cs[1] * a, cs[2] * a, a];
            return;
        }
        let cb = backdrop_color(d);
        let bl = blend_fill(mode, cb, cs, fill);
        let over = alpha * (1.0 - ab) * fill;
        let mixed = alpha * ab;
        for i in 0..3 {
            d[i] = over * cs[i] + mixed * bl[i] + (1.0 - alpha) * d[i];
        }
        d[3] = over + ab;
        return;
    }
    let a = alpha * fill;
    if a <= 0.0 {
        return;
    }
    match mode {
        BlendMode::Normal | BlendMode::PassThrough | BlendMode::Dissolve => {
            let k = 1.0 - a;
            *d = [
                cs[0] * a + d[0] * k,
                cs[1] * a + d[1] * k,
                cs[2] * a + d[2] * k,
                a + d[3] * k,
            ];
        }
        _ => {
            if ab <= 0.0 {
                *d = [cs[0] * a, cs[1] * a, cs[2] * a, a];
                return;
            }
            let bl = blend(mode, backdrop_color(d), cs);
            let k = 1.0 - a;
            for i in 0..3 {
                d[i] = a * ((1.0 - ab) * cs[i] + ab * bl[i]) + k * d[i];
            }
            d[3] = a + ab * k;
        }
    }
}

/// The straight color of a premultiplied pixel with nonzero alpha.
#[inline]
fn backdrop_color(d: &[f32; 4]) -> [f32; 3] {
    let inv = 1.0 / d[3];
    [
        (d[0] * inv).clamp(0.0, 1.0),
        (d[1] * inv).clamp(0.0, 1.0),
        (d[2] * inv).clamp(0.0, 1.0),
    ]
}

/// A premultiplied pixel as straight RGBA.
#[inline]
pub(crate) fn unpremultiply(p: [f32; 4]) -> [f32; 4] {
    if p[3] <= 0.0 {
        return [0.0; 4];
    }
    let inv = 1.0 / p[3];
    [
        (p[0] * inv).clamp(0.0, 1.0),
        (p[1] * inv).clamp(0.0, 1.0),
        (p[2] * inv).clamp(0.0, 1.0),
        p[3].min(1.0),
    ]
}

/// Dissolve's per-pixel threshold in `0..1`: a hash of the pixel position,
/// so tiles agree wherever they are cut.
#[inline]
pub(crate) fn dissolve_threshold(x: i32, y: i32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x9E37_79B1) ^ (y as u32).wrapping_mul(0x85EB_CA77);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^= h >> 15;
    (h >> 8) as f32 / (1u32 << 24) as f32
}

/// Composites a row of straight sources (`[r, g, b, coverage]`) onto a row
/// of premultiplied pixels whose first pixel is at canvas `(x, y)`, with a
/// mode, a uniform opacity, and fill opacity.
pub(crate) fn composite_row(
    mode: BlendMode,
    dst: &mut [[f32; 4]],
    src: &[[f32; 4]],
    opacity: f32,
    fill: f32,
    x: i32,
    y: i32,
) {
    match mode {
        BlendMode::Normal | BlendMode::PassThrough => {
            let k = opacity * fill;
            for (d, s) in dst.iter_mut().zip(src) {
                let a = s[3] * k;
                if a <= 0.0 {
                    continue;
                }
                let r = 1.0 - a;
                *d = [
                    s[0] * a + d[0] * r,
                    s[1] * a + d[1] * r,
                    s[2] * a + d[2] * r,
                    a + d[3] * r,
                ];
            }
        }
        BlendMode::Dissolve => {
            let k = opacity * fill;
            for (i, (d, s)) in dst.iter_mut().zip(src).enumerate() {
                let a = s[3] * k;
                if a > 0.0 && dissolve_threshold(x + i as i32, y) < a {
                    *d = [s[0], s[1], s[2], 1.0];
                }
            }
        }
        _ => {
            for (d, s) in dst.iter_mut().zip(src) {
                composite_px(mode, d, [s[0], s[1], s[2]], s[3] * opacity, fill);
            }
        }
    }
}

#[cfg(test)]
mod test;
