//! Saving: the document written back as a file.
//!
//! Saving starts from the opened file. An unedited document writes back
//! byte for byte. Otherwise every unedited layer keeps its record and
//! channel data exactly; an edited layer's record is patched where its edit
//! flags say (the other blocks it has, even ones the engine does not model,
//! stay); new layers get fresh records; and the merged image and thumbnail
//! are rendered again, so other applications see the edits.

mod record;

use crate::channels;
use crate::color;
use crate::document::blocks::{self, Divider};
use crate::error::{PsdError, Result};
use crate::file::{
    self, Compression, Header, ImageData, LayerInfo, LayerRecord, LayerSection, PsdFile, Resource,
};
use crate::model::{ColorMode, Document, LayerIdx, flags};
use crate::raster::IRect;
use crate::render::Renderer;
use crate::resources;
use std::collections::HashMap;

/// Longest side of the thumbnail Photoshop shows in file browsers.
const THUMBNAIL_SIDE: u32 = 160;

/// Whether nothing changed since the file was opened.
fn unedited(doc: &Document) -> bool {
    doc.edits == 0 && doc.layers.iter().all(|l| l.edits == 0 && !l.removed)
}

/// Writes the document as `.psd` (or `.psb` when the file was one or the
/// canvas needs it).
pub fn save(doc: &Document, renderer: &mut Renderer) -> Result<Vec<u8>> {
    Ok(file::write(&to_file(doc, renderer)?))
}

/// The file the document saves as.
pub fn to_file(doc: &Document, renderer: &mut Renderer) -> Result<PsdFile> {
    if let Some(source) = &doc.source
        && unedited(doc)
    {
        return Ok((**source).clone());
    }
    let source = doc.source.as_deref();
    let large =
        source.is_some_and(|s| s.header.is_psb()) || doc.width > 30_000 || doc.height > 30_000;
    let mut header = Header {
        version: if large { 2 } else { 1 },
        channels: 0,
        height: doc.height,
        width: doc.width,
        depth: doc.depth,
        mode: doc.mode.code(),
    };
    let records = layer_records(doc, &header)?;

    // The merged image.
    let canvas = doc.bounds();
    let rgba = renderer.render(doc, canvas, 0);
    let (image, channels, merged_alpha) = merged_image(doc, source, &header, &rgba)?;
    header.channels = channels;

    let mut resources = source.map(|s| s.resources.clone()).unwrap_or_default();
    if source.is_none() || doc.edits & flags::DOC_RESOLUTION != 0 {
        resources::set_resolution(&mut resources, doc.resolution);
    }
    if doc.edits & flags::DOC_GUIDES != 0 {
        resources::set_guides(&mut resources, &doc.guides);
    }
    if doc.edits & flags::DOC_LAYERS != 0 {
        // Per-layer resources would no longer line up with the records.
        resources.retain(|r| !matches!(r.id, 1024 | 1026 | 1072));
    }
    set_real_merged_data(&mut resources);
    resources::set_thumbnail(&mut resources, &thumbnail(doc, &rgba));

    let mut layers = source.map(|s| s.layers.clone()).unwrap_or_default();
    layers.info = LayerInfo {
        merged_alpha,
        records,
    };
    if source.is_none() && doc.depth > 8 {
        // High-bit documents keep their layers in a document-level block.
        let key = if doc.depth == 16 { *b"Lr16" } else { *b"Lr32" };
        layers.info_key = Some(key);
        layers.tagged.push(file::TaggedBlock::new(&key, Vec::new()));
    }
    if source.is_none() {
        layers.global_mask = Some(Vec::new());
    }
    let color_mode_data = match source {
        Some(s) if s.header.mode == header.mode => s.color_mode_data.clone(),
        _ => Vec::new(),
    };
    Ok(PsdFile {
        header,
        color_mode_data,
        resources,
        layers: LayerSection { ..layers },
        image,
    })
}

