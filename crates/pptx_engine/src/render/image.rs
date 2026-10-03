//! Picture decoding (PNG, JPEG, GIF, BMP/DIB) and picture effects.

use super::scene::Raster;
use crate::error::{Error, Result};
use crate::model::color::{Rgba, hsl_to_rgb, rgb_to_hsl};
use crate::model::fill::BlipEffect;

/// Largest decoded image (pixels) accepted; bigger images are rejected.
const MAX_PIXELS: u64 = 80_000_000;
/// Decoded images are downscaled so neither side exceeds this.
const MAX_SIDE: u32 = 4096;

/// Recognized image container formats.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    /// PNG.
    Png,
    /// JPEG.
    Jpeg,
    /// GIF.
    Gif,
    /// Windows bitmap.
    Bmp,
    /// Enhanced metafile.
    Emf,
    /// Windows metafile.
    Wmf,
    /// TIFF.
    Tiff,
    /// SVG.
    Svg,
    /// Anything else.
    Unknown,
}

/// Detects the format from magic bytes.
pub fn sniff(b: &[u8]) -> Format {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Format::Png
    } else if b.starts_with(&[0xFF, 0xD8]) {
        Format::Jpeg
    } else if b.starts_with(b"GIF8") {
        Format::Gif
    } else if b.starts_with(b"BM") {
        Format::Bmp
    } else if b.len() > 44 && b[0..4] == [1, 0, 0, 0] && &b[40..44] == b" EMF" {
        Format::Emf
    } else if b.starts_with(&[0xD7, 0xCD, 0xC6, 0x9A])
        || b.starts_with(&[1, 0, 9, 0])
        || b.starts_with(&[2, 0, 9, 0])
    {
        Format::Wmf
    } else if b.starts_with(b"II*\0") || b.starts_with(b"MM\0*") {
        Format::Tiff
    } else if b.starts_with(b"<svg")
        || (b.starts_with(b"<?xml") && b.windows(4).take(2048).any(|w| w == b"<svg"))
    {
        Format::Svg
    } else {
        Format::Unknown
    }
}

fn check_size(w: u32, h: u32) -> Result<()> {
    if w == 0 || h == 0 {
        return Err(Error::Image("empty image".into()));
    }
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(Error::LimitExceeded(format!("image is {w}x{h} pixels")));
    }
    Ok(())
}

/// Premultiplies straight RGBA in place.
pub fn premultiply(px: &mut [u8]) {
    for p in px.chunks_exact_mut(4) {
        let a = u32::from(p[3]);
        if a < 255 {
            for c in &mut p[..3] {
                *c = ((u32::from(*c) * a + 127) / 255) as u8;
            }
        }
    }
}

/// Decodes a raster image to premultiplied RGBA.
pub fn decode_raster(bytes: &[u8]) -> Result<Raster> {
    let raster = match sniff(bytes) {
        Format::Png => decode_png(bytes)?,
        Format::Jpeg => decode_jpeg(bytes)?,
        Format::Gif => decode_gif(bytes)?,
        Format::Bmp => decode_bmp(bytes)?,
        f => return Err(Error::Image(format!("unsupported raster format {f:?}"))),
    };
    Ok(downscale(raster, MAX_SIDE))
}

