//! Adjustment layer blocks: `brit`, `CgEd`, `levl`, `curv`, `expA`, `vibA`,
//! `hue2`, `blnc`, `blwh`, `phfl`, `mixr`, `nvrt`, `post`, `thrs`, `grdm`,
//! `selc`, and the ones kept without being drawn.
//!
//! Most are binary; Vibrance, Black & White, and the modern
//! Brightness/Contrast (`CgEd`) are descriptors. Photoshop writes an
//! adjustment's own block first; a `CgEd` after another adjustment's block
//! only names a preset. Encoders patch the original block in place where
//! its layout allows, so the bytes the model does not cover survive.

mod tone;

use crate::binary::{Reader, Writer};
use crate::codec::descriptor::{self, Descriptor, Value};
use crate::codec::paint::{self, color};
use crate::error::{PsdError, Result};
use crate::model::{Adjustment, HueRange, Rgb};

/// Every adjustment layer key: the drawn ones, then Color Lookup and HDR
/// Toning, which are kept as [`Adjustment::Other`].
const KEYS: [&[u8; 4]; 19] = [
    b"brit", b"CgEd", b"levl", b"curv", b"expA", b"vibA", b"hue ", b"hue2", b"blnc", b"blwh",
    b"phfl", b"mixr", b"nvrt", b"post", b"thrs", b"grdm", b"selc", b"clrL", b"hdrt",
];

/// Whether a block key is an adjustment layer's.
pub fn is_adjustment_key(key: &[u8; 4]) -> bool {
    KEYS.contains(&key)
}

/// Photoshop's six Hue/Saturation color ranges.
const HUE_RANGES: [[i16; 4]; 6] = [
    [315, 345, 15, 45],
    [15, 45, 75, 105],
    [75, 105, 135, 165],
    [135, 165, 195, 225],
    [195, 225, 255, 285],
    [255, 285, 315, 345],
];

/// Black & White's weights, by item.
const BLACK_WHITE_KEYS: [&str; 6] = ["Rd  ", "Yllw", "Grn ", "Cyn ", "Bl  ", "Mgnt"];

fn i16s<const N: usize>(r: &mut Reader<'_>) -> Result<[i16; N]> {
    let mut out = [0; N];
    for v in &mut out {
        *v = r.i16()?;
    }
    Ok(out)
}

/// Writes `values` as 16-bit integers at `at`.
fn patch_i16s(out: &mut [u8], at: usize, values: &[i16]) {
    for (i, v) in values.iter().enumerate() {
        if let Some(slot) = out.get_mut(at + 2 * i..at + 2 * i + 2) {
            slot.copy_from_slice(&v.to_be_bytes());
        }
    }
}

fn clamp_i16(v: f64) -> i16 {
    v.round().clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16
}

