//! Converting a file's samples (any color mode and depth) to the engine's
//! 8-bit straight RGBA, and RGBA back to an RGB or grayscale file's samples.
//!
//! CMYK samples are stored inverted (255 is no ink); Lab is converted
//! through D50 XYZ to sRGB; 16-bit samples span `0..=65535`; 32-bit samples
//! are linear floats, encoded with the sRGB curve; bitmap samples are
//! packed bits with 1 for black; indexed samples look up the palette (the
//! color mode data: 256 reds, then greens, then blues). Duotone and
//! multichannel samples show as gray. Samples missing from short planes
//! read as zero.

use crate::channels::row_bytes;
use crate::model::ColorMode;
use std::sync::OnceLock;

/// Straight RGBA8 for `width × height` pixels (none when that many do not
/// fit in memory): `color` holds the mode's color channels in file order
/// (raw samples at `depth`), `alpha` the transparency channel (opaque when
/// absent), `palette` an indexed file's color mode data.
pub fn to_rgba(
    mode: ColorMode,
    depth: u16,
    width: u32,
    height: u32,
    color: &[&[u8]],
    alpha: Option<&[u8]>,
    palette: &[u8],
) -> Vec<u8> {
    let n = pixels(width, height);
    let mut out = vec![0; n.checked_mul(4).unwrap_or(0)];
    let plane = |c: usize| color.get(c).copied().unwrap_or_default();
    match (mode, depth) {
        (_, 1) => bitmap(&mut out, plane(0), width),
        (ColorMode::Rgb, 8) if (0..3).all(|c| plane(c).len() >= n) => {
            let (r, g, b) = (&plane(0)[..n], &plane(1)[..n], &plane(2)[..n]);
            for (i, px) in out.chunks_exact_mut(4).enumerate() {
                px[..3].copy_from_slice(&[r[i], g[i], b[i]]);
            }
        }
        (ColorMode::Rgb, _) => {
            for (i, px) in out.chunks_exact_mut(4).enumerate() {
                for (c, v) in px[..3].iter_mut().enumerate() {
                    *v = value(plane(c), i, depth);
                }
            }
        }
        (ColorMode::Cmyk, _) => {
            for (i, px) in out.chunks_exact_mut(4).enumerate() {
                let k = u32::from(value(plane(3), i, depth));
                for (c, v) in px[..3].iter_mut().enumerate() {
                    *v = ((u32::from(value(plane(c), i, depth)) * k + 127) / 255) as u8;
                }
            }
        }
        (ColorMode::Lab, _) => {
            for (i, px) in out.chunks_exact_mut(4).enumerate() {
                let lab = [0, 1, 2].map(|c| unit(plane(c), i, depth));
                px[..3].copy_from_slice(&lab_to_srgb(lab, depth));
            }
        }
        (ColorMode::Indexed, _) => {
            let entry = |at: usize| palette.get(at).copied().unwrap_or(0);
            for (i, px) in out.chunks_exact_mut(4).enumerate() {
                let index = usize::from(value(plane(0), i, depth));
                px[..3].copy_from_slice(&[entry(index), entry(256 + index), entry(512 + index)]);
            }
        }
        (
            ColorMode::Grayscale | ColorMode::Duotone | ColorMode::Multichannel | ColorMode::Bitmap,
            _,
        ) => {
            let gray = plane(0);
            for (i, px) in out.chunks_exact_mut(4).enumerate() {
                px[..3].fill(value(gray, i, depth));
            }
        }
    }
    match alpha {
        Some(a) if depth == 8 && a.len() >= n => {
            for (px, &a) in out.chunks_exact_mut(4).zip(a) {
                px[3] = a;
            }
        }
        Some(a) => {
            let a = to_gray(depth, width, height, a);
            for (px, a) in out.chunks_exact_mut(4).zip(a) {
                px[3] = a;
            }
        }
        None => {
            for px in out.chunks_exact_mut(4) {
                px[3] = 255;
            }
        }
    }
    out
}

