//! Image XObjects and inline images: samples of 1 to 16 bits in any color
//! space, `Decode` arrays, stencil masks, soft masks, color-key and
//! explicit masks, and JPEG data (CMYK JPEGs included), decoded to straight
//! RGBA8.
//!
//! JPEG 2000 and JBIG2 data are not decoded: such images become a mid-gray
//! placeholder of their size. Fax (`CCITTFaxDecode`) data is decoded.
//! Masks of another size than their image are resampled to it (nearest
//! sample). `Interpolate` is ignored.

mod ccitt;
mod jpeg;

use crate::color::{ColorSpace, SampleConverter, to_u8};
use crate::error::{AiError, Result};
use crate::function::read::{dict_bool, dict_int, dict_numbers, get};
use crate::pdf::filter::ImageCodec;
use crate::pdf::{Dict, Name, Object, Resolve, Stream};

/// The longest side an image may have.
pub const MAX_SIDE: u32 = 1 << 15;
/// The most pixels an image may have (16384 × 16384).
pub const MAX_PIXELS: u64 = 1 << 28;
/// The gray of the placeholder for JPEG 2000 and JBIG2 images.
const PLACEHOLDER: u8 = 128;

/// A decoded image.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedImage {
    /// Width in samples.
    pub width: u32,
    /// Height in samples.
    pub height: u32,
    /// Straight RGBA8, row by row, top row first.
    pub rgba: Vec<u8>,
}

/// Samples as stored: `comps` per pixel of `bits` bits, rows padded to
/// whole bytes (missing data reads as zeros).
struct Raster {
    width: u32,
    height: u32,
    comps: usize,
    bits: u32,
    data: Vec<u8>,
}

impl Raster {
    fn row_bytes(&self) -> usize {
        (self.width as usize * self.comps * self.bits as usize).div_ceil(8)
    }

    /// Unpacks row `y` into one sample per component per pixel (zeros past
    /// the end of the data).
    fn unpack(&self, y: u32, out: &mut [u16]) {
        let len = self.row_bytes();
        let start = y as usize * len;
        let row = self.data.get(start..).unwrap_or(&[]);
        let row = &row[..len.min(row.len())];
        let filled = match self.bits {
            8 => {
                for (s, &b) in out.iter_mut().zip(row) {
                    *s = u16::from(b);
                }
                row.len()
            }
            16 => {
                for (s, b) in out.iter_mut().zip(row.chunks_exact(2)) {
                    *s = u16::from_be_bytes([b[0], b[1]]);
                }
                row.len() / 2
            }
            bits => {
                let per_byte = 8 / bits as usize;
                let mask = (1u16 << bits) - 1;
                for (chunk, &b) in out.chunks_mut(per_byte).zip(row) {
                    for (k, s) in chunk.iter_mut().enumerate() {
                        let shift = 8 - bits as usize * (k + 1);
                        *s = (u16::from(b) >> shift) & mask;
                    }
                }
                row.len() * per_byte
            }
        };
        if let Some(rest) = out.get_mut(filled..) {
            rest.fill(0);
        }
    }
}

/// What an image stream's data turned out to be.
enum Samples {
    Raster(Raster),
    /// A codec the engine does not decode.
    Placeholder,
}

/// One value per pixel at its own size: a mask's opacity.
struct Plane {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

impl Plane {
    /// Nearest-sample lookup for each pixel of a `width × height` image.
    fn sampler(&self, width: u32, height: u32) -> (Vec<usize>, Vec<usize>) {
        let map = |n: u32, of: u32| -> Vec<usize> {
            (0..n)
                .map(|i| ((u64::from(i) * 2 + 1) * u64::from(of) / (u64::from(n) * 2)) as usize)
                .map(|i| i.min(of as usize - 1))
                .collect()
        };
        (map(width, self.width), map(height, self.height))
    }
}

fn corrupt(what: &str) -> AiError {
    AiError::corrupt(format!("image: {what}"))
}

/// A zeroed buffer, failing instead of aborting when memory runs out.
fn buffer(len: usize, fill: u8) -> Result<Vec<u8>> {
    let mut v = Vec::new();
    v.try_reserve_exact(len)
        .map_err(|_| AiError::Unsupported("image too large for memory".into()))?;
    v.resize(len, fill);
    Ok(v)
}

/// `Width` and `Height`, within the limits.
fn dimensions(pdf: &dyn Resolve, dict: &Dict) -> Result<(u32, u32)> {
    let side = |key| {
        dict_int(pdf, dict, key)
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| (1..=MAX_SIDE).contains(v))
    };
    match (side("Width"), side("Height")) {
        (Some(w), Some(h)) if u64::from(w) * u64::from(h) <= MAX_PIXELS => Ok((w, h)),
        _ => Err(corrupt("bad or too large Width or Height")),
    }
}