fn decode_png(bytes: &[u8]) -> Result<Raster> {
    let mut dec = png::Decoder::new_with_limits(
        std::io::Cursor::new(bytes),
        png::Limits {
            bytes: 512 * 1024 * 1024,
        },
    );
    dec.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = dec.read_info().map_err(|e| Error::Image(e.to_string()))?;
    let (w, h) = (reader.info().width, reader.info().height);
    check_size(w, h)?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| Error::Image("png too large".into()))?;
    let mut buf = vec![0; size];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| Error::Image(e.to_string()))?;
    let n = (w * h) as usize;
    let mut out = Vec::with_capacity(n * 4);
    match info.color_type {
        png::ColorType::Rgba => out.extend_from_slice(&buf[..n * 4]),
        png::ColorType::Rgb => {
            for p in buf[..n * 3].chunks_exact(3) {
                out.extend_from_slice(&[p[0], p[1], p[2], 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for p in buf[..n * 2].chunks_exact(2) {
                out.extend_from_slice(&[p[0], p[0], p[0], p[1]]);
            }
        }
        png::ColorType::Grayscale => {
            for &g in &buf[..n] {
                out.extend_from_slice(&[g, g, g, 255]);
            }
        }
        png::ColorType::Indexed => return Err(Error::Image("unexpanded palette".into())),
    }
    premultiply(&mut out);
    Ok(Raster {
        width: w,
        height: h,
        pixels: out,
    })
}

fn decode_jpeg(bytes: &[u8]) -> Result<Raster> {
    use zune_core::bytestream::ZCursor;
    use zune_core::colorspace::ColorSpace;
    use zune_core::options::DecoderOptions;
    let options = DecoderOptions::default()
        .jpeg_set_out_colorspace(ColorSpace::RGBA)
        .set_max_width(60_000)
        .set_max_height(60_000)
        .set_strict_mode(false);
    let mut dec = zune_jpeg::JpegDecoder::new_with_options(ZCursor::new(bytes), options);
    dec.decode_headers()
        .map_err(|e| Error::Image(format!("{e:?}")))?;
    let info = dec
        .info()
        .ok_or_else(|| Error::Image("jpeg headers".into()))?;
    let (w, h) = (u32::from(info.width), u32::from(info.height));
    check_size(w, h)?;
    let pixels = dec.decode().map_err(|e| Error::Image(format!("{e:?}")))?;
    if pixels.len() != (w * h * 4) as usize {
        return Err(Error::Image("jpeg size mismatch".into()));
    }
    Ok(Raster {
        width: w,
        height: h,
        pixels,
    })
}

fn decode_gif(bytes: &[u8]) -> Result<Raster> {
    let mut opts = gif::DecodeOptions::new();
    opts.set_color_output(gif::ColorOutput::RGBA);
    let mut dec = opts
        .read_info(std::io::Cursor::new(bytes))
        .map_err(|e| Error::Image(e.to_string()))?;
    let (w, h) = (u32::from(dec.width()), u32::from(dec.height()));
    check_size(w, h)?;
    let mut canvas = vec![0u8; (w * h * 4) as usize];
    if let Some(frame) = dec
        .read_next_frame()
        .map_err(|e| Error::Image(e.to_string()))?
    {
        let (fx, fy, fw, fh) = (
            u32::from(frame.left),
            u32::from(frame.top),
            u32::from(frame.width),
            u32::from(frame.height),
        );
        for y in 0..fh {
            for x in 0..fw {
                let (cx, cy) = (fx + x, fy + y);
                if cx >= w || cy >= h {
                    continue;
                }
                let s = ((y * fw + x) * 4) as usize;
                let d = ((cy * w + cx) * 4) as usize;
                if s + 4 <= frame.buffer.len() {
                    canvas[d..d + 4].copy_from_slice(&frame.buffer[s..s + 4]);
                }
            }
        }
    }
    premultiply(&mut canvas);
    Ok(Raster {
        width: w,
        height: h,
        pixels: canvas,
    })
}

fn le16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
}

fn le32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn decode_bmp(bytes: &[u8]) -> Result<Raster> {
    let offset = le32(bytes, 10).ok_or_else(|| Error::Image("bmp header".into()))? as usize;
    decode_dib(&bytes[14..], offset.checked_sub(14))
}

/// Decodes a device-independent bitmap (`BITMAPINFOHEADER` + palette + bits).
/// `bits_offset` is the offset of the pixel data from the start of `dib`, if known.
pub fn decode_dib(dib: &[u8], bits_offset: Option<usize>) -> Result<Raster> {
    let bad = || Error::Image("malformed DIB".into());
    let header_size = le32(dib, 0).ok_or_else(bad)? as usize;
    let (w, h_raw, bpp, compression, colors_used) = if header_size == 12 {
        // BITMAPCOREHEADER
        (
            i32::from(le16(dib, 4).ok_or_else(bad)?),
            i32::from(le16(dib, 6).ok_or_else(bad)?),
            le16(dib, 10).ok_or_else(bad)?,
            0,
            0,
        )
    } else {
        (
            le32(dib, 4).ok_or_else(bad)? as i32,
            le32(dib, 8).ok_or_else(bad)? as i32,
            le16(dib, 14).ok_or_else(bad)?,
            le32(dib, 16).ok_or_else(bad)?,
            le32(dib, 32).unwrap_or(0),
        )
    };
    let top_down = h_raw < 0;
    let (w, h) = (w.unsigned_abs(), h_raw.unsigned_abs());
    check_size(w, h)?;
    let palette_entries = if bpp <= 8 {
        if colors_used > 0 {
            colors_used as usize
        } else {
            1usize << bpp
        }
    } else {
        0
    };
    let entry = if header_size == 12 { 3 } else { 4 };
    let palette_at = header_size;
    let palette: Vec<[u8; 3]> = (0..palette_entries)
        .map(|i| {
            let at = palette_at + i * entry;
            match dib.get(at..at + 3) {
                Some(c) => [c[2], c[1], c[0]],
                None => [0, 0, 0],
            }
        })
        .collect();
    // BI_BITFIELDS masks follow a 40-byte header.
    let (masks, mask_len) = if compression == 3 && header_size == 40 {
        (
            Some([
                le32(dib, 40).unwrap_or(0),
                le32(dib, 44).unwrap_or(0),
                le32(dib, 48).unwrap_or(0),
            ]),
            12,
        )
    } else if compression == 3 && header_size >= 52 {
        (
            Some([
                le32(dib, 40).unwrap_or(0),
                le32(dib, 44).unwrap_or(0),
                le32(dib, 48).unwrap_or(0),
            ]),
            0,
        )
    } else {
        (None, 0)
    };
    let bits_at = bits_offset.unwrap_or(header_size + mask_len + palette_entries * entry);
    let bits = dib.get(bits_at..).unwrap_or(&[]);
    let stride = ((w as usize * usize::from(bpp)).div_ceil(32)) * 4;
    let mut out = vec![0u8; (w * h * 4) as usize];
    if compression == 1 || compression == 2 {
        decode_rle(bits, compression == 2, w, h, &palette, &mut out);
    } else {
        for row in 0..h as usize {
            let src_row = if top_down { row } else { h as usize - 1 - row };
            let line = bits
                .get(src_row * stride..src_row * stride + stride)
                .unwrap_or(&[]);
            for x in 0..w as usize {
                let px = match bpp {
                    1 | 4 | 8 => {
                        let bit = x * usize::from(bpp);
                        let byte = line.get(bit / 8).copied().unwrap_or(0);
                        let shift = 8 - usize::from(bpp) - (bit % 8);
                        let idx = (byte >> shift) & ((1u16 << bpp) - 1) as u8;
                        let c = palette.get(usize::from(idx)).copied().unwrap_or([0, 0, 0]);
                        [c[0], c[1], c[2], 255]
                    }
                    16 => {
                        let v = u32::from(le16(line, x * 2).unwrap_or(0));
                        let [rm, gm, bm] = masks.unwrap_or([0x7C00, 0x03E0, 0x001F]);
                        [
                            mask_channel(v, rm),
                            mask_channel(v, gm),
                            mask_channel(v, bm),
                            255,
                        ]
                    }
                    24 => match line.get(x * 3..x * 3 + 3) {
                        Some(p) => [p[2], p[1], p[0], 255],
                        None => [0, 0, 0, 255],
                    },
                    32 => {
                        let v = le32(line, x * 4).unwrap_or(0);
                        match masks {
                            Some([rm, gm, bm]) => [
                                mask_channel(v, rm),
                                mask_channel(v, gm),
                                mask_channel(v, bm),
                                255,
                            ],
                            None => [(v >> 16) as u8, (v >> 8) as u8, v as u8, 255],
                        }
                    }
                    _ => [0, 0, 0, 0],
                };
                let d = (row * w as usize + x) * 4;
                out[d..d + 4].copy_from_slice(&px);
            }
        }
    }
    Ok(Raster {
        width: w,
        height: h,
        pixels: out,
    })
}

fn mask_channel(v: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 0;
    }
    let shift = mask.trailing_zeros();
    // Width up to the highest set bit, so non-contiguous masks cannot overflow.
    let bits = 32 - (mask >> shift).leading_zeros();
    let val = u64::from((v & mask) >> shift);
    let max = (1u64 << bits) - 1;
    ((val * 255 + max / 2) / max).min(255) as u8
}

