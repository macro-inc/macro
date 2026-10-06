//! The tonal adjustments' binary blocks: Levels (`levl`), Curves (`curv`),
//! and Gradient Map (`grdm`).

use crate::binary::{Reader, Writer};
use crate::codec::paint::{self, color};
use crate::error::{PsdError, Result};
use crate::model::{Adjustment, ColorStop, Gradient, GradientMethod, LevelsChannel, OpacityStop};

/// Levels records Photoshop writes before the extra ones.
const LEVELS_RECORDS: usize = 29;
/// Bytes per Levels record.
const LEVELS_RECORD: usize = 10;
/// Gradient locations and smoothness run `0..=4096`.
const SCALE: f64 = 4096.0;

/// Reads `levl`: version 2, then records of input black, input white,
/// output black, output white, and gamma × 100 (the composite first).
pub(super) fn decode_levels(data: &[u8]) -> Result<Adjustment> {
    let mut r = Reader::new(data);
    let version = r.u16()?;
    if version != 2 {
        return Err(PsdError::Unsupported(format!("levels version {version}")));
    }
    let level = |v: i16| v.clamp(0, 255) as u8;
    let mut channels = Vec::new();
    for _ in 0..4 {
        if r.remaining() < LEVELS_RECORD {
            break;
        }
        channels.push(LevelsChannel {
            in_black: level(r.i16()?),
            in_white: level(r.i16()?),
            out_black: level(r.i16()?),
            out_white: level(r.i16()?),
            gamma: f32::from(r.i16()?) / 100.0,
        });
    }
    Ok(Adjustment::Levels { channels })
}

/// Writes `levl`: the model's channels over the `original`'s first
/// records, keeping the rest.
pub(super) fn encode_levels(channels: &[LevelsChannel], original: Option<&[u8]>) -> Vec<u8> {
    let needed = 2 + LEVELS_RECORD * channels.len().min(LEVELS_RECORDS);
    let mut out = match original {
        Some(o) if o.len() >= needed && o.starts_with(&[0, 2]) => o.to_vec(),
        _ => {
            let mut w = Writer::new();
            w.u16(2);
            for _ in 0..LEVELS_RECORDS {
                for v in [0, 255, 0, 255, 100] {
                    w.i16(v);
                }
            }
            w.into_bytes()
        }
    };
    for (i, c) in channels.iter().take(LEVELS_RECORDS).enumerate() {
        let gamma = (f64::from(c.gamma) * 100.0).round().clamp(1.0, 999.0) as i16;
        let values = [
            i16::from(c.in_black),
            i16::from(c.in_white),
            i16::from(c.out_black),
            i16::from(c.out_white),
            gamma,
        ];
        let at = 2 + LEVELS_RECORD * i;
        for (k, v) in values.into_iter().enumerate() {
            out[at + 2 * k..at + 2 * k + 2].copy_from_slice(&v.to_be_bytes());
        }
    }
    out
}

/// One curve: a 256-entry map, or points stored (output, input).
fn read_curve(r: &mut Reader<'_>, is_map: bool) -> Result<Vec<(u8, u8)>> {
    if is_map {
        let map = r.bytes(256)?;
        return Ok((0..=255u8).zip(map.iter().copied()).collect());
    }
    let count = usize::from(r.u16()?);
    if count > r.remaining() / 4 {
        return Err(PsdError::corrupt("curve point count out of range"));
    }
    let level = |v: u16| v.min(255) as u8;
    let mut points = Vec::with_capacity(count);
    for _ in 0..count {
        let output = level(r.u16()?);
        let input = level(r.u16()?);
        points.push((input, output));
    }
    Ok(points)
}

