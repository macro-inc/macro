//! Image adjustments (the image paint's Exposure, Contrast, Saturation,
//! Temperature, Tint, Highlights, and Shadows), applied to decoded pixels.
//!
//! Figma does not document its filter math. Exposure and Contrast follow
//! transfer curves measured from Figma's exports (OpenFig's calibration:
//! mid-tone response per exposure, slope per contrast); the other controls'
//! strengths were fitted against Figma's own renders of adjusted photos.
//! Adjustments run in order on straight (unpremultiplied) sRGB values:
//! exposure, contrast, highlights and shadows, temperature and tint, then
//! saturation.

use crate::model::ImageFilters;
use tiny_skia::Pixmap;

/// Exposure → how much it multiplies a mid-tone (input 124 of 255).
const EXPOSURE_CURVE: [(f32, f32); 11] = [
    (-1.0, 0.129),
    (-0.75, 0.2258),
    (-0.5, 0.379),
    (-0.25, 0.629),
    (0.0, 1.0),
    (0.125, 1.2177),
    (0.25, 1.4274),
    (0.375, 1.621),
    (0.5, 1.7742),
    (0.75, 1.9516),
    (1.0, 2.0242),
];

/// Contrast → the slope it gives tones about its pivot. Figma clamps the
/// control at ±0.5: stronger values look the same.
const CONTRAST_CURVE: [(f32, f32); 5] = [
    (-0.5, 0.7672),
    (-0.25, 0.8068),
    (0.0, 1.0),
    (0.25, 1.0973),
    (0.5, 1.115),
];

const MID_TONE: f32 = 124.0 / 255.0;

/// Highlights brighten (or darken) by up to this much where luminance is 1,
/// falling off with luminance squared.
const HIGHLIGHTS: f32 = 0.36;
/// Shadows move tones below this luminance…
const SHADOW_RANGE: f32 = 0.56;
/// …by up to this much at black (negative values lift them).
const SHADOWS: f32 = -0.225;
/// What a tint of 1 adds to red, green, and blue (toward magenta).
const TINT: [f32; 3] = [0.13, -0.26, -0.14];
/// What a temperature of 1 adds to red and blue (toward orange).
const TEMPERATURE: [f32; 3] = [0.15, 0.0, -0.15];

const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];

fn interpolate(curve: &[(f32, f32)], v: f32) -> f32 {
    let (first, last) = (curve[0], curve[curve.len() - 1]);
    if v <= first.0 {
        return first.1;
    }
    if v >= last.0 {
        return last.1;
    }
    for pair in curve.windows(2) {
        let ((x0, y0), (x1, y1)) = (pair[0], pair[1]);
        if v <= x1 {
            return y0 + (v - x0) / (x1 - x0) * (y1 - y0);
        }
    }
    last.1
}

fn to_linear(x: f32) -> f32 {
    if x <= 0.04045 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    }
}

fn to_srgb(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    if x <= 0.003_130_8 {
        x * 12.92
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}

/// The per-channel tone curve of exposure and contrast.
fn tone(x: f32, f: &ImageFilters) -> f32 {
    let mut x = x;
    let e = f.exposure.clamp(-1.0, 1.0);
    if e != 0.0 {
        let target = (MID_TONE * interpolate(&EXPOSURE_CURVE, e)).min(0.999);
        x = if e > 0.0 {
            // Lifts shadows hard and rolls highlights off below white:
            // 1 - (1 - x)^k, through the measured mid-tone response.
            let k = (1.0 - target).ln() / (1.0 - MID_TONE).ln();
            1.0 - (1.0 - x).max(0.0).powf(k)
        } else {
            // A gain in linear light.
            to_srgb(to_linear(x) * to_linear(target) / to_linear(MID_TONE))
        };
    }
    let c = f.contrast.clamp(-0.5, 0.5);
    if c != 0.0 {
        let slope = interpolate(&CONTRAST_CURVE, c);
        let pivot = if c > 0.0 { 100.0 } else { 112.0 } / 255.0;
        x = (x - pivot) * slope + pivot;
    }
    x
}

/// One straight sRGB color through every adjustment.
pub fn adjust(rgb: [f32; 3], f: &ImageFilters) -> [f32; 3] {
    color(rgb.map(|v| tone(v, f)), f)
}

/// The adjustments after the tone curve, on a toned color.
fn color(toned: [f32; 3], f: &ImageFilters) -> [f32; 3] {
    let mut c = toned;
    let luma = |c: &[f32; 3]| c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
    if f.highlights != 0.0 || f.shadows != 0.0 {
        let l = luma(&c).clamp(0.0, 1.0);
        let lift_high = l * l;
        let lift_low = ((SHADOW_RANGE - l) / SHADOW_RANGE).clamp(0.0, 1.0).powi(2);
        let d = f.highlights * HIGHLIGHTS * lift_high + f.shadows * SHADOWS * lift_low;
        c = c.map(|v| v + d);
    }
    for k in 0..3 {
        c[k] += f.tint * TINT[k] + f.temperature * TEMPERATURE[k];
    }
    if f.saturation != 0.0 {
        let l = luma(&c);
        let s = 1.0 + f.saturation.clamp(-1.0, 1.0);
        c = c.map(|v| l + (v - l) * s);
    }
    c.map(|v| v.clamp(0.0, 1.0))
}

/// Applies the adjustments to every pixel of a premultiplied pixmap.
pub fn apply(pixmap: &mut Pixmap, f: &ImageFilters) {
    if f.is_identity() {
        return;
    }
    // Per-channel tone of each 8-bit value (exposure and contrast).
    let lut: [f32; 256] = std::array::from_fn(|v| tone(v as f32 / 255.0, f));
    let only_tone = f.highlights == 0.0
        && f.shadows == 0.0
        && f.tint == 0.0
        && f.temperature == 0.0
        && f.saturation == 0.0;
    for px in pixmap.data_mut().chunks_exact_mut(4) {
        let a = px[3];
        if a == 0 {
            continue;
        }
        let af = f32::from(a) / 255.0;
        // Straight 8-bit values, the LUT's index.
        let straight = |v: u8| ((f32::from(v) / af).round().clamp(0.0, 255.0)) as usize;
        let rgb = [straight(px[0]), straight(px[1]), straight(px[2])];
        let out = if only_tone {
            rgb.map(|v| lut[v].clamp(0.0, 1.0))
        } else {
            color(rgb.map(|v| lut[v]), f)
        };
        for k in 0..3 {
            px[k] = (out[k] * af * 255.0 + 0.5) as u8;
        }
    }
}

#[cfg(test)]
mod test;