/// Reads an adjustment block. When a layer has both `brit` and `CgEd`,
/// pass `CgEd` (it holds the modern settings); a `CgEd` that only names
/// another adjustment's preset is an error. Unknown adjustment keys read as
/// [`Adjustment::Other`].
pub fn decode(key: &[u8; 4], data: &[u8]) -> Result<Adjustment> {
    let mut r = Reader::new(data);
    Ok(match key {
        b"brit" => Adjustment::BrightnessContrast {
            brightness: r.i16()?,
            contrast: r.i16()?,
            legacy: true,
        },
        b"CgEd" => {
            let (d, _) = descriptor::read_versioned(data)?;
            let (Some(brightness), Some(contrast)) = (d.number("Brgh"), d.number("Cntr")) else {
                return Err(PsdError::Unsupported(
                    "CgEd names another adjustment's preset".into(),
                ));
            };
            Adjustment::BrightnessContrast {
                brightness: clamp_i16(brightness),
                contrast: clamp_i16(contrast),
                legacy: d.bool("useLegacy").unwrap_or(false),
            }
        }
        b"levl" => tone::decode_levels(data)?,
        b"curv" => tone::decode_curves(data)?,
        b"expA" => {
            r.u16()?;
            Adjustment::Exposure {
                exposure: r.f32()?,
                offset: r.f32()?,
                gamma: r.f32()?,
            }
        }
        b"vibA" => {
            let (d, _) = descriptor::read_versioned(data)?;
            Adjustment::Vibrance {
                vibrance: clamp_i16(d.number("vibrance").unwrap_or(0.0)),
                saturation: clamp_i16(d.number("Strt").unwrap_or(0.0)),
            }
        }
        b"hue2" | b"hue " => {
            r.u16()?;
            let colorize = r.u8()? != 0;
            r.u8()?;
            let [h, s, l] = i16s(&mut r)?;
            let [mh, ms, ml] = i16s(&mut r)?;
            let mut ranges = Vec::with_capacity(6);
            for _ in 0..6 {
                let range = i16s(&mut r)?;
                let [hue, saturation, lightness] = i16s(&mut r)?;
                ranges.push(HueRange {
                    range,
                    hue,
                    saturation,
                    lightness,
                });
            }
            Adjustment::HueSaturation {
                colorize,
                colorization: (h, s, l),
                master: (mh, ms, ml),
                ranges,
            }
        }
        b"blnc" => Adjustment::ColorBalance {
            shadows: i16s(&mut r)?,
            midtones: i16s(&mut r)?,
            highlights: i16s(&mut r)?,
            preserve_luminosity: r.u8()? != 0,
        },
        b"blwh" => {
            let (d, _) = descriptor::read_versioned(data)?;
            let mut weights = [0; 6];
            for (w, key) in weights.iter_mut().zip(BLACK_WHITE_KEYS) {
                *w = clamp_i16(d.number(key).unwrap_or(0.0));
            }
            let tint = if d.bool("useTint") == Some(true) {
                Some(paint::color(&d, "tintColor").unwrap_or(Rgb::BLACK))
            } else {
                None
            };
            Adjustment::BlackWhite { weights, tint }
        }
        b"phfl" => {
            let version = r.u16()?;
            let color = match version {
                2 => color::read_binary(&mut r)?,
                3 => photo_filter_color(r.i32()?, r.i32()?, r.i32()?),
                _ => {
                    return Err(PsdError::Unsupported(format!(
                        "photo filter version {version}"
                    )));
                }
            };
            Adjustment::PhotoFilter {
                color,
                density: r.u32()? as f32 / 100.0,
                preserve_luminosity: r.u8()? != 0,
            }
        }
        b"mixr" => {
            r.u16()?;
            let monochrome = r.u16()? != 0;
            let mut rows = [[0; 4]; 3];
            for row in &mut rows {
                let [red, green, blue, _, constant] = i16s(&mut r)?;
                *row = [red, green, blue, constant];
            }
            Adjustment::ChannelMixer { monochrome, rows }
        }
        b"nvrt" => Adjustment::Invert,
        b"post" => Adjustment::Posterize {
            levels: r.u16()?.clamp(2, 255) as u8,
        },
        b"thrs" => Adjustment::Threshold {
            level: r.u16()?.clamp(1, 255) as u8,
        },
        b"grdm" => tone::decode_gradient_map(data)?,
        b"selc" => {
            r.u16()?;
            let absolute = r.u16()? != 0;
            r.skip(8)?;
            let mut colors = [[0; 4]; 9];
            for c in &mut colors {
                *c = i16s(&mut r)?;
            }
            Adjustment::SelectiveColor { absolute, colors }
        }
        _ => Adjustment::Other {
            key: String::from_utf8_lossy(key).into_owned(),
        },
    })
}

/// A version 3 Photo Filter color: L*a*b* × 100, or, when out of that
/// range, D50 XYZ in 16.16 fixed point.
fn photo_filter_color(a: i32, b: i32, c: i32) -> Rgb {
    if (0..=10_000).contains(&a) && b.abs() <= 12_800 && c.abs() <= 12_800 {
        color::lab_to_rgb(
            f64::from(a) / 100.0,
            f64::from(b) / 100.0,
            f64::from(c) / 100.0,
        )
    } else {
        let fixed = |v: i32| f64::from(v) / 65536.0;
        color::xyz_to_rgb(fixed(a), fixed(b), fixed(c))
    }
}