fn decode_rle(bits: &[u8], rle4: bool, w: u32, h: u32, palette: &[[u8; 3]], out: &mut [u8]) {
    let (mut x, mut y) = (0u32, 0u32);
    let mut i = 0;
    let mut put = |x: u32, y: u32, idx: u8| {
        if x < w && y < h {
            let row = h - 1 - y;
            let c = palette.get(usize::from(idx)).copied().unwrap_or([0, 0, 0]);
            let d = ((row * w + x) * 4) as usize;
            out[d..d + 4].copy_from_slice(&[c[0], c[1], c[2], 255]);
        }
    };
    while i + 1 < bits.len() {
        let (n, v) = (bits[i], bits[i + 1]);
        i += 2;
        if n > 0 {
            for k in 0..u32::from(n) {
                let idx = if rle4 {
                    if k % 2 == 0 { v >> 4 } else { v & 15 }
                } else {
                    v
                };
                put(x, y, idx);
                x += 1;
            }
            continue;
        }
        match v {
            0 => {
                x = 0;
                y += 1;
            }
            1 => break,
            2 => {
                x += u32::from(*bits.get(i).unwrap_or(&0));
                y += u32::from(*bits.get(i + 1).unwrap_or(&0));
                i += 2;
            }
            count => {
                let count = u32::from(count);
                let bytes = if rle4 { count.div_ceil(2) } else { count } as usize;
                for k in 0..count {
                    let b = *bits
                        .get(i + if rle4 { (k / 2) as usize } else { k as usize })
                        .unwrap_or(&0);
                    let idx = if rle4 {
                        if k % 2 == 0 { b >> 4 } else { b & 15 }
                    } else {
                        b
                    };
                    put(x, y, idx);
                    x += 1;
                }
                i += bytes + (bytes & 1);
            }
        }
    }
}

