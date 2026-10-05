//! Image fills: decoding (PNG, JPEG, GIF, WebP) into premultiplied pixmaps,
//! mip levels for drawing large images small, and a memory budget.

use std::collections::HashMap;
use std::sync::Arc;
use tiny_skia::{IntSize, Pixmap};

/// One image's mip levels (each half the size of the one before), built on
/// demand. Any level may be missing: a level is always built by halving
/// the next finer one present, or the image decoded again, so every route
/// gives the same pixels.
struct Entry {
    width: u32,
    height: u32,
    levels: Vec<Option<Arc<Pixmap>>>,
    /// When each level was last drawn from (the store's clock).
    used: Vec<u64>,
}

impl Entry {
    fn bytes(&self) -> usize {
        self.levels.iter().flatten().map(|p| p.data().len()).sum()
    }
}

/// How many levels an image of this size has (down to a pixel or 12).
fn level_count(width: u32, height: u32) -> usize {
    let mut count = 1;
    let (mut w, mut h) = (width, height);
    while w > 1 && h > 1 && count < 12 {
        w = w.div_ceil(2);
        h = h.div_ceil(2);
        count += 1;
    }
    count
}

/// A full-size level decoded only to build a smaller one is let go when it
/// is at least this large; drawing it later decodes the image again.
const TRANSIENT_BYTES: usize = 16 << 20;

/// Box-filters a pixmap to half size (premultiplied, so a plain average).
fn halve(src: &Pixmap) -> Option<Pixmap> {
    let (sw, sh) = (src.width(), src.height());
    let (dw, dh) = (sw.div_ceil(2).max(1), sh.div_ceil(2).max(1));
    let mut dst = Pixmap::new(dw, dh)?;
    let s = src.data();
    let stride = sw as usize * 4;
    let d = dst.data_mut();
    for y in 0..dh as usize {
        let y0 = (y * 2).min(sh as usize - 1);
        let y1 = (y * 2 + 1).min(sh as usize - 1);
        for x in 0..dw as usize {
            let x0 = (x * 2).min(sw as usize - 1);
            let x1 = (x * 2 + 1).min(sw as usize - 1);
            for c in 0..4 {
                let sum = u32::from(s[y0 * stride + x0 * 4 + c])
                    + u32::from(s[y0 * stride + x1 * 4 + c])
                    + u32::from(s[y1 * stride + x0 * 4 + c])
                    + u32::from(s[y1 * stride + x1 * 4 + c]);
                d[(y * dw as usize + x) * 4 + c] = ((sum + 2) / 4) as u8;
            }
        }
    }
    Some(dst)
}

/// Decoded images by hash, evicting the least recently drawn levels past a
/// budget.
pub struct ImageStore {
    /// `None` for images that do not decode.
    entries: HashMap<String, Option<Entry>>,
    clock: u64,
    budget: usize,
}

impl Default for ImageStore {
    fn default() -> Self {
        Self::new(256 * 1024 * 1024)
    }
}

impl ImageStore {
    pub fn new(budget: usize) -> Self {
        Self {
            entries: HashMap::new(),
            clock: 0,
            budget,
        }
    }

    /// The entry for `hash`, decoding `encoded` on first use.
    fn entry(&mut self, hash: &str, encoded: Option<&[u8]>) -> Option<&mut Entry> {
        if !self.entries.contains_key(hash) {
            let entry = encoded.and_then(decode).map(|full| {
                let (width, height) = (full.width(), full.height());
                let count = level_count(width, height);
                let mut levels = vec![None; count];
                levels[0] = Some(Arc::new(full));
                Entry {
                    width,
                    height,
                    levels,
                    used: vec![0; count],
                }
            });
            self.entries.insert(hash.to_owned(), entry);
        }
        self.entries.get_mut(hash)?.as_mut()
    }

    /// The image's size in pixels, decoding it on first use; `None` when it
    /// is missing or does not decode.
    pub fn size(&mut self, hash: &str, encoded: Option<&[u8]>) -> Option<(u32, u32)> {
        self.entry(hash, encoded).map(|e| (e.width, e.height))
    }