/// Writes an adjustment as blocks (key and data; Brightness/Contrast
/// writes both `brit` and `CgEd`), starting from the `original` blocks
/// when there are some. An unchanged adjustment gives back its original
/// blocks. Empty for [`Adjustment::Other`].
pub fn encode(adjustment: &Adjustment, original: &[([u8; 4], &[u8])]) -> Vec<([u8; 4], Vec<u8>)> {
    let find = |key: &[u8; 4]| original.iter().find(|(k, _)| k == key).map(|(_, d)| *d);
    let unchanged =
        |key: &[u8; 4], data: &[u8]| decode(key, data).ok().as_ref() == Some(adjustment);
    if let Adjustment::BrightnessContrast {
        brightness,
        contrast,
        legacy,
    } = *adjustment
    {
        let (brit, cged) = (find(b"brit"), find(b"CgEd"));
        let current = cged
            .filter(|d| decode(b"CgEd", d).is_ok())
            .map(|d| (b"CgEd", d));
        if let Some((key, data)) = current.or(brit.map(|d| (b"brit", d)))
            && unchanged(key, data)
        {
            let mut out: Vec<([u8; 4], Vec<u8>)> = Vec::new();
            out.extend(brit.map(|d| (*b"brit", d.to_vec())));
            out.extend(cged.map(|d| (*b"CgEd", descriptor_part(d))));
            return out;
        }
        return vec![
            (*b"brit", encode_brit(brightness, contrast, legacy, brit)),
            (*b"CgEd", encode_cged(brightness, contrast, legacy, cged)),
        ];
    }
    let Some(key) = key_of(adjustment) else {
        return Vec::new();
    };
    let original = find(&key);
    if let Some(data) = original
        && unchanged(&key, data)
    {
        let data = match &key {
            b"vibA" | b"blwh" => descriptor_part(data),
            _ => data.to_vec(),
        };
        return vec![(key, data)];
    }
    vec![(key, encode_changed(adjustment, original))]
}

/// A descriptor block's data without what follows the descriptor.
fn descriptor_part(data: &[u8]) -> Vec<u8> {
    match descriptor::read_versioned(data) {
        Ok((_, used)) => data[..used].to_vec(),
        Err(_) => data.to_vec(),
    }
}

/// The block key an adjustment is written to (none for `Other`).
fn key_of(adjustment: &Adjustment) -> Option<[u8; 4]> {
    Some(*match adjustment {
        Adjustment::BrightnessContrast { .. } => b"CgEd",
        Adjustment::Levels { .. } => b"levl",
        Adjustment::Curves { .. } => b"curv",
        Adjustment::Exposure { .. } => b"expA",
        Adjustment::Vibrance { .. } => b"vibA",
        Adjustment::HueSaturation { .. } => b"hue2",
        Adjustment::ColorBalance { .. } => b"blnc",
        Adjustment::BlackWhite { .. } => b"blwh",
        Adjustment::PhotoFilter { .. } => b"phfl",
        Adjustment::ChannelMixer { .. } => b"mixr",
        Adjustment::Invert => b"nvrt",
        Adjustment::Posterize { .. } => b"post",
        Adjustment::Threshold { .. } => b"thrs",
        Adjustment::GradientMap { .. } => b"grdm",
        Adjustment::SelectiveColor { .. } => b"selc",
        Adjustment::Other { .. } => return None,
    })
}

/// `brit`: the values when legacy (Photoshop zeroes them otherwise).
fn encode_brit(brightness: i16, contrast: i16, legacy: bool, original: Option<&[u8]>) -> Vec<u8> {
    let mut out = match original {
        Some(o) if o.len() >= 8 => o.to_vec(),
        _ => vec![0, 0, 0, 0, 0, 127, 0, 0],
    };
    if legacy {
        patch_i16s(&mut out, 0, &[brightness, contrast]);
    } else {
        out[..8].fill(0);
    }
    out
}

