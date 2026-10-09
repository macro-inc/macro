//! `DCTDecode` data (baseline and progressive JPEG, through zune-jpeg) to
//! samples: gray, RGB or YCbCr, and CMYK or YCCK.
//!
//! zune-jpeg is asked for the components as stored; the color transform
//! is applied here, decided by the Adobe `APP14` marker when there is one,
//! else by the `ColorTransform` parameter, else by the component count
//! (three components are YCbCr unless their ids spell `RGB`). Photoshop's
//! inverted CMYK is left as stored: PDF writers put a `Decode` array of
//! `[1 0 1 0 1 0 1 0]` beside such data, which the image decoder applies
//! (as Acrobat, pdf.js, and MuPDF do).

use super::{MAX_PIXELS, MAX_SIDE};
use crate::error::{AiError, Result};
use zune_core::bytestream::ZCursor;
use zune_core::colorspace::ColorSpace as ZColor;
use zune_core::options::DecoderOptions;

/// Decoded JPEG samples.
pub(super) struct Jpeg {
    pub(super) width: u32,
    pub(super) height: u32,
    /// Components per pixel (1, 3, or 4).
    pub(super) comps: usize,
    /// Samples, row by row, components adjacent.
    pub(super) samples: Vec<u8>,
}

/// What the headers say about color.
struct Header {
    comps: usize,
    /// Component ids, in frame order.
    ids: Vec<u8>,
    /// Where the Adobe marker's signature starts, and its transform flag.
    adobe: Option<(usize, u8)>,
}

fn corrupt(what: &str) -> AiError {
    AiError::corrupt(format!("JPEG: {what}"))
}

/// Decodes a JPEG stream; `color_transform` is its `ColorTransform`
/// parameter.
pub(super) fn decode(mut data: Vec<u8>, color_transform: Option<i64>) -> Result<Jpeg> {
    // Some writers put bytes before the start-of-image marker.
    let start = data
        .windows(2)
        .take(1024)
        .position(|w| w == [0xff, 0xd8])
        .ok_or_else(|| corrupt("no start of image"))?;
    if start > 0 {
        data.drain(..start);
    }
    let header = scan(&data).ok_or_else(|| corrupt("no frame header"))?;
    if !matches!(header.comps, 1 | 3 | 4) {
        return Err(AiError::Unsupported(format!(
            "JPEG with {} components",
            header.comps
        )));
    }
    if let Some((at, _)) = header.adobe {
        // Hide the marker so the decoder hands over the stored components.
        data[at] = b'a';
    }
    let options = DecoderOptions::default()
        .set_max_width(MAX_SIDE as usize)
        .set_max_height(MAX_SIDE as usize)
        .set_strict_mode(false);
    let mut decoder = zune_jpeg::JpegDecoder::new_with_options(ZCursor::new(&data), options);
    decoder
        .decode_headers()
        .map_err(|e| corrupt(&format!("{e:?}")))?;
    let stored = decoder
        .input_colorspace()
        .ok_or_else(|| corrupt("no color space"))?;
    if !matches!(
        stored,
        ZColor::Luma | ZColor::YCbCr | ZColor::RGB | ZColor::CMYK | ZColor::YCCK
    ) || stored.num_components() != header.comps
    {
        return Err(corrupt("unexpected component layout"));
    }
    decoder.set_options(options.jpeg_set_out_colorspace(stored));
    let (width, height) = decoder
        .dimensions()
        .ok_or_else(|| corrupt("no dimensions"))?;
    let (width, height) = (width as u32, height as u32);
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(corrupt("bad dimensions"));
    }
    let mut samples = decoder.decode().map_err(|e| corrupt(&format!("{e:?}")))?;
    let expected = width as usize * height as usize * header.comps;
    if samples.len() < expected {
        return Err(corrupt("short image"));
    }
    samples.truncate(expected);
    if transform(&header, color_transform) {
        match header.comps {
            3 => samples.chunks_exact_mut(3).for_each(ycc_to_rgb),
            4 => samples.chunks_exact_mut(4).for_each(|p| {
                ycc_to_rgb(&mut p[..3]);
                // YCCK holds inverted CMY as RGB.
                for v in &mut p[..3] {
                    *v = 255 - *v;
                }
            }),
            _ => {}
        }
    }
    Ok(Jpeg {
        width,
        height,
        comps: header.comps,
        samples,
    })
}

/// Whether the stored components are YCbCr (or YCCK) to convert: as the
/// Adobe marker says; else three components are, unless `ColorTransform`
/// is 0 or their ids spell `RGB`, and four only with `ColorTransform` 1.
fn transform(header: &Header, color_transform: Option<i64>) -> bool {
    if let Some((_, flag)) = header.adobe {
        return flag != 0;
    }
    match header.comps {
        3 => color_transform != Some(0) && header.ids != b"RGB",
        4 => color_transform == Some(1),
        _ => false,
    }
}

/// JFIF YCbCr to RGB, in place.
fn ycc_to_rgb(p: &mut [u8]) {
    let y = f32::from(p[0]);
    let cb = f32::from(p[1]) - 128.0;
    let cr = f32::from(p[2]) - 128.0;
    let clip = |v: f32| (v + 0.5).clamp(0.0, 255.0) as u8;
    p[0] = clip(y + 1.402 * cr);
    p[1] = clip(y - 0.344_136 * cb - 0.714_136 * cr);
    p[2] = clip(y + 1.772 * cb);
}

/// Reads markers up to the first scan: the frame's components and the
/// Adobe marker.
fn scan(data: &[u8]) -> Option<Header> {
    let mut at = 2;
    let mut comps = None;
    let mut adobe = None;
    loop {
        // Markers may be padded with fill bytes.
        while data.get(at) == Some(&0xff) && data.get(at + 1) == Some(&0xff) {
            at += 1;
        }
        if *data.get(at)? != 0xff {
            // Not at a marker: look for the next one.
            at += 1 + data.get(at + 1..)?.iter().position(|&b| b == 0xff)?;
            continue;
        }
        let marker = *data.get(at + 1)?;
        at += 2;
        match marker {
            0x01 | 0xd0..=0xd8 => continue,
            0xd9 | 0xda => break,
            _ => {}
        }
        let len = usize::from(u16::from_be_bytes([*data.get(at)?, *data.get(at + 1)?]));
        let segment = data.get(at + 2..at + len.max(2))?;
        match marker {
            // Frames (not DHT, JPG, or DAC).
            0xc0..=0xcf if !matches!(marker, 0xc4 | 0xc8 | 0xcc) => {
                let n = usize::from(*segment.get(5)?);
                let ids = (0..n)
                    .map(|i| segment.get(6 + i * 3).copied())
                    .collect::<Option<Vec<u8>>>()?;
                comps = Some((n, ids));
            }
            0xee if segment.starts_with(b"Adobe") && segment.len() >= 12 => {
                adobe = Some((at + 2, segment[11]));
            }
            _ => {}
        }
        at += len.max(2);
    }
    let (comps, ids) = comps?;
    Some(Header { comps, ids, adobe })
}