/// Reads `curv`: whether curves are maps, version 1 (a bitmap of
/// channels) or 4 (a count of channel-indexed curves), the curves, then in
/// newer files `Crv `, which lists every channel's curve again and wins.
pub(super) fn decode_curves(data: &[u8]) -> Result<Adjustment> {
    let mut r = Reader::new(data);
    let is_map = r.u8()? != 0;
    let version = r.u16()?;
    let n = r.u32()?;
    let mut channels = Vec::new();
    match version {
        1 => {
            for bit in 0..32u8 {
                if n & (1 << bit) != 0 {
                    channels.push((bit, read_curve(&mut r, is_map)?));
                }
            }
        }
        4 => {
            for _ in 0..n.min(256) {
                let id = r.u16()?;
                let curve = read_curve(&mut r, is_map)?;
                if let Ok(id) = u8::try_from(id) {
                    channels.push((id, curve));
                }
            }
        }
        _ => return Err(PsdError::Unsupported(format!("curves version {version}"))),
    }
    if r.peek(4) == Some(b"Crv ") {
        r.skip(4)?;
        r.u16()?;
        let count = r.u32()?.min(256);
        let mut extra = Vec::new();
        for _ in 0..count {
            let id = r.u16()?;
            let curve = read_curve(&mut r, is_map)?;
            if let Ok(id) = u8::try_from(id) {
                extra.push((id, curve));
            }
        }
        channels = extra;
    }
    Ok(Adjustment::Curves { channels })
}

fn write_curve(w: &mut Writer, points: &[(u8, u8)]) {
    w.u16(points.len().min(usize::from(u16::MAX)) as u16);
    for &(input, output) in points {
        w.u16(u16::from(output));
        w.u16(u16::from(input));
    }
}

/// Writes `curv`: version 1 with a channel bitmap, then `Crv ` version 4
/// with every channel, padded to four bytes as Photoshop writes it.
pub(super) fn encode_curves(channels: &[(u8, Vec<(u8, u8)>)]) -> Vec<u8> {
    let mut w = Writer::new();
    w.u8(0);
    w.u16(1);
    let mut bitmap = 0u32;
    for (id, _) in channels {
        if *id < 32 {
            bitmap |= 1 << id;
        }
    }
    w.u32(bitmap);
    for bit in 0..32u8 {
        if let Some((_, points)) = channels.iter().find(|(id, _)| *id == bit) {
            write_curve(&mut w, points);
        }
    }
    w.sig(b"Crv ");
    w.u16(4);
    w.u32(channels.len() as u32);
    for (id, points) in channels {
        w.u16(u16::from(*id));
        write_curve(&mut w, points);
    }
    w.pad_from(0, 4);
    w.into_bytes()
}

/// The noise color models by `grdm` id.
fn noise_model(id: u16) -> &'static str {
    match id {
        4 => "HSBl",
        6 => "LbCl",
        _ => "RGBC",
    }
}

/// Reads `grdm`: version 1 or 3 (with an interpolation method), reverse,
/// dither, the gradient's name and stops (locations `0..=4096`, colors as
/// the binary color structure, opacities `0..=255`), then its smoothness
/// and noise settings. Noise gradients are approximated by stops.
pub(super) fn decode_gradient_map(data: &[u8]) -> Result<Adjustment> {
    let mut r = Reader::new(data);
    let version = r.u16()?;
    if version != 1 && version != 3 {
        return Err(PsdError::Unsupported(format!(
            "gradient map version {version}"
        )));
    }
    let reverse = r.u8()? != 0;
    let dither = r.u8()? != 0;
    let method = match version {
        3 => method_of_sig(&r.sig()?),
        _ => GradientMethod::Classic,
    };
    let mut gradient = Gradient {
        name: r.unicode()?,
        method,
        ..Gradient::default()
    };
    let count = usize::from(r.u16()?);
    let mut colors = Vec::with_capacity(count.min(r.remaining() / 20));
    for _ in 0..count {
        let location = r.u32()?;
        let midpoint = r.u32()?;
        let color = color::read_binary(&mut r)?;
        r.u16()?;
        colors.push((location, midpoint, color));
    }
    let count = usize::from(r.u16()?);
    let mut opacities = Vec::with_capacity(count.min(r.remaining() / 10));
    for _ in 0..count {
        opacities.push((r.u32()?, r.u32()?, r.u16()?));
    }
    r.u16()?; // expansion count (2)
    let smoothness = r.u16()?;
    r.u16()?; // length (32)
    let noise = r.u16()? == 1;
    let seed = r.u32()?;
    let transparent = r.u16()? != 0;
    r.u16()?; // restrict colors
    let roughness = r.u32()?;
    let model = r.u16()?;
    let mut range = [[0.0; 4]; 2];
    for bound in &mut range {
        for v in bound.iter_mut() {
            *v = f64::from(r.u16()?) / 32768.0;
        }
    }
    gradient.smoothness = (f64::from(smoothness) / SCALE).clamp(0.0, 1.0) as f32;
    if noise {
        let settings = paint::Noise {
            seed: u64::from(seed),
            roughness: f64::from(roughness) / SCALE,
            model: noise_model(model),
            min: range[0],
            max: range[1],
            transparent,
        };
        paint::noise_stops(&settings, &mut gradient);
    } else {
        let location = |v: u32| (f64::from(v) / SCALE) as f32;
        let midpoint = |v: u32| (f64::from(v) / 100.0) as f32;
        gradient.colors = colors
            .into_iter()
            .map(|(l, m, color)| ColorStop {
                location: location(l),
                midpoint: midpoint(m),
                color,
            })
            .collect();
        gradient.opacities = opacities
            .into_iter()
            .map(|(l, m, o)| OpacityStop {
                location: location(l),
                midpoint: midpoint(m),
                opacity: f32::from(o) / 255.0,
            })
            .collect();
    }
    Ok(Adjustment::GradientMap {
        gradient,
        dither,
        reverse,
    })
}