/// 8-bit samples of one channel stored at `depth` (masks, alpha channels:
/// 32-bit values are coverage, so no curve applies).
pub fn to_gray(depth: u16, width: u32, height: u32, samples: &[u8]) -> Vec<u8> {
    let n = pixels(width, height);
    match depth {
        1 => {
            let mut rgba = vec![0; n.checked_mul(4).unwrap_or(0)];
            bitmap(&mut rgba, samples, width);
            rgba.chunks_exact(4).map(|px| px[0]).collect()
        }
        8 => {
            let mut out = samples[..n.min(samples.len())].to_vec();
            out.resize(n, 0);
            out
        }
        32 => (0..n).map(|i| coverage(float(samples, i))).collect(),
        _ => (0..n).map(|i| value(samples, i, depth)).collect(),
    }
}

/// An RGB or grayscale file's samples at `depth` for RGBA8 pixels: the
/// mode's color channels, then transparency. Grayscale (and the other
/// one-channel modes) gets Rec. 601 luma; every other mode gets RGB.
pub fn from_rgba(
    mode: ColorMode,
    depth: u16,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Vec<Vec<u8>> {
    let n = pixels(width, height);
    let px = |i: usize| -> [u8; 4] {
        rgba.get(i * 4..i * 4 + 4)
            .map_or([0; 4], |p| [p[0], p[1], p[2], p[3]])
    };
    let gray = mode.color_channels() == 1;
    let channels: Vec<Vec<u8>> = if gray {
        let luma = (0..n)
            .map(|i| {
                let [r, g, b, _] = px(i).map(u32::from);
                ((299 * r + 587 * g + 114 * b + 500) / 1000) as u8
            })
            .collect();
        vec![luma, (0..n).map(|i| px(i)[3]).collect()]
    } else {
        (0..4).map(|c| (0..n).map(|i| px(i)[c]).collect()).collect()
    };
    let last = channels.len() - 1;
    channels
        .into_iter()
        .enumerate()
        .map(|(c, values)| samples(depth, width, &values, c != last))
        .collect()
}

/// Samples at `depth` for 8-bit gray samples (masks and alpha: 32-bit
/// values are coverage, without a curve).
pub fn from_gray(depth: u16, width: u32, height: u32, gray: &[u8]) -> Vec<u8> {
    let n = pixels(width, height);
    let mut values = gray[..n.min(gray.len())].to_vec();
    values.resize(n, 0);
    samples(depth, width, &values, false)
}

/// Pixels in a `width × height` image.
fn pixels(width: u32, height: u32) -> usize {
    (width as usize).saturating_mul(height as usize)
}

/// Sample `i` of a color plane as 8 bits (32-bit samples through the sRGB
/// curve).
fn value(plane: &[u8], i: usize, depth: u16) -> u8 {
    match depth {
        8 => plane.get(i).copied().unwrap_or(0),
        16 => narrow(u16_at(plane, i)),
        32 => srgb_encode(float(plane, i)),
        _ => 0,
    }
}

/// Sample `i` of a plane in `0..=1` (32-bit samples as stored).
fn unit(plane: &[u8], i: usize, depth: u16) -> f32 {
    match depth {
        8 => f32::from(plane.get(i).copied().unwrap_or(0)) / 255.0,
        16 => f32::from(u16_at(plane, i)) / 65535.0,
        32 => float(plane, i),
        _ => 0.0,
    }
}

fn u16_at(plane: &[u8], i: usize) -> u16 {
    plane
        .get(i * 2..i * 2 + 2)
        .map_or(0, |b| u16::from_be_bytes([b[0], b[1]]))
}

fn float(plane: &[u8], i: usize) -> f32 {
    plane
        .get(i * 4..i * 4 + 4)
        .map_or(0.0, |b| f32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// A 16-bit sample rounded to 8 bits.
fn narrow(v: u16) -> u8 {
    ((u32::from(v) * 255 + 32767) / 65535) as u8
}

/// Coverage in `0..=1` as 8 bits.
fn coverage(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// Unpacks bitmap rows (1 is black) into gray RGB.
fn bitmap(out: &mut [u8], plane: &[u8], width: u32) {
    let row = row_bytes(width, 1);
    let width = width as usize;
    if width == 0 {
        return;
    }
    for (i, px) in out.chunks_exact_mut(4).enumerate() {
        let (y, x) = (i / width, i % width);
        let byte = plane.get(y * row + x / 8).copied().unwrap_or(0);
        let ink = byte >> (7 - x % 8) & 1 == 1;
        px[..3].fill(if ink { 0 } else { 255 });
    }
}

/// Samples at `depth` for 8-bit values; `color` values are sRGB-encoded,
/// the rest (alpha, masks) coverage.
fn samples(depth: u16, width: u32, values: &[u8], color: bool) -> Vec<u8> {
    match depth {
        1 => {
            let width = width as usize;
            let row = row_bytes(width as u32, 1);
            let rows = if width == 0 {
                0
            } else {
                values.len().div_ceil(width)
            };
            let mut out = vec![0; row * rows];
            for (i, &v) in values.iter().enumerate() {
                if v < 128 {
                    let (y, x) = (i / width, i % width);
                    out[y * row + x / 8] |= 0x80 >> (x % 8);
                }
            }
            out
        }
        16 => values
            .iter()
            .flat_map(|&v| (u16::from(v) * 257).to_be_bytes())
            .collect(),
        32 => values
            .iter()
            .flat_map(|&v| {
                let f = if color {
                    srgb_decode_table()[usize::from(v)]
                } else {
                    f32::from(v) / 255.0
                };
                f.to_be_bytes()
            })
            .collect(),
        _ => values.to_vec(),
    }
}

/// Linear light for each 8-bit sRGB value.
fn srgb_decode_table() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| std::array::from_fn(|v| srgb_decode(v as f32 / 255.0)))
}

/// The linear values where the encoded 8-bit value steps up: value `v`
/// covers linear light below entry `v`.
fn srgb_steps() -> &'static [f32; 255] {
    static STEPS: OnceLock<[f32; 255]> = OnceLock::new();
    STEPS.get_or_init(|| std::array::from_fn(|v| srgb_decode((v as f32 + 0.5) / 255.0)))
}

fn srgb_decode(v: f32) -> f32 {
    if v <= 0.040_45 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear light as 8-bit sRGB, rounded to the nearest value.
fn srgb_encode(linear: f32) -> u8 {
    if linear.is_nan() {
        return 0;
    }
    srgb_steps().partition_point(|&step| step <= linear) as u8
}

/// CIE L*a*b* samples (`0..=1` as stored) as 8-bit sRGB: through D50 XYZ
/// and the Bradford-adapted sRGB matrix.
fn lab_to_srgb([l, a, b]: [f32; 3], depth: u16) -> [u8; 3] {
    let l = l * 100.0;
    // a* and b* are offset by 128 at 8 bits, by 32768 (of 65535) at 16.
    let (a, b) = match depth {
        16 => (
            (a * 65535.0 - 32768.0) / 256.0,
            (b * 65535.0 - 32768.0) / 256.0,
        ),
        _ => (a * 255.0 - 128.0, b * 255.0 - 128.0),
    };
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let inverse = |t: f32| {
        const DELTA: f32 = 6.0 / 29.0;
        if t > DELTA {
            t * t * t
        } else {
            3.0 * DELTA * DELTA * (t - 4.0 / 29.0)
        }
    };
    let (x, y, z) = (0.964_22 * inverse(fx), inverse(fy), 0.825_21 * inverse(fz));
    let r = 3.133_856 * x - 1.616_867 * y - 0.490_615 * z;
    let g = -0.978_768 * x + 1.916_142 * y + 0.033_454 * z;
    let b = 0.071_945 * x - 0.228_991 * y + 1.405_243 * z;
    [r, g, b].map(srgb_encode)
}

#[cfg(test)]
mod test;
