//! Document patterns (`Patt`, `Pat2`, `Pat3`): each pattern's id, name,
//! and pixels (virtual memory array lists), converted to RGBA.
//!
//! The block is a run of patterns, each its length (padded to four bytes)
//! then: version 1, the image mode, the size, the Unicode name, the Pascal
//! id, an indexed pattern's palette, and a virtual memory array list (the
//! bounds, then one array per channel plus a user and a sheet mask, each
//! with its depth, bounds, and compression: raw, PackBits, or zip with or
//! without prediction).

use crate::binary::{Reader, mac_roman};
use crate::codec::paint::color;
use crate::error::{PsdError, Result};
use crate::model::{ColorMode, Pattern};
use std::sync::Arc;

/// The most pixels one pattern may have.
const MAX_PIXELS: u64 = 1 << 26;
/// The most channels a pattern may list.
const MAX_CHANNELS: u32 = 64;

/// Reads the patterns of a document-level pattern block. `large` is set
/// for large documents (`.psb`), whose PackBits row counts may be 32-bit.
/// Patterns whose pixels cannot be read are left out.
pub fn decode(data: &[u8], large: bool) -> Result<Vec<Pattern>> {
    let mut r = Reader::new(data);
    let mut out = Vec::new();
    while r.remaining() >= 4 {
        let n = r.u32()? as usize;
        if n == 0 {
            continue;
        }
        let body = r.bytes(n)?;
        let pad = (4 - n % 4) % 4;
        r.skip(pad.min(r.remaining()))?;
        if let Ok(pattern) = read_pattern(body, large) {
            out.push(pattern);
        }
    }
    Ok(out)
}

/// One channel's array.
struct Array<'a> {
    depth: u16,
    /// Top, left, bottom, right.
    rect: [u32; 4],
    compression: u8,
    data: &'a [u8],
}

fn read_pattern(body: &[u8], large: bool) -> Result<Pattern> {
    let mut r = Reader::new(body);
    let version = r.u32()?;
    if version != 1 {
        return Err(PsdError::Unsupported(format!("pattern version {version}")));
    }
    let mode = ColorMode::from_code(r.u32()?.min(u32::from(u16::MAX)) as u16)
        .ok_or_else(|| PsdError::Unsupported("pattern color mode".into()))?;
    r.skip(4)?; // the size, which the arrays' bounds give again
    let name = r.unicode()?;
    let id = mac_roman(r.pascal(1)?);
    let palette = if mode == ColorMode::Indexed {
        let p = r.bytes(768)?.to_vec();
        r.skip(4)?;
        p
    } else {
        Vec::new()
    };
    let list_version = r.u32()?;
    if list_version != 3 {
        return Err(PsdError::Unsupported(format!(
            "pattern array list version {list_version}"
        )));
    }
    let n = r.u32()? as usize;
    let mut list = r.take(n.min(r.remaining()))?;
    let rect = [list.u32()?, list.u32()?, list.u32()?, list.u32()?];
    let width = rect[3].saturating_sub(rect[1]);
    let height = rect[2].saturating_sub(rect[0]);
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(PsdError::TooLarge(
            (u64::from(width) * u64::from(height) * 4) >> 20,
        ));
    }
    let channels = list.u32()?;
    if channels > MAX_CHANNELS {
        return Err(PsdError::corrupt("pattern channel count out of range"));
    }
    let mut arrays = Vec::new();
    for _ in 0..channels + 2 {
        if list.is_empty() {
            break;
        }
        if list.u32()? == 0 {
            arrays.push(None);
            continue;
        }
        let n = list.u32()? as usize;
        if n == 0 {
            arrays.push(None);
            continue;
        }
        let mut a = list.take(n)?;
        a.u32()?; // the depth again
        let rect = [a.u32()?, a.u32()?, a.u32()?, a.u32()?];
        let depth = a.u16()?;
        let compression = a.u8()?;
        arrays.push(Some(Array {
            depth,
            rect,
            compression,
            data: a.bytes(a.remaining())?,
        }));
    }

    let color_count = mode.color_channels();
    let mut planes: Vec<Option<Vec<u8>>> = Vec::new();
    for array in arrays.iter().take(color_count) {
        planes.push(match array {
            Some(a) => Some(plane(a, rect, large, mode != ColorMode::Bitmap)?),
            None => None,
        });
    }
    let alpha = match arrays.iter().skip(color_count).rev().flatten().next() {
        Some(a) => Some(plane(a, rect, large, false)?),
        None => None,
    };
    let rgba = to_rgba(mode, width, height, &planes, alpha.as_deref(), &palette);
    Ok(Pattern {
        id,
        name,
        width,
        height,
        rgba: Arc::from(rgba),
    })
}