/// Decodes an image XObject (or an inline image given as a stream with
/// its abbreviations expanded). A stencil mask (`ImageMask`) paints
/// `fill` (straight sRGB and alpha) where it marks.
pub fn decode(
    pdf: &dyn Resolve,
    image: &Stream,
    resources: &Dict,
    fill: [f32; 4],
) -> Result<DecodedImage> {
    let dict = &image.dict;
    let (width, height) = dimensions(pdf, dict)?;
    if dict_bool(pdf, dict, "ImageMask") == Some(true) {
        let mask = stencil(pdf, image, width, height)?;
        let rgb = [fill[0], fill[1], fill[2]].map(to_u8);
        let alpha = fill[3].clamp(0.0, 1.0);
        let mut rgba = buffer(mask.data.len() * 4, 0)?;
        for (px, &m) in rgba.chunks_exact_mut(4).zip(&mask.data) {
            px[..3].copy_from_slice(&rgb);
            px[3] = (f32::from(m) * alpha + 0.5) as u8;
        }
        return Ok(DecodedImage {
            width: mask.width,
            height: mask.height,
            rgba,
        });
    }
    let space = match get(pdf, dict, "ColorSpace") {
        Object::Null => None,
        cs => Some(ColorSpace::parse(pdf, &cs, resources)?),
    };
    if matches!(space, Some(ColorSpace::Pattern(_))) {
        return Err(corrupt("an image cannot be in a pattern space"));
    }
    let comps = space.as_ref().map_or(1, ColorSpace::components);
    let bits = match dict_int(pdf, dict, "BitsPerComponent") {
        Some(b @ (1 | 2 | 4 | 8 | 16)) => b as u32,
        // JPEG and JPEG 2000 images may leave it out.
        None => 8,
        Some(_) => return Err(corrupt("bad BitsPerComponent")),
    };
    let samples = read_samples(pdf, image, width, height, comps, bits)?;
    // Alpha: a soft mask overrides Mask; masks that fail to decode are
    // left out rather than losing the image.
    let soft = soft_mask(pdf, dict).ok().flatten();
    let explicit = match (&soft, get(pdf, dict, "Mask")) {
        (None, Object::Stream(mask)) => dimensions(pdf, &mask.dict)
            .and_then(|(w, h)| stencil(pdf, &mask, w, h))
            .ok(),
        _ => None,
    };
    let raster = match samples {
        Samples::Raster(r) => r,
        Samples::Placeholder => {
            let mut rgba = buffer(width as usize * height as usize * 4, PLACEHOLDER)?;
            rgba.chunks_exact_mut(4).for_each(|px| px[3] = 255);
            let mask = soft.as_ref().map(|s| &s.0).or(explicit.as_ref());
            apply_alpha(&mut rgba, width, height, mask);
            return Ok(DecodedImage {
                width,
                height,
                rgba,
            });
        }
    };
    // The data decides the component count (a JPEG's may differ from the
    // color space's); a space that disagrees gives way to a device space.
    let space = match space {
        Some(s) if s.components() == raster.comps => s,
        _ => match raster.comps {
            1 => ColorSpace::Gray,
            3 => ColorSpace::Rgb,
            4 => ColorSpace::Cmyk,
            _ => return Err(corrupt("components do not match the color space")),
        },
    };
    let (w, h) = (raster.width, raster.height);
    let n = raster.comps;
    let decode = dict_numbers(pdf, dict, "Decode").filter(|d| d.len() >= 2 * n);
    let mut rgba = buffer(w as usize * h as usize * 4, 255)?;
    let mut converter = SampleConverter::new(&space, raster.bits as u8, decode.as_deref());
    let matte = soft
        .as_ref()
        .filter(|(plane, _)| plane.width == w && plane.height == h)
        .and_then(|(_, matte)| matte.clone())
        .filter(|m| m.len() >= n);
    let key = match (&soft, &explicit) {
        (None, None) => color_key(pdf, dict, n, raster.bits),
        _ => Vec::new(),
    };
    let mut row = vec![0u16; w as usize * n];
    for y in 0..h {
        raster.unpack(y, &mut row);
        let out = &mut rgba[y as usize * w as usize * 4..(y as usize + 1) * w as usize * 4];
        match (&matte, &soft) {
            (Some(matte), Some((plane, _))) => {
                let alpha = &plane.data[y as usize * w as usize..(y as usize + 1) * w as usize];
                unmatte_row(&mut converter, &space, &row, alpha, matte, out);
            }
            _ => converter.convert(&row, out, 4),
        }
        if !key.is_empty() {
            for (px, s) in out.chunks_exact_mut(4).zip(row.chunks_exact(n)) {
                if s.iter().zip(&key).all(|(&v, &(lo, hi))| v >= lo && v <= hi) {
                    px[3] = 0;
                }
            }
        }
    }
    let mask = soft.as_ref().map(|s| &s.0).or(explicit.as_ref());
    apply_alpha(&mut rgba, w, h, mask);
    if space.is_invisible() {
        rgba.chunks_exact_mut(4).for_each(|px| px[3] = 0);
    }
    Ok(DecodedImage {
        width: w,
        height: h,
        rgba,
    })
}