/// Box-filter downscale so neither side exceeds `max_side`.
pub fn downscale(r: Raster, max_side: u32) -> Raster {
    let factor = r.width.max(r.height).div_ceil(max_side);
    if factor <= 1 {
        return r;
    }
    let (w, h) = (r.width / factor, r.height / factor);
    let mut out = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0u32; 4];
            for dy in 0..factor {
                for dx in 0..factor {
                    let s = (((y * factor + dy) * r.width + x * factor + dx) * 4) as usize;
                    for (sum, &v) in acc.iter_mut().zip(&r.pixels[s..s + 4]) {
                        *sum += u32::from(v);
                    }
                }
            }
            let n = factor * factor;
            let d = ((y * w + x) * 4) as usize;
            for c in 0..4 {
                out[d + c] = (acc[c] / n) as u8;
            }
        }
    }
    Raster {
        width: w,
        height: h,
        pixels: out,
    }
}

/// Adds a one-pixel transparent border so clamped sampling fades to nothing.
pub fn with_border(r: &Raster) -> Raster {
    let (w, h) = (r.width + 2, r.height + 2);
    let mut out = vec![0u8; (w * h * 4) as usize];
    for y in 0..r.height {
        let s = (y * r.width * 4) as usize;
        let d = (((y + 1) * w + 1) * 4) as usize;
        out[d..d + (r.width * 4) as usize]
            .copy_from_slice(&r.pixels[s..s + (r.width * 4) as usize]);
    }
    Raster {
        width: w,
        height: h,
        pixels: out,
    }
}