/// Group records by their end record, in a source file.
fn end_records(source: &PsdFile) -> HashMap<u32, u32> {
    let mut stack = Vec::new();
    let mut out = HashMap::new();
    for (i, r) in source.layers.info.records.iter().enumerate() {
        match blocks::divider(r).0 {
            Divider::End => stack.push(i as u32),
            Divider::Group { .. } => {
                if let Some(end) = stack.pop() {
                    out.insert(i as u32, end);
                }
            }
            Divider::Layer => {}
        }
    }
    out
}

/// Records for every live layer, bottom to top; a group's end record, then
/// its children, then its own record.
fn layer_records(doc: &Document, header: &Header) -> Result<Vec<LayerRecord>> {
    let ends = doc.source.as_deref().map(end_records).unwrap_or_default();
    let color = doc.mode.color_channels();
    let mut out = Vec::new();
    let mut ids = std::collections::HashSet::new();
    fn walk(
        doc: &Document,
        header: &Header,
        stack: &[LayerIdx],
        ends: &HashMap<u32, u32>,
        color: usize,
        ids: &mut std::collections::HashSet<u32>,
        out: &mut Vec<LayerRecord>,
    ) -> Result<()> {
        for &i in stack {
            let layer = doc.layer(i);
            if layer.removed {
                continue;
            }
            if !ids.insert(layer.id) {
                return Err(PsdError::invalid(format!(
                    "two layers share id {}",
                    layer.id
                )));
            }
            if layer.is_group() {
                let end = layer
                    .record
                    .filter(|_| layer.edits & crate::model::flags::CREATED == 0)
                    .and_then(|r| ends.get(&r))
                    .and_then(|&e| {
                        doc.source
                            .as_ref()?
                            .layers
                            .info
                            .records
                            .get(e as usize)
                            .cloned()
                    })
                    .unwrap_or_else(|| record::end_record(color));
                out.push(end);
                walk(doc, header, &layer.children, ends, color, ids, out)?;
            }
            out.push(record::layer_record(doc, header, layer)?);
        }
        Ok(())
    }
    walk(doc, header, &doc.roots, &ends, color, &mut ids, &mut out)?;
    Ok(out)
}

/// The merged image in the document's mode: its data, the header's
/// channel count, and whether its first alpha channel is transparency.
fn merged_image(
    doc: &Document,
    source: Option<&PsdFile>,
    header: &Header,
    rgba: &[u8],
) -> Result<(ImageData, u16, bool)> {
    let canvas_kept = source.is_some_and(|s| {
        s.header.width == doc.width
            && s.header.height == doc.height
            && s.header.mode == header.mode
            && s.header.depth == header.depth
    });
    if !matches!(doc.mode, ColorMode::Rgb | ColorMode::Grayscale) {
        // Other modes keep the merged image they were opened with.
        let s = source.filter(|_| canvas_kept).ok_or_else(|| {
            PsdError::Unsupported("convert the document to RGB before resizing it".into())
        })?;
        return Ok((
            s.image.clone(),
            s.header.channels,
            s.layers.info.merged_alpha,
        ));
    }
    let (w, h) = (doc.width, doc.height);
    let transparent = rgba.chunks_exact(4).any(|p| p[3] != 255);
    // Photoshop stores the colors of a merged image with transparency
    // blended over white.
    let matted;
    let rgba = if transparent {
        let mut copy = rgba.to_vec();
        color::matte_white(&mut copy);
        matted = copy;
        &matted[..]
    } else {
        rgba
    };
    let mut planes = color::from_rgba(doc.mode, header.depth, w, h, rgba);
    let color_count = doc.mode.color_channels();
    if !transparent {
        planes.truncate(color_count);
    }
    // Alpha and spot channels the file had stay when the canvas did.
    if let Some(s) = source.filter(|_| canvas_kept) {
        let had_alpha = usize::from(s.layers.info.merged_alpha);
        let extra_from = color_count + had_alpha;
        if usize::from(s.header.channels) > extra_from
            && let Ok(old) = channels::decode_image(&s.image, &s.header)
        {
            planes.extend(old.into_iter().skip(extra_from));
        }
    }
    let count = planes.len() as u16;
    let image = channels::encode_image(
        &planes,
        &Header {
            channels: count,
            ..*header
        },
        Compression::Rle,
    );
    Ok((image, count, transparent))
}