/// Multiplies the image's alpha by a mask's, resampling the mask.
fn apply_alpha(rgba: &mut [u8], width: u32, height: u32, mask: Option<&Plane>) {
    let Some(mask) = mask else {
        return;
    };
    let (xs, ys) = mask.sampler(width, height);
    for (y, &sy) in ys.iter().enumerate() {
        let src = &mask.data[sy * mask.width as usize..];
        let out = &mut rgba[y * width as usize * 4..(y + 1) * width as usize * 4];
        for (px, &sx) in out.chunks_exact_mut(4).zip(&xs) {
            let a = u32::from(px[3]) * u32::from(src[sx]);
            px[3] = ((a + 127) / 255) as u8;
        }
    }
}

/// Converts a row whose colors were premultiplied with a soft mask's
/// `Matte` color: `c = m + (c' - m) / alpha`, undone before conversion.
fn unmatte_row(
    converter: &mut SampleConverter<'_>,
    space: &ColorSpace,
    samples: &[u16],
    alpha: &[u8],
    matte: &[f32],
    out: &mut [u8],
) {
    let n = space.components();
    let mut values = vec![0.0f32; n];
    let ranges = space.ranges();
    for ((s, &a), px) in samples
        .chunks_exact(n)
        .zip(alpha)
        .zip(out.chunks_exact_mut(4))
    {
        values.copy_from_slice(converter.values(s));
        if a > 0 {
            let a = f32::from(a) / 255.0;
            for ((v, &m), [lo, hi]) in values.iter_mut().zip(matte).zip(&ranges) {
                *v = crate::function::read::clamp(m + (*v - m) / a, *lo, *hi);
            }
        }
        let rgb = space.to_rgb(&values).map(to_u8);
        px[..3].copy_from_slice(&rgb);
    }
}

/// `Mask` as color-key ranges of stored sample values, one per component.
fn color_key(pdf: &dyn Resolve, dict: &Dict, n: usize, bits: u32) -> Vec<(u16, u16)> {
    let Some(ranges) = dict_numbers(pdf, dict, "Mask") else {
        return Vec::new();
    };
    if ranges.len() < 2 * n {
        return Vec::new();
    }
    let max = ((1u32 << bits) - 1) as f32;
    ranges
        .chunks_exact(2)
        .take(n)
        .map(|p| (p[0].clamp(0.0, max) as u16, p[1].clamp(0.0, max) as u16))
        .collect()
}