/// `CgEd`: the modern Brightness/Contrast descriptor.
fn encode_cged(brightness: i16, contrast: i16, legacy: bool, original: Option<&[u8]>) -> Vec<u8> {
    let original = original
        .and_then(|o| descriptor::read_versioned(o).ok())
        .map(|(d, _)| d)
        .filter(|d| d.has("Brgh"));
    let mut d = original.unwrap_or_else(|| {
        Descriptor::new("null")
            .with("Vrsn", Value::Integer(1))
            .with("Brgh", Value::Integer(0))
            .with("Cntr", Value::Integer(0))
            .with("means", Value::Integer(127))
            .with("Lab ", Value::Bool(false))
            .with("useLegacy", Value::Bool(false))
            .with("Auto", Value::Bool(false))
    });
    let mut put = |key: &str, v: i16| {
        if d.number(key) != Some(f64::from(v)) {
            d.set(key, Value::Integer(i32::from(v)));
        }
    };
    put("Brgh", brightness);
    put("Cntr", contrast);
    paint::put_bool(&mut d, "useLegacy", legacy);
    descriptor::write_versioned(&d)
}

/// An `original` block to patch when it has at least `len` bytes and
/// starts with `prefix`, else `fresh`.
fn start_from(original: Option<&[u8]>, len: usize, prefix: &[u8], fresh: Vec<u8>) -> Vec<u8> {
    match original {
        Some(o) if o.len() >= len && o.starts_with(prefix) => o.to_vec(),
        _ => fresh,
    }
}