/// Says the merged image is real (version info, 1057), as Photoshop does
/// with Maximize Compatibility.
fn set_real_merged_data(resources: &mut Vec<Resource>) {
    if let Some(r) = resources.iter_mut().find(|r| r.id == 1057) {
        if r.data.len() > 4 {
            r.data[4] = 1;
        }
        return;
    }
    let mut w = crate::binary::Writer::new();
    w.u32(1);
    w.u8(1);
    w.unicode("Adobe Photoshop");
    w.unicode("Adobe Photoshop");
    w.u32(1);
    resources.push(Resource::new(1057, w.into_bytes()));
}

/// A JPEG thumbnail of the merged image over white.
fn thumbnail(doc: &Document, rgba: &[u8]) -> resources::Thumbnail {
    let (w, h) = (doc.width.max(1), doc.height.max(1));
    let scale = (THUMBNAIL_SIDE as f32 / w.max(h) as f32).min(1.0);
    let (tw, th) = (
        ((w as f32 * scale).round() as u32).max(1),
        ((h as f32 * scale).round() as u32).max(1),
    );
    let mut out = vec![0u8; (tw * th * 4) as usize];
    // Box-average the pixels each thumbnail pixel covers.
    for ty in 0..th {
        let y0 = (ty as u64 * h as u64 / th as u64) as u32;
        let y1 = (((ty + 1) as u64 * h as u64).div_ceil(th as u64) as u32)
            .max(y0 + 1)
            .min(h);
        for tx in 0..tw {
            let x0 = (tx as u64 * w as u64 / tw as u64) as u32;
            let x1 = (((tx + 1) as u64 * w as u64).div_ceil(tw as u64) as u32)
                .max(x0 + 1)
                .min(w);
            let mut sum = [0u64; 3];
            let mut n = 0u64;
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = ((y * w + x) * 4) as usize;
                    let a = u64::from(rgba[i + 3]);
                    for c in 0..3 {
                        sum[c] += (u64::from(rgba[i + c]) * a + 255 * (255 - a)) / 255;
                    }
                    n += 1;
                }
            }
            let o = ((ty * tw + tx) * 4) as usize;
            for c in 0..3 {
                out[o + c] = (sum[c] / n.max(1)) as u8;
            }
            out[o + 3] = 255;
        }
    }
    resources::Thumbnail {
        width: tw,
        height: th,
        jpeg: fig_engine::export::jpeg::encode(&out, tw, th, 85),
    }
}

/// A new document: a white Background, or one transparent layer.
pub fn blank(width: u32, height: u32, white_background: bool) -> Document {
    let mut doc = Document::new(width.max(1), height.max(1));
    let mut layer = crate::model::Layer::new(
        doc.allocate_id(),
        if white_background {
            "Background"
        } else {
            "Layer 1"
        },
    );
    if white_background {
        let canvas = doc.bounds();
        layer.pixels =
            crate::raster::Raster::from_region(4, canvas, &vec![255; canvas.area() as usize * 4]);
        layer.background = true;
        layer.locks.position = true;
    }
    let i = doc.push_layer(layer);
    doc.roots.push(i);
    doc.edits = flags::DOC_LAYERS | flags::DOC_RESOLUTION;
    doc
}

/// The bytes of a new document.
pub fn blank_file(width: u32, height: u32, white_background: bool) -> Result<Vec<u8>> {
    let doc = blank(width, height, white_background);
    save(&doc, &mut Renderer::new())
}

/// Every canvas rectangle unaffected by a save (for callers comparing a
/// saved file's merged image with the document).
pub fn canvas(doc: &Document) -> IRect {
    doc.bounds()
}

#[cfg(test)]
mod test;
