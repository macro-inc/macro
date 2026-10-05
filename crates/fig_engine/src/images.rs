//! Image fills: decoding (PNG, JPEG, GIF, WebP) into premultiplied pixmaps,
//! mip levels for drawing large images small, and a memory budget.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tiny_skia::{IntSize, Pixmap};

/// One decoded image with lazily built half-size levels.
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    levels: Vec<OnceLock<Option<Arc<Pixmap>>>>,
}

impl DecodedImage {
    fn new(full: Pixmap) -> Self {
        let (width, height) = (full.width(), full.height());
        let mut count = 1;
        let (mut w, mut h) = (width, height);
        while w > 1 && h > 1 && count < 12 {
            w = w.div_ceil(2);
            h = h.div_ceil(2);
            count += 1;
        }
        let levels: Vec<OnceLock<Option<Arc<Pixmap>>>> =
            (0..count).map(|_| OnceLock::new()).collect();
        let _ = levels[0].set(Some(Arc::new(full)));
        Self {
            width,
            height,
            levels,
        }
    }

    /// The level to sample when one image pixel covers `device_per_pixel`
    /// device pixels (a minification factor of its inverse), and that
    /// level's scale relative to the full image.
    pub fn level_for(&self, device_per_pixel: f64) -> Option<(Arc<Pixmap>, f64)> {
        let mut level = 0usize;
        if device_per_pixel > 0.0 && device_per_pixel < 0.75 {
            level = ((1.0 / device_per_pixel).log2().floor().max(0.0) as usize)
                .min(self.levels.len() - 1);
        }
        let pixmap = self.level(level)?;
        let factor = f64::from(pixmap.width()) / f64::from(self.width);
        Some((pixmap, factor))
    }

    fn level(&self, level: usize) -> Option<Arc<Pixmap>> {
        if level == 0 {
            return self.levels[0].get().cloned().flatten();
        }
        self.levels[level]
            .get_or_init(|| {
                let parent = self.level(level - 1)?;
                halve(&parent).map(Arc::new)
            })
            .clone()
    }

    fn bytes(&self) -> usize {
        self.levels
            .iter()
            .filter_map(|l| l.get().cloned().flatten())
            .map(|p| p.data().len())
            .sum()
    }
}

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

/// Decoded images by hash, evicting the least recently used past a budget.
pub struct ImageStore {
    entries: HashMap<String, (Option<Arc<DecodedImage>>, u64)>,
    clock: u64,
    budget: usize,
}

impl Default for ImageStore {
    fn default() -> Self {
        Self::new(384 * 1024 * 1024)
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

    /// The decoded image for `hash`, decoding `encoded` on first use.
    pub fn get(&mut self, hash: &str, encoded: Option<&[u8]>) -> Option<Arc<DecodedImage>> {
        self.clock += 1;
        let clock = self.clock;
        if let Some(entry) = self.entries.get_mut(hash) {
            entry.1 = clock;
            return entry.0.clone();
        }
        let decoded = encoded
            .and_then(decode)
            .map(|p| Arc::new(DecodedImage::new(p)));
        self.entries
            .insert(hash.to_owned(), (decoded.clone(), clock));
        self.evict();
        decoded
    }

    /// Forgets `hash` (an image that was missing may have arrived).
    pub fn forget(&mut self, hash: &str) {
        self.entries.remove(hash);
    }

    fn evict(&mut self) {
        let mut total: usize = self
            .entries
            .values()
            .filter_map(|(img, _)| img.as_ref())
            .map(|img| img.bytes())
            .sum();
        while total > self.budget && self.entries.len() > 1 {
            let Some(oldest) = self
                .entries
                .iter()
                .filter(|(_, (img, _))| img.is_some())
                .min_by_key(|(_, (_, used))| *used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some((Some(img), _)) = self.entries.remove(&oldest) {
                total = total.saturating_sub(img.bytes());
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
    let data = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => data
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return None,
    };
    from_rgba(info.width, info.height, rgba)
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
    let rgba = if has_alpha {
        buf
    } else {
        buf.chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect()
    };
    from_rgba(w, h, rgba)
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