/// The interpolation method a `grdm` signature names (classic when the
/// engine doesn't know it).
fn method_of_sig(sig: &[u8]) -> GradientMethod {
    std::str::from_utf8(sig)
        .ok()
        .and_then(paint::method_of)
        .unwrap_or_default()
}

/// Writes `grdm` with the gradient's stops (its `reverse` and `dither`
/// are the adjustment's) and interpolation method: version 3 with the
/// method when the `original` was or the method isn't classic, keeping
/// the original's method when it reads as the gradient's (one the engine
/// doesn't know reads as classic).
pub(super) fn encode_gradient_map(
    gradient: &Gradient,
    dither: bool,
    reverse: bool,
    original: Option<&[u8]>,
) -> Vec<u8> {
    let stored = original
        .filter(|o| o.starts_with(&[0, 3]))
        .and_then(|o| o.get(4..8));
    let method = match stored {
        Some(sig) if method_of_sig(sig) == gradient.method => Some(sig.to_vec()),
        None if gradient.method == GradientMethod::Classic => None,
        _ => Some(paint::method_id(gradient.method).as_bytes().to_vec()),
    };
    let mut w = Writer::new();
    w.u16(if method.is_some() { 3 } else { 1 });
    w.u8(u8::from(reverse));
    w.u8(u8::from(dither));
    if let Some(method) = &method {
        w.bytes(method);
    }
    w.unicode_nul(&gradient.name);
    let scaled = |v: f32, scale: f64| (f64::from(v) * scale).round().max(0.0) as u32;
    w.u16(gradient.colors.len().min(usize::from(u16::MAX)) as u16);
    for s in &gradient.colors {
        w.u32(scaled(s.location, SCALE));
        w.u32(scaled(s.midpoint, 100.0));
        color::write_binary(&mut w, s.color);
        w.u16(0);
    }
    w.u16(gradient.opacities.len().min(usize::from(u16::MAX)) as u16);
    for s in &gradient.opacities {
        w.u32(scaled(s.location, SCALE));
        w.u32(scaled(s.midpoint, 100.0));
        w.u16(scaled(s.opacity, 255.0).min(255) as u16);
    }
    w.u16(2);
    w.u16(scaled(gradient.smoothness, SCALE).min(4096) as u16);
    w.u16(32);
    w.u16(0);
    w.u32(0);
    w.u16(0);
    w.u16(0);
    w.u32(2048);
    w.u16(3);
    for v in [0, 0, 0, 0, 0x8000, 0x8000, 0x8000, 0x8000] {
        w.u16(v);
    }
    w.u16(0);
    w.pad_from(0, 4);
    w.into_bytes()
}