/// Applies picture effects in order (on premultiplied pixels).
pub fn apply_effects(r: &mut Raster, effects: &[BlipEffect]) {
    for e in effects {
        for p in r.pixels.chunks_exact_mut(4) {
            let a = p[3];
            if a == 0 && !matches!(e, BlipEffect::ClrChange { .. }) {
                continue;
            }
            // Work in straight alpha.
            let af = f32::from(a) / 255.0;
            let un = |c: u8| {
                if a == 0 {
                    0.0
                } else {
                    (f32::from(c) / 255.0 / af).min(1.0)
                }
            };
            let (mut cr, mut cg, mut cb, mut ca) = (un(p[0]), un(p[1]), un(p[2]), af);
            match e {
                BlipEffect::AlphaModFix(k) => ca *= k,
                BlipEffect::Grayscale => {
                    let y = 0.299 * cr + 0.587 * cg + 0.114 * cb;
                    (cr, cg, cb) = (y, y, y);
                }
                BlipEffect::BiLevel(t) => {
                    let y = 0.299 * cr + 0.587 * cg + 0.114 * cb;
                    let v = if y >= *t { 1.0 } else { 0.0 };
                    (cr, cg, cb) = (v, v, v);
                }
                BlipEffect::Lum { bright, contrast } => {
                    let f = |c: f32| {
                        let c = c + bright;
                        let k = if *contrast >= 0.0 {
                            1.0 / (1.0 - contrast).max(0.001)
                        } else {
                            1.0 + contrast
                        };
                        ((c - 0.5) * k + 0.5).clamp(0.0, 1.0)
                    };
                    (cr, cg, cb) = (f(cr), f(cg), f(cb));
                }
                BlipEffect::Duotone(c1, c2) => {
                    let y = 0.299 * cr + 0.587 * cg + 0.114 * cb;
                    let c = c1.lerp(*c2, y);
                    (cr, cg, cb) = (c.r, c.g, c.b);
                }
                BlipEffect::ClrChange { from, to } => {
                    let d = (cr - from.r)
                        .abs()
                        .max((cg - from.g).abs())
                        .max((cb - from.b).abs());
                    if d < 0.04 && a > 0 {
                        (cr, cg, cb, ca) = (to.r, to.g, to.b, ca * to.a);
                    }
                }
                BlipEffect::ColorReplace(c) => (cr, cg, cb) = (c.r, c.g, c.b),
                BlipEffect::AlphaBiLevel(t) => ca = if ca >= *t { 1.0 } else { 0.0 },
            }
            let na = (ca.clamp(0.0, 1.0) * 255.0).round() as u8;
            let k = f32::from(na) / 255.0;
            p[0] = (cr.clamp(0.0, 1.0) * k * 255.0).round() as u8;
            p[1] = (cg.clamp(0.0, 1.0) * k * 255.0).round() as u8;
            p[2] = (cb.clamp(0.0, 1.0) * k * 255.0).round() as u8;
            p[3] = na;
        }
    }
}

/// Recolors a picture toward a tint (used for `lighten`/`darken` path fills).
pub fn shade_color(c: Rgba, amount: f32) -> Rgba {
    let (h, s, l) = rgb_to_hsl(f64::from(c.r), f64::from(c.g), f64::from(c.b));
    let l = (l * f64::from(amount)).clamp(0.0, 1.0);
    Rgba {
        a: c.a,
        ..hsl_to_rgb(h, s, l)
    }
}

#[cfg(test)]
mod test;