/// A channel's 8-bit samples over the pattern's bounds (zero outside the
/// array's own bounds). Bitmap samples stay packed one bit per pixel.
fn plane(a: &Array<'_>, bounds: [u32; 4], large: bool, color: bool) -> Result<Vec<u8>> {
    let width = (a.rect[3].saturating_sub(a.rect[1])) as usize;
    let height = (a.rect[2].saturating_sub(a.rect[0])) as usize;
    if width as u64 * height as u64 > MAX_PIXELS {
        return Err(PsdError::corrupt("pattern channel bounds out of range"));
    }
    let row = match a.depth {
        1 => width.div_ceil(8),
        8 => width,
        16 => width * 2,
        32 => width * 4,
        d => return Err(PsdError::Unsupported(format!("pattern depth {d}"))),
    };
    let raw = samples(a, row, height, large)?;
    let pw = (bounds[3].saturating_sub(bounds[1])) as usize;
    let ph = (bounds[2].saturating_sub(bounds[0])) as usize;
    let packed = a.depth == 1;
    let out_row = if packed { pw.div_ceil(8) } else { pw };
    let mut out = vec![0u8; out_row * ph];
    let dx = a.rect[1] as i64 - i64::from(bounds[1]);
    let dy = a.rect[0] as i64 - i64::from(bounds[0]);
    for y in 0..height {
        let ty = y as i64 + dy;
        if ty < 0 || ty >= ph as i64 {
            continue;
        }
        let src = &raw[y * row..(y + 1) * row];
        if packed {
            if dx == 0 {
                let n = out_row.min(row);
                let at = ty as usize * out_row;
                out[at..at + n].copy_from_slice(&src[..n]);
            }
            continue;
        }
        for x in 0..width {
            let tx = x as i64 + dx;
            if tx < 0 || tx >= pw as i64 {
                continue;
            }
            out[ty as usize * out_row + tx as usize] = match a.depth {
                8 => src[x],
                16 => src[2 * x],
                _ => {
                    let v = f32::from_be_bytes([
                        src[4 * x],
                        src[4 * x + 1],
                        src[4 * x + 2],
                        src[4 * x + 3],
                    ]);
                    let v = f64::from(v).clamp(0.0, 1.0);
                    let v = if color { srgb(v) } else { v };
                    (v * 255.0).round() as u8
                }
            };
        }
    }
    Ok(out)
}

fn srgb(v: f64) -> f64 {
    if v <= 0.003_130_8 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// An array's samples, decompressed: `height` rows of `row` bytes.
fn samples(a: &Array<'_>, row: usize, height: usize, large: bool) -> Result<Vec<u8>> {
    let size = row * height;
    match a.compression {
        0 => a
            .data
            .get(..size)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| PsdError::corrupt("pattern data too short")),
        1 => packbits_rows(a.data, row, height, large)
            .or_else(|_| packbits_rows(a.data, row, height, !large)),
        2 | 3 => {
            let mut out = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(a.data, size)
                .map_err(|_| PsdError::corrupt("pattern zip data"))?;
            if out.len() != size {
                return Err(PsdError::corrupt("pattern zip data size"));
            }
            if a.compression == 3 {
                unpredict(&mut out, row, a.depth);
            }
            Ok(out)
        }
        c => Err(PsdError::Unsupported(format!("pattern compression {c}"))),
    }
}

/// PackBits rows after their byte counts (16-bit, or 32-bit when `wide`).
fn packbits_rows(data: &[u8], row: usize, height: usize, wide: bool) -> Result<Vec<u8>> {
    let mut r = Reader::new(data);
    let mut counts = Vec::with_capacity(height.min(data.len()));
    for _ in 0..height {
        counts.push(if wide {
            r.u32()? as usize
        } else {
            usize::from(r.u16()?)
        });
    }
    let mut out = Vec::with_capacity(row * height);
    for n in counts {
        let start = out.len();
        unpack(r.bytes(n)?, &mut out, row)?;
        if out.len() - start != row {
            return Err(PsdError::corrupt("pattern row length"));
        }
    }
    Ok(out)
}

