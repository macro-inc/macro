//! Decoded images, kept between draws (with halved copies for drawing
//! small), within a memory budget.

use super::canvas::premultiplied;
use crate::model::{Document, ImageSource, Node};
use crate::pdf::{Object, Resolve, Stream};
use std::collections::HashMap;
use std::sync::Arc;
use tiny_skia::Pixmap;

/// Bytes of decoded pixels kept.
#[cfg(target_arch = "wasm32")]
const BUDGET: usize = 192 << 20;
#[cfg(not(target_arch = "wasm32"))]
const BUDGET: usize = 512 << 20;

/// Halvings at most.
const MAX_LEVEL: u8 = 8;

struct Entry {
    pixmap: Arc<Pixmap>,
    used: u64,
}

/// Decoded images by key and level.
#[derive(Default)]
pub struct ImageCache {
    entries: HashMap<(String, u8), Entry>,
    bytes: usize,
    tick: u64,
}

impl ImageCache {
    /// Forgets everything.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.bytes = 0;
    }

    /// An image node's pixels, halved while it shows at under half a
    /// pixel per sample (`shown` is pixels across and down for the whole
    /// image).
    pub fn get(
        &mut self,
        doc: &Document,
        n: &Node,
        source: &ImageSource,
        shown: (f64, f64),
    ) -> Option<Arc<Pixmap>> {
        let key = match source {
            ImageSource::File { key } => key.clone(),
            ImageSource::Added { hash } => format!("added:{hash}"),
        };
        let full = self.lookup(&key, 0).or_else(|| {
            let pixmap = match source {
                ImageSource::Added { hash } => {
                    let img = doc.images.get(hash)?;
                    premultiplied(img.width, img.height, &img.rgba)?
                }
                ImageSource::File { .. } => {
                    let file = doc.file.as_ref()?;
                    let src = n.source.as_ref()?;
                    let resources = file.resources(src.resources);
                    let stream = image_stream(&file.pdf, src.ops.first()?, resources)?;
                    decode(&file.pdf, &stream, resources, [0.0, 0.0, 0.0, 1.0])?
                }
            };
            Some(self.insert(key.clone(), 0, pixmap))
        })?;
        self.level(&key, full, shown)
    }

    /// Pixels of an image stream drawn by raw content, by key (`None` key:
    /// not kept, for stencil masks whose color varies).
    pub fn get_stream(
        &mut self,
        pdf: &dyn Resolve,
        key: Option<&str>,
        stream: &Stream,
        resources: &crate::pdf::Dict,
        fill: [f32; 4],
        shown: (f64, f64),
    ) -> Option<Arc<Pixmap>> {
        let Some(key) = key else {
            return decode(pdf, stream, resources, fill).map(Arc::new);
        };
        let full = match self.lookup(key, 0) {
            Some(p) => p,
            None => {
                let p = decode(pdf, stream, resources, fill)?;
                self.insert(key.to_string(), 0, p)
            }
        };
        self.level(key, full, shown)
    }

    fn lookup(&mut self, key: &str, level: u8) -> Option<Arc<Pixmap>> {
        self.tick += 1;
        let tick = self.tick;
        let e = self.entries.get_mut(&(key.to_string(), level))?;
        e.used = tick;
        Some(e.pixmap.clone())
    }

    fn insert(&mut self, key: String, level: u8, pixmap: Pixmap) -> Arc<Pixmap> {
        let size = pixmap.data().len();
        while self.bytes + size > BUDGET && !self.entries.is_empty() {
            // Drop the least recently used.
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.used)
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest
                && let Some(e) = self.entries.remove(&k)
            {
                self.bytes -= e.pixmap.data().len();
            }
        }
        let pixmap = Arc::new(pixmap);
        self.tick += 1;
        self.bytes += size;
        self.entries.insert(
            (key, level),
            Entry {
                pixmap: pixmap.clone(),
                used: self.tick,
            },
        );
        pixmap
    }

    /// The copy halved enough for showing at `shown` pixels.
    fn level(&mut self, key: &str, full: Arc<Pixmap>, shown: (f64, f64)) -> Option<Arc<Pixmap>> {
        let ratio = (f64::from(full.width()) / shown.0.max(1e-9))
            .min(f64::from(full.height()) / shown.1.max(1e-9));
        if ratio < 2.0 {
            return Some(full);
        }
        let want = (ratio.log2().floor() as u8).min(MAX_LEVEL);
        let mut level = 0;
        let mut current = full;
        while level < want {
            level += 1;
            current = match self.lookup(key, level) {
                Some(p) => p,
                None => match halve(&current) {
                    Some(h) => self.insert(key.to_string(), level, h),
                    None => return Some(current),
                },
            };
        }
        Some(current)
    }
}

/// The image stream a `Do` or inline image operator draws.
pub fn image_stream(
    pdf: &dyn Resolve,
    op: &crate::pdf::content::Op,
    resources: &crate::pdf::Dict,
) -> Option<Stream> {
    if let Some(inline) = &op.inline_image {
        let dict = crate::image::expand_inline(&inline.dict);
        return Some(Stream::new(dict, inline.data.clone()));
    }
    if !op.is("Do") {
        return None;
    }
    let name = op.operands.first()?.as_name()?;
    let xobjects = pdf.resolve(resources.get("XObject")?);
    let value = xobjects
        .as_dict()?
        .iter()
        .find(|(k, _)| k.as_bytes() == name.as_bytes())
        .map(|(_, v)| v.clone())?;
    match pdf.resolve(&value) {
        Object::Stream(s) => Some(s),
        _ => None,
    }
}

/// Decodes an image to a premultiplied pixmap.
fn decode(
    pdf: &dyn Resolve,
    stream: &Stream,
    resources: &crate::pdf::Dict,
    fill: [f32; 4],
) -> Option<Pixmap> {
    let img = crate::image::decode(pdf, stream, resources, fill).ok()?;
    premultiplied(img.width, img.height, &img.rgba)
}

/// A pixmap at half the size (2×2 averaged).
fn halve(p: &Pixmap) -> Option<Pixmap> {
    let (w, h) = (p.width(), p.height());
    let (nw, nh) = (w.div_ceil(2).max(1), h.div_ceil(2).max(1));
    let mut out = Pixmap::new(nw, nh)?;
    let src = p.data();
    let dst = out.data_mut();
    for y in 0..nh {
        for x in 0..nw {
            let mut sum = [0u32; 4];
            let mut n = 0;
            for dy in 0..2 {
                for dx in 0..2 {
                    let (sx, sy) = (x * 2 + dx, y * 2 + dy);
                    if sx < w && sy < h {
                        let i = ((sy * w + sx) * 4) as usize;
                        for c in 0..4 {
                            sum[c] += u32::from(src[i + c]);
                        }
                        n += 1;
                    }
                }
            }
            let o = ((y * nw + x) * 4) as usize;
            for c in 0..4 {
                dst[o + c] = (sum[c] / n.max(1)) as u8;
            }
        }
    }
    Some(out)
}