    /// The level to sample when one image pixel covers `device_per_pixel`
    /// device pixels (a minification factor of its inverse), and that
    /// level's scale relative to the full image.
    pub fn level(
        &mut self,
        hash: &str,
        encoded: Option<&[u8]>,
        device_per_pixel: f64,
    ) -> Option<(Arc<Pixmap>, f64)> {
        self.clock += 1;
        let clock = self.clock;
        let entry = self.entry(hash, encoded)?;
        let mut level = 0usize;
        if device_per_pixel > 0.0 && device_per_pixel < 0.75 {
            level = ((1.0 / device_per_pixel).log2().floor().max(0.0) as usize)
                .min(entry.levels.len() - 1);
        }
        if entry.levels[level].is_none() {
            let finer = (0..level).rev().find(|&k| entry.levels[k].is_some());
            let mut at = match finer {
                Some(k) => k,
                None => {
                    entry.levels[0] = Some(Arc::new(encoded.and_then(decode)?));
                    0
                }
            };
            while at < level {
                let next = halve(entry.levels[at].as_ref()?)?;
                at += 1;
                entry.levels[at] = Some(Arc::new(next));
                entry.used[at] = clock;
            }
            // A large full-size level never drawn itself is let go.
            if level > 0
                && entry.used[0] == 0
                && entry.levels[0]
                    .as_ref()
                    .is_some_and(|p| p.data().len() >= TRANSIENT_BYTES)
            {
                entry.levels[0] = None;
            }
        }
        entry.used[level] = clock;
        let pixmap = entry.levels[level].clone()?;
        let factor = f64::from(pixmap.width()) / f64::from(entry.width);
        self.evict();
        Some((pixmap, factor))
    }

    /// Drops the least recently drawn levels until the store fits its
    /// budget.
    fn evict(&mut self) {
        let mut total: usize = self.entries.values().flatten().map(Entry::bytes).sum();
        while total > self.budget {
            let oldest = self
                .entries
                .iter()
                .filter_map(|(hash, e)| Some((hash, e.as_ref()?)))
                .flat_map(|(hash, e)| {
                    (0..e.levels.len())
                        .filter(|&k| e.levels[k].is_some())
                        .map(move |k| (e.used[k], hash, k))
                })
                .min_by_key(|&(used, _, _)| used)
                .map(|(_, hash, k)| (hash.clone(), k));
            let Some((hash, k)) = oldest else {
                break;
            };
            if let Some(Some(e)) = self.entries.get_mut(&hash)
                && let Some(p) = e.levels[k].take()
            {
                total = total.saturating_sub(p.data().len());
            }
        }
    }
}

/// Largest decoded image side; bigger images are rejected rather than
/// allocating unbounded memory.
const MAX_SIDE: u32 = 16_384;

/// Decodes an image file into a premultiplied pixmap.
pub fn decode(bytes: &[u8]) -> Option<Pixmap> {
    if bytes.starts_with(b"\x89PNG") {
        decode_png(bytes)
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        decode_jpeg(bytes)
    } else if bytes.starts_with(b"GIF8") {
        decode_gif(bytes)
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        decode_webp(bytes)
    } else {
        None
    }
}

fn from_rgba(width: u32, height: u32, mut rgba: Vec<u8>) -> Option<Pixmap> {
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return None;
    }
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return None;
    }
    for px in rgba.chunks_exact_mut(4) {
        let a = u16::from(px[3]);
        if a < 255 {
            px[0] = ((u16::from(px[0]) * a + 127) / 255) as u8;
            px[1] = ((u16::from(px[1]) * a + 127) / 255) as u8;
            px[2] = ((u16::from(px[2]) * a + 127) / 255) as u8;
        }
    }
    Pixmap::from_vec(rgba, IntSize::from_wh(width, height)?)
}

fn decode_png(bytes: &[u8]) -> Option<Pixmap> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let (w, h) = (reader.info().width, reader.info().height);
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
        return None;
    }
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    let channels = match info.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Grayscale => 1,
        png::ColorType::Indexed => return None,
    };
    expand_to_rgba(&mut buf, channels);
    from_rgba(info.width, info.height, buf)
}