/// Decodes one PackBits row of `row` bytes.
fn unpack(mut src: &[u8], out: &mut Vec<u8>, row: usize) -> Result<()> {
    let end = out.len() + row;
    while let Some((&header, rest)) = src.split_first() {
        src = rest;
        let header = header as i8;
        if header >= 0 {
            let n = header as usize + 1;
            let literal = src
                .get(..n)
                .ok_or_else(|| PsdError::corrupt("pattern PackBits literal"))?;
            out.extend_from_slice(literal);
            src = &src[n..];
        } else if header != -128 {
            let n = (1 - i32::from(header)) as usize;
            let (&b, rest) = src
                .split_first()
                .ok_or_else(|| PsdError::corrupt("pattern PackBits run"))?;
            out.resize(out.len() + n, b);
            src = rest;
        }
        if out.len() > end {
            return Err(PsdError::corrupt("pattern PackBits row overrun"));
        }
    }
    Ok(())
}

/// Undoes zip prediction: horizontal differences per row (32-bit samples
/// byte-planar, as Photoshop writes them).
fn unpredict(data: &mut [u8], row: usize, depth: u16) {
    for line in data.chunks_mut(row.max(1)) {
        match depth {
            16 => {
                for i in 1..line.len() / 2 {
                    let prev = u16::from_be_bytes([line[2 * i - 2], line[2 * i - 1]]);
                    let cur = u16::from_be_bytes([line[2 * i], line[2 * i + 1]]);
                    line[2 * i..2 * i + 2].copy_from_slice(&prev.wrapping_add(cur).to_be_bytes());
                }
            }
            32 => {
                for i in 1..line.len() {
                    line[i] = line[i].wrapping_add(line[i - 1]);
                }
                let w = line.len() / 4;
                let planar = line.to_vec();
                for x in 0..w {
                    for b in 0..4 {
                        line[4 * x + b] = planar[b * w + x];
                    }
                }
            }
            _ => {
                for i in 1..line.len() {
                    line[i] = line[i].wrapping_add(line[i - 1]);
                }
            }
        }
    }
}

/// Straight RGBA for a pattern's planes (an indexed pattern's palette is
/// 256 RGB triples).
fn to_rgba(
    mode: ColorMode,
    width: u32,
    height: u32,
    planes: &[Option<Vec<u8>>],
    alpha: Option<&[u8]>,
    palette: &[u8],
) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    let mut out = vec![0u8; w * h * 4];
    let get = |c: usize, i: usize| -> u8 {
        planes
            .get(c)
            .and_then(Option::as_ref)
            .and_then(|p| p.get(i).copied())
            .unwrap_or(0)
    };
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let rgb = match mode {
                ColorMode::Rgb => [get(0, i), get(1, i), get(2, i)],
                ColorMode::Cmyk => {
                    let ink = |c| 1.0 - f64::from(get(c, i)) / 255.0;
                    color::cmyk_to_rgb(ink(0), ink(1), ink(2), ink(3)).to_u8()
                }
                ColorMode::Lab => color::lab_to_rgb(
                    f64::from(get(0, i)) / 255.0 * 100.0,
                    f64::from(get(1, i)) - 128.0,
                    f64::from(get(2, i)) - 128.0,
                )
                .to_u8(),
                ColorMode::Indexed => {
                    let k = 3 * usize::from(get(0, i));
                    [
                        palette.get(k).copied().unwrap_or(0),
                        palette.get(k + 1).copied().unwrap_or(0),
                        palette.get(k + 2).copied().unwrap_or(0),
                    ]
                }
                ColorMode::Bitmap => {
                    let row = w.div_ceil(8);
                    let bit = get(0, y * row + x / 8) >> (7 - x % 8) & 1;
                    let v = if bit == 1 { 0 } else { 255 };
                    [v, v, v]
                }
                ColorMode::Grayscale | ColorMode::Duotone | ColorMode::Multichannel => {
                    let v = get(0, i);
                    [v, v, v]
                }
            };
            out[i * 4..i * 4 + 3].copy_from_slice(&rgb);
            out[i * 4 + 3] = alpha.map_or(255, |a| a.get(i).copied().unwrap_or(255));
        }
    }
    out
}

#[cfg(test)]
mod test;