/// Writes a changed adjustment, patching the original where its layout
/// allows.
fn encode_changed(adjustment: &Adjustment, original: Option<&[u8]>) -> Vec<u8> {
    match adjustment {
        Adjustment::Levels { channels } => tone::encode_levels(channels, original),
        Adjustment::Curves { channels } => tone::encode_curves(channels),
        Adjustment::GradientMap {
            gradient,
            dither,
            reverse,
        } => tone::encode_gradient_map(gradient, *dither, *reverse, original),
        Adjustment::Exposure {
            exposure,
            offset,
            gamma,
        } => {
            let mut out = start_from(
                original,
                14,
                &[0, 1],
                vec![0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            );
            for (i, v) in [exposure, offset, gamma].into_iter().enumerate() {
                out[2 + 4 * i..6 + 4 * i].copy_from_slice(&v.to_be_bytes());
            }
            out
        }
        Adjustment::Vibrance {
            vibrance,
            saturation,
        } => {
            let mut d = original
                .and_then(|o| descriptor::read_versioned(o).ok())
                .map_or_else(|| Descriptor::new("null"), |(d, _)| d);
            for (key, v) in [("vibrance", vibrance), ("Strt", saturation)] {
                if d.number(key) != Some(f64::from(*v)) {
                    d.set(key, Value::Integer(i32::from(*v)));
                }
            }
            descriptor::write_versioned(&d)
        }
        Adjustment::HueSaturation {
            colorize,
            colorization,
            master,
            ranges,
        } => {
            let mut out = start_from(original, 100, &[], {
                let mut w = Writer::new();
                w.u16(2);
                w.zeros(98);
                w.into_bytes()
            });
            out[0..2].copy_from_slice(&2u16.to_be_bytes());
            out[2] = u8::from(*colorize);
            patch_i16s(
                &mut out,
                4,
                &[colorization.0, colorization.1, colorization.2],
            );
            patch_i16s(&mut out, 10, &[master.0, master.1, master.2]);
            for (i, default) in HUE_RANGES.iter().enumerate() {
                let r = ranges.get(i).copied().unwrap_or(HueRange {
                    range: *default,
                    hue: 0,
                    saturation: 0,
                    lightness: 0,
                });
                let at = 16 + 14 * i;
                patch_i16s(&mut out, at, &r.range);
                patch_i16s(&mut out, at + 8, &[r.hue, r.saturation, r.lightness]);
            }
            out
        }
        Adjustment::ColorBalance {
            shadows,
            midtones,
            highlights,
            preserve_luminosity,
        } => {
            let mut out = start_from(original, 19, &[], vec![0; 20]);
            patch_i16s(&mut out, 0, shadows);
            patch_i16s(&mut out, 6, midtones);
            patch_i16s(&mut out, 12, highlights);
            out[18] = u8::from(*preserve_luminosity);
            out
        }
        Adjustment::BlackWhite { weights, tint } => encode_black_white(weights, *tint, original),
        Adjustment::PhotoFilter {
            color,
            density,
            preserve_luminosity,
        } => {
            let density = (f64::from(*density) * 100.0).round().clamp(0.0, 100.0) as u32;
            let same_color = original.and_then(|o| decode(b"phfl", o).ok()).is_some_and(
                |a| matches!(a, Adjustment::PhotoFilter { color: c, .. } if c == *color),
            );
            let mut out = match original {
                Some(o) if same_color => o.to_vec(),
                _ => {
                    let mut w = Writer::new();
                    w.u16(2);
                    color::write_binary(&mut w, *color);
                    w.zeros(8);
                    w.into_bytes()
                }
            };
            let at = if out.starts_with(&[0, 3]) { 14 } else { 12 };
            if let Some(slot) = out.get_mut(at..at + 5) {
                slot[..4].copy_from_slice(&density.to_be_bytes());
                slot[4] = u8::from(*preserve_luminosity);
            }
            out
        }
        Adjustment::ChannelMixer { monochrome, rows } => {
            let mut out = start_from(original, 44, &[0, 1], {
                let mut w = Writer::new();
                w.u16(1);
                w.zeros(42);
                w.into_bytes()
            });
            out[2..4].copy_from_slice(&u16::from(*monochrome).to_be_bytes());
            for (i, row) in rows.iter().enumerate() {
                let at = 4 + 10 * i;
                patch_i16s(&mut out, at, &row[..3]);
                patch_i16s(&mut out, at + 8, &[row[3]]);
            }
            out
        }
        Adjustment::Invert => Vec::new(),
        Adjustment::Posterize { levels } => small_value(u16::from(*levels), original),
        Adjustment::Threshold { level } => small_value(u16::from(*level), original),
        Adjustment::SelectiveColor { absolute, colors } => {
            let mut out = start_from(original, 84, &[0, 1], {
                let mut w = Writer::new();
                w.u16(1);
                w.zeros(82);
                w.into_bytes()
            });
            out[2..4].copy_from_slice(&u16::from(*absolute).to_be_bytes());
            for (i, c) in colors.iter().enumerate() {
                patch_i16s(&mut out, 12 + 8 * i, c);
            }
            out
        }
        Adjustment::BrightnessContrast { .. } | Adjustment::Other { .. } => Vec::new(),
    }
}

/// `post` and `thrs`: one 16-bit value and two bytes of padding.
fn small_value(v: u16, original: Option<&[u8]>) -> Vec<u8> {
    let mut out = start_from(original, 2, &[], vec![0; 4]);
    out[..2].copy_from_slice(&v.to_be_bytes());
    out
}

fn encode_black_white(weights: &[i16; 6], tint: Option<Rgb>, original: Option<&[u8]>) -> Vec<u8> {
    let mut d = original
        .and_then(|o| descriptor::read_versioned(o).ok())
        .map_or_else(
            || {
                let mut d = Descriptor::new("null");
                for key in BLACK_WHITE_KEYS {
                    d.items.push((key.into(), Value::Integer(0)));
                }
                d.with("useTint", Value::Bool(false))
                    .with(
                        "tintColor",
                        Value::Descriptor(color::to_descriptor(Rgb::from_u8(225, 211, 179))),
                    )
                    .with("bwPresetKind", Value::Integer(1))
                    .with("blackAndWhitePresetFileName", Value::Text(String::new()))
            },
            |(d, _)| d,
        );
    for (key, w) in BLACK_WHITE_KEYS.iter().zip(weights) {
        if d.number(key) != Some(f64::from(*w)) {
            d.set(*key, Value::Integer(i32::from(*w)));
        }
    }
    paint::put_bool(&mut d, "useTint", tint.is_some());
    if let Some(tint) = tint {
        paint::put_color(&mut d, "tintColor", tint);
    }
    descriptor::write_versioned(&d)
}

#[cfg(test)]
mod test;