/// Widens 1- to 3-channel pixels (gray, gray and alpha, RGB) to RGBA in
/// place, last pixel first, so a large image is not copied.
fn expand_to_rgba(buf: &mut Vec<u8>, channels: usize) {
    if channels == 4 {
        return;
    }
    let pixels = buf.len() / channels;
    buf.resize(pixels * 4, 0);
    for i in (0..pixels).rev() {
        let src = i * channels;
        let px = match channels {
            3 => [buf[src], buf[src + 1], buf[src + 2], 255],
            2 => [buf[src], buf[src], buf[src], buf[src + 1]],
            _ => [buf[src], buf[src], buf[src], 255],
        };
        buf[i * 4..i * 4 + 4].copy_from_slice(&px);
    }
}

fn decode_jpeg(bytes: &[u8]) -> Option<Pixmap> {
    use zune_core::colorspace::ColorSpace;
    use zune_core::options::DecoderOptions;
    let options = DecoderOptions::default()
        .jpeg_set_out_colorspace(ColorSpace::RGBA)
        .set_max_width(MAX_SIDE as usize)
        .set_max_height(MAX_SIDE as usize);
    let mut decoder = zune_jpeg::JpegDecoder::new_with_options(
        zune_core::bytestream::ZCursor::new(bytes),
        options,
    );
    let rgba = decoder.decode().ok()?;
    let (w, h) = decoder.dimensions()?;
    from_rgba(w as u32, h as u32, rgba)
}

fn decode_gif(bytes: &[u8]) -> Option<Pixmap> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = options.read_info(std::io::Cursor::new(bytes)).ok()?;
    let (w, h) = (u32::from(decoder.width()), u32::from(decoder.height()));
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
        return None;
    }
    let frame = decoder.read_next_frame().ok()??;
    // Composite the first frame onto a canvas of the logical screen size.
    let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
    let (fx, fy, fw) = (
        usize::from(frame.left),
        usize::from(frame.top),
        usize::from(frame.width),
    );
    if fw == 0 {
        return from_rgba(w, h, rgba);
    }
    for (row, line) in frame.buffer.chunks_exact(fw * 4).enumerate() {
        let y = fy + row;
        if y >= h as usize {
            break;
        }
        for (col, px) in line.chunks_exact(4).enumerate() {
            let x = fx + col;
            if x >= w as usize {
                break;
            }
            let at = (y * w as usize + x) * 4;
            rgba[at..at + 4].copy_from_slice(px);
        }
    }
    from_rgba(w, h, rgba)
}

fn decode_webp(bytes: &[u8]) -> Option<Pixmap> {
    let mut decoder = image_webp::WebPDecoder::new(std::io::Cursor::new(bytes)).ok()?;
    let (w, h) = decoder.dimensions();
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
        return None;
    }
    let has_alpha = decoder.has_alpha();
    let mut buf = vec![0; decoder.output_buffer_size()?];
    decoder.read_image(&mut buf).ok()?;
    expand_to_rgba(&mut buf, if has_alpha { 4 } else { 3 });
    from_rgba(w, h, buf)
}

/// Encodes a premultiplied pixmap as a PNG (straight alpha).
pub fn encode_png(pixmap: &Pixmap) -> Vec<u8> {
    let mut rgba = pixmap.data().to_vec();
    for px in rgba.chunks_exact_mut(4) {
        let a = u32::from(px[3]);
        if a > 0 && a < 255 {
            px[0] = ((u32::from(px[0]) * 255 + a / 2) / a).min(255) as u8;
            px[1] = ((u32::from(px[1]) * 255 + a / 2) / a).min(255) as u8;
            px[2] = ((u32::from(px[2]) * 255 + a / 2) / a).min(255) as u8;
        }
    }
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, pixmap.width(), pixmap.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let Ok(mut writer) = encoder.write_header() else {
            return Vec::new();
        };
        if writer.write_image_data(&rgba).is_err() {
            return Vec::new();
        }
    }
    out
}

#[cfg(test)]
mod test;