/// Reads an image stream's samples through its filters and codec.
fn read_samples(
    pdf: &dyn Resolve,
    image: &Stream,
    width: u32,
    height: u32,
    comps: usize,
    bits: u32,
) -> Result<Samples> {
    let (data, codec) = pdf.decode_stream(image)?;
    Ok(match codec {
        None => Samples::Raster(Raster {
            width,
            height,
            comps,
            bits,
            data,
        }),
        Some(ImageCodec::Dct(params)) => {
            let transform = params
                .get("ColorTransform")
                .and_then(|t| pdf.resolve(t).as_i64());
            let j = jpeg::decode(data, transform)?;
            Samples::Raster(Raster {
                width: j.width,
                height: j.height,
                comps: j.comps,
                bits: 8,
                data: j.samples,
            })
        }
        Some(ImageCodec::Ccitt(params)) => {
            let int = |key, default| dict_int(pdf, &params, key).unwrap_or(default);
            let flag = |key, default| dict_bool(pdf, &params, key).unwrap_or(default);
            let p = ccitt::Params {
                k: int("K", 0),
                end_of_line: flag("EndOfLine", false),
                byte_align: flag("EncodedByteAlign", false),
                columns: usize::try_from(int("Columns", 1728)).unwrap_or(0),
                rows: usize::try_from(int("Rows", 0)).unwrap_or(0),
                end_of_block: flag("EndOfBlock", true),
                black_is_1: flag("BlackIs1", false),
            };
            if p.columns as u64 * u64::from(height) > MAX_PIXELS {
                return Err(corrupt("fax image too large"));
            }
            let (rows, data) = ccitt::decode(&data, &p, height as usize)?;
            if rows == 0 {
                return Err(corrupt("no fax rows"));
            }
            // Rows the data lacks are white (as an encoder pads them).
            let white = if p.black_is_1 { 0 } else { 0xff };
            let mut data = data;
            data.resize(p.columns.div_ceil(8) * height as usize, white);
            Samples::Raster(Raster {
                width: p.columns as u32,
                height,
                comps: 1,
                bits: 1,
                data,
            })
        }
        Some(ImageCodec::Jpx | ImageCodec::Jbig2(_)) => Samples::Placeholder,
    })
}

/// A stencil mask (`ImageMask`, or an image's explicit `Mask`): 255 where
/// it marks. Samples that decode (through `Decode`) to 0 mark.
fn stencil(pdf: &dyn Resolve, image: &Stream, width: u32, height: u32) -> Result<Plane> {
    let decode = dict_numbers(pdf, &image.dict, "Decode");
    let (d0, d1) = match decode.as_deref() {
        Some([d0, d1, ..]) => (*d0, *d1),
        _ => (0.0, 1.0),
    };
    let bits = match dict_int(pdf, &image.dict, "BitsPerComponent") {
        Some(b @ (1 | 2 | 4 | 8 | 16)) => b as u32,
        _ => 1,
    };
    let raster = match read_samples(pdf, image, width, height, 1, bits)? {
        Samples::Raster(r) => r,
        Samples::Placeholder => {
            return Ok(Plane {
                width,
                height,
                data: buffer(width as usize * height as usize, PLACEHOLDER)?,
            });
        }
    };
    let max = ((1u32 << raster.bits) - 1) as f32;
    let (w, h) = (raster.width, raster.height);
    let mut data = buffer(w as usize * h as usize, 0)?;
    let mut row = vec![0u16; w as usize * raster.comps];
    for y in 0..h {
        raster.unpack(y, &mut row);
        let out = &mut data[y as usize * w as usize..(y as usize + 1) * w as usize];
        for (o, s) in out.iter_mut().zip(row.chunks_exact(raster.comps)) {
            let v = d0 + f32::from(s[0]) / max * (d1 - d0);
            *o = if v < 0.5 { 255 } else { 0 };
        }
    }
    Ok(Plane {
        width: w,
        height: h,
        data,
    })
}

/// An image's soft mask (`SMask`): its opacity at its own size, and the
/// `Matte` color its image was premultiplied with.
fn soft_mask(pdf: &dyn Resolve, dict: &Dict) -> Result<Option<(Plane, Option<Vec<f32>>)>> {
    let smask = get(pdf, dict, "SMask");
    let Some(stream) = smask.as_stream() else {
        return Ok(None);
    };
    let (width, height) = dimensions(pdf, &stream.dict)?;
    let bits = match dict_int(pdf, &stream.dict, "BitsPerComponent") {
        Some(b @ (1 | 2 | 4 | 8 | 16)) => b as u32,
        None => 8,
        Some(_) => return Err(corrupt("bad soft mask BitsPerComponent")),
    };
    let (d0, d1) = match dict_numbers(pdf, &stream.dict, "Decode").as_deref() {
        Some([d0, d1, ..]) => (*d0, *d1),
        _ => (0.0, 1.0),
    };
    let matte = dict_numbers(pdf, &stream.dict, "Matte");
    let plane = match read_samples(pdf, stream, width, height, 1, bits)? {
        Samples::Placeholder => Plane {
            width,
            height,
            data: buffer(width as usize * height as usize, 255)?,
        },
        Samples::Raster(raster) => {
            let max = ((1u32 << raster.bits) - 1) as f32;
            let (w, h) = (raster.width, raster.height);
            let mut data = buffer(w as usize * h as usize, 0)?;
            let mut row = vec![0u16; w as usize * raster.comps];
            for y in 0..h {
                raster.unpack(y, &mut row);
                let out = &mut data[y as usize * w as usize..(y as usize + 1) * w as usize];
                for (o, s) in out.iter_mut().zip(row.chunks_exact(raster.comps)) {
                    *o = to_u8(d0 + f32::from(s[0]) / max * (d1 - d0));
                }
            }
            Plane {
                width: w,
                height: h,
                data,
            }
        }
    };
    Ok(Some((plane, matte)))
}

/// An inline image's dictionary with abbreviated keys and values expanded
/// (`W` to `Width`, `CS` `RGB` to `DeviceRGB`, `F` `Fl` to `FlateDecode`, …).
pub fn expand_inline(dict: &Dict) -> Dict {
    let mut out = Dict::new();
    for (key, value) in dict.iter() {
        let key = match key.as_bytes() {
            b"BPC" => "BitsPerComponent",
            b"CS" => "ColorSpace",
            b"D" => "Decode",
            b"DP" => "DecodeParms",
            b"F" => "Filter",
            b"H" => "Height",
            b"IM" => "ImageMask",
            b"I" => "Interpolate",
            b"W" => "Width",
            b"L" => "Length",
            _ => {
                out.0.push((key.clone(), value.clone()));
                continue;
            }
        };
        let value = match key {
            "ColorSpace" => match value {
                Object::Name(n) => Object::Name(color_space_name(n)),
                Object::Array(items) => Object::Array(
                    items
                        .iter()
                        .enumerate()
                        .map(|(i, item)| match item {
                            Object::Name(n) if i < 2 => Object::Name(color_space_name(n)),
                            other => other.clone(),
                        })
                        .collect(),
                ),
                other => other.clone(),
            },
            "Filter" => match value {
                Object::Name(n) => Object::Name(filter_name(n)),
                Object::Array(items) => Object::Array(
                    items
                        .iter()
                        .map(|item| match item {
                            Object::Name(n) => Object::Name(filter_name(n)),
                            other => other.clone(),
                        })
                        .collect(),
                ),
                other => other.clone(),
            },
            _ => value.clone(),
        };
        out.set(key, value);
    }
    out
}

fn color_space_name(n: &Name) -> Name {
    Name::new(match n.as_bytes() {
        b"G" => "DeviceGray",
        b"RGB" => "DeviceRGB",
        b"CMYK" => "DeviceCMYK",
        b"I" => "Indexed",
        _ => return n.clone(),
    })
}

fn filter_name(n: &Name) -> Name {
    Name::new(match n.as_bytes() {
        b"AHx" => "ASCIIHexDecode",
        b"A85" => "ASCII85Decode",
        b"LZW" => "LZWDecode",
        b"Fl" => "FlateDecode",
        b"RL" => "RunLengthDecode",
        b"CCF" => "CCITTFaxDecode",
        b"DCT" => "DCTDecode",
        _ => return n.clone(),
    })
}

#[cfg(test)]
mod test;
