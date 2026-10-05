//! Opening documents: a file's parts decoded into the model.
//!
//! Records become layers (group dividers become groups), their blocks
//! become typed properties, their channels become RGBA rasters, and the
//! merged image becomes the composite shown wherever nothing was edited.
//! Blocks the engine cannot decode leave the layer showing its stored
//! pixels, and saving keeps them as they were.

pub mod blocks;

use crate::channels;
use crate::codec;
use crate::color;
use crate::error::{PsdError, Result};
use crate::file::{self, LayerRecord, PsdFile};
use crate::model::{
    BlendMode, ColorMode, Composite, Document, Layer, LayerIdx, LayerKind, LayerMask,
};
use crate::raster::{IRect, Raster};
use crate::resources;
use blocks::Divider;
use std::sync::Arc;

/// Decoded pixels allowed by default: about 1.5 GB of RGBA.
pub const DEFAULT_PIXEL_BUDGET: u64 = 1_500_000_000;

/// How to open a document.
#[derive(Clone, Copy, Debug)]
pub struct OpenOptions {
    /// Bytes of decoded pixels allowed; files needing more fail with
    /// [`PsdError::TooLarge`].
    pub pixel_budget: u64,
}

impl Default for OpenOptions {
    fn default() -> Self {
        OpenOptions {
            pixel_budget: DEFAULT_PIXEL_BUDGET,
        }
    }
}

/// An opened document and what could not be read in it.
pub struct Opened {
    /// The document.
    pub document: Document,
    /// Notes on blocks that could not be decoded (their layers show their
    /// stored pixels, and saving keeps the blocks).
    pub warnings: Vec<String>,
}

impl Document {
    /// Opens a `.psd` or `.psb` file.
    pub fn open(bytes: &[u8]) -> Result<Document> {
        open(bytes, OpenOptions::default()).map(|o| o.document)
    }
}

/// Opens a `.psd` or `.psb` file.
pub fn open(bytes: &[u8], options: OpenOptions) -> Result<Opened> {
    let file = file::read(bytes)?;
    from_file(file, options)
}

/// Bytes of pixels a file decodes to (layers, masks, and the merged image).
pub fn pixel_bytes(file: &PsdFile) -> u64 {
    let area = |r: IRect| r.area().max(0) as u64;
    let mut total = u64::from(file.header.width) * u64::from(file.header.height) * 4;
    for record in &file.layers.info.records {
        total += area(record.rect()) * 4;
        if let Some(m) = &record.mask {
            let [t, l, b, r] = m.real.map_or(m.rect, |real| real.rect);
            total += area(IRect::from_ltrb(l, t, r, b));
        }
    }
    total
}

/// Decodes a file's parts into a document.
pub fn from_file(file: PsdFile, options: OpenOptions) -> Result<Opened> {
    let header = file.header;
    let mode = ColorMode::from_code(header.mode)
        .ok_or_else(|| PsdError::Unsupported(format!("color mode {}", header.mode)))?;
    if !matches!(header.depth, 1 | 8 | 16 | 32) {
        return Err(PsdError::Unsupported(format!(
            "{} bits per channel",
            header.depth
        )));
    }
    let needed = pixel_bytes(&file);
    if needed > options.pixel_budget {
        return Err(PsdError::TooLarge(needed / 1_000_000));
    }

    let mut warnings = Vec::new();
    let mut doc = Document::new(header.width, header.height);
    doc.mode = mode;
    doc.depth = header.depth;
    doc.resolution = resources::resolution(&file.resources).unwrap_or(72.0);
    doc.guides = resources::guides(&file.resources);
    let (angle, altitude) = resources::global_light(&file.resources);
    doc.global_angle = angle.map_or(120.0, |a| a as f32);
    doc.global_altitude = altitude.map_or(30.0, |a| a as f32);
    let large = header.is_psb();
    for key in [b"Patt", b"Pat2", b"Pat3"] {
        if let Some(block) = file.layers.block(key) {
            match codec::pattern::decode(&block.data, large) {
                Ok(p) => doc.patterns.extend(p),
                Err(e) => warnings.push(format!("patterns: {e}")),
            }
        }
    }

    build_layers(&mut doc, &file, &mut warnings);

    if resources::has_real_merged_data(&file.resources) != Some(false) {
        match decode_composite(&file, mode) {
            Ok(raster) => {
                doc.composite = Some(Composite {
                    raster,
                    stale: Vec::new(),
                })
            }
            Err(e) => warnings.push(format!("merged image: {e}")),
        }
    }
    // A flat file (no layer records) edits as its Background layer.
    if doc.roots.is_empty()
        && let Some(composite) = &doc.composite
    {
        let mut bg = Layer::new(1, "Background");
        bg.edits = 0;
        bg.background = true;
        bg.locks.position = true;
        bg.pixels = composite.raster.clone();
        let i = doc.push_layer(bg);
        doc.roots.push(i);
    }
    doc.next_id = doc.layers.iter().map(|l| l.id).max().unwrap_or(0) + 1;
    doc.source = Some(Arc::new(file));
    Ok(Opened {
        document: doc,
        warnings,
    })
}

/// Records become layers, bottom to top; a group's record comes after its
/// children, which start after the record ending the group.
fn build_layers(doc: &mut Document, file: &PsdFile, warnings: &mut Vec<String>) {
    let records = &file.layers.info.records;
    let mut stacks: Vec<Vec<LayerIdx>> = vec![Vec::new()];
    let mut ids = std::collections::HashSet::new();
    let mut next_free = records
        .iter()
        .filter_map(blocks::layer_id)
        .max()
        .unwrap_or(0)
        + 1;
    for (index, record) in records.iter().enumerate() {
        let (divider, group_blend) = blocks::divider(record);
        if divider == Divider::End {
            stacks.push(Vec::new());
            continue;
        }
        let id = match blocks::layer_id(record) {
            Some(id) if id != 0 && ids.insert(id) => id,
            _ => {
                let id = next_free;
                next_free += 1;
                ids.insert(id);
                id
            }
        };
        let mut layer = decode_record(doc, file, index, record, id, warnings);
        if let Divider::Group { open } = divider {
            layer.kind = LayerKind::Group { open };
            if let Some(blend) = group_blend {
                layer.blend = blend;
            }
            layer.pixels = Raster::rgba();
            let i = doc.push_layer(layer);
            // The children since the matching end record; an unmatched
            // group record keeps none.
            let children = if stacks.len() > 1 {
                stacks.pop().unwrap_or_default()
            } else {
                Vec::new()
            };
            for &c in &children {
                doc.layers[c as usize].parent = Some(i);
            }
            doc.layers[i as usize].children = children;
            stacks.last_mut().expect("the top level").push(i);
        } else {
            let i = doc.push_layer(layer);
            stacks.last_mut().expect("the top level").push(i);
        }
    }
    // Groups left open by a damaged file close at the top level.
    while stacks.len() > 1 {
        let orphans = stacks.pop().unwrap_or_default();
        stacks[0].extend(orphans);
    }
    doc.roots = stacks.pop().unwrap_or_default();
    for &i in &doc.roots {
        doc.layers[i as usize].parent = None;
    }
    // The bottom layer without transparency is the Background.
    if let Some(&bottom) = doc.roots.first() {
        let record = doc.layers[bottom as usize]
            .record
            .and_then(|r| records.get(r as usize));
        let l = &mut doc.layers[bottom as usize];
        if matches!(l.kind, LayerKind::Pixel)
            && record.is_some_and(|r| r.channel(-1).is_none() && !r.rect().is_empty())
        {
            l.background = true;
        }
    }
}

/// Channel ids of the color channels layers have in a mode.
fn color_ids(mode: ColorMode) -> Vec<i16> {
    (0..mode.color_channels() as i16).collect()
}

fn decode_record(
    doc: &Document,
    file: &PsdFile,
    index: usize,
    record: &LayerRecord,
    id: u32,
    warnings: &mut Vec<String>,
) -> Layer {
    let header = file.header;
    let large = header.is_psb();
    let mut layer = Layer::new(id, blocks::name(record));
    layer.edits = 0;
    layer.record = Some(index as u32);
    layer.visible = record.flags & 0x02 == 0;
    layer.opacity = record.opacity;
    layer.clipping = record.clipping != 0;
    layer.blend = BlendMode::from_key(&record.blend).unwrap_or(BlendMode::Normal);
    layer.fill_opacity = blocks::byte_setting(record, b"iOpa").unwrap_or(255);
    layer.locks = blocks::locks(record);
    layer.color_tag = blocks::color_tag(record);
    layer.blend_clipped_as_group = blocks::byte_setting(record, b"clbl").is_none_or(|v| v != 0);
    layer.blend_interior_as_group = blocks::byte_setting(record, b"infx").is_some_and(|v| v != 0);
    layer.knockout = blocks::byte_setting(record, b"knko").unwrap_or(0);
    layer.transparency_shapes = blocks::byte_setting(record, b"tsly").is_none_or(|v| v != 0);
    layer.mask_hides_effects = blocks::byte_setting(record, b"lmgm").is_some_and(|v| v != 0);
    layer.vector_mask_hides_effects = blocks::byte_setting(record, b"vmgm").is_some_and(|v| v != 0);
    layer.blend_ranges = blocks::blend_ranges(record);

    let mut warn = |what: &str, e: PsdError| {
        warnings.push(format!("layer \"{}\": {what}: {e}", layer_name(record)));
    };

    layer.kind = decode_kind(record, &mut warn);

    if layer.kind.has_pixels() {
        match decode_pixels(file, record, doc.mode) {
            Ok(pixels) => layer.pixels = pixels,
            Err(e) => warn("pixels", e),
        }
    }
    match decode_mask(file, record) {
        Ok(mask) => layer.mask = mask,
        Err(e) => warn("mask", e),
    }
    if let Some(block) = record.block(b"vsms").or_else(|| record.block(b"vmsk")) {
        match codec::vector::decode(&block.data, header.width, header.height) {
            Ok(mask) => layer.vector_mask = Some(mask),
            Err(e) => warn("vector mask", e),
        }
    }
    let data = |key: &[u8; 4]| record.block(key).map(|b| &b.data[..]);
    if data(b"lfx2").is_some() || data(b"lmfx").is_some() || data(b"lrFX").is_some() {
        match codec::effects::decode(data(b"lfx2"), data(b"lmfx"), data(b"lrFX")) {
            Ok(effects) => layer.effects = effects,
            Err(e) => warn("effects", e),
        }
    }
    let _ = large;
    layer
}

fn layer_name(record: &LayerRecord) -> String {
    blocks::name(record)
}

/// What a record is, from its blocks.
fn decode_kind(record: &LayerRecord, warn: &mut dyn FnMut(&str, PsdError)) -> LayerKind {
    if let Some(block) = record.block(b"TySh") {
        match codec::text::decode(&block.data) {
            Ok(text) => {
                return LayerKind::Text {
                    text: Box::new(text),
                };
            }
            Err(e) => warn("text", e),
        }
    }
    let fill = match record.block(b"vscg") {
        // Newer shape layers: the fill's key, then its block data.
        Some(b) if b.data.len() > 4 => {
            let mut key = [0u8; 4];
            key.copy_from_slice(&b.data[..4]);
            Some((key, &b.data[4..]))
        }
        _ => codec::fill::KEYS
            .iter()
            .find_map(|k| record.block(k).map(|b| (*k, &b.data[..]))),
    };
    if let Some((key, data)) = fill {
        match codec::fill::decode(&key, data) {
            Ok(fill) => {
                let stroke = match record.block(b"vstk") {
                    Some(b) => match codec::fill::decode_stroke(&b.data) {
                        Ok(s) => Some(Box::new(s)),
                        Err(e) => {
                            warn("shape stroke", e);
                            None
                        }
                    },
                    None => None,
                };
                return LayerKind::Fill { fill, stroke };
            }
            Err(e) => warn("fill", e),
        }
    }
    // An adjustment's own block comes first; a `CgEd` after another
    // adjustment's block only names its preset. Brightness/Contrast layers
    // carry `brit` and the newer `CgEd`, which holds the modern settings.
    let adjustment = record
        .tagged
        .iter()
        .find(|b| codec::adjustment::is_adjustment_key(&b.key))
        .map(|first| match &first.key {
            b"brit" => record.block(b"CgEd").unwrap_or(first),
            _ => first,
        });
    if let Some(block) = adjustment {
        match codec::adjustment::decode(&block.key, &block.data) {
            Ok(adjustment) => {
                return LayerKind::Adjustment {
                    adjustment: Box::new(adjustment),
                };
            }
            Err(e) => warn("adjustment", e),
        }
    }
    if let Some(block) = record.block(b"SoLd").or_else(|| record.block(b"PlLd")) {
        match codec::smart::decode(&block.key, &block.data) {
            Ok(object) => {
                return LayerKind::SmartObject {
                    object: Box::new(object),
                };
            }
            Err(e) => warn("smart object", e),
        }
    }
    LayerKind::Pixel
}

/// A record's color and transparency channels as an RGBA raster placed at
/// its rectangle.
fn decode_pixels(file: &PsdFile, record: &LayerRecord, mode: ColorMode) -> Result<Raster> {
    let rect = record.rect();
    if rect.is_empty() {
        return Ok(Raster::rgba());
    }
    let header = file.header;
    let (w, h) = (rect.w as u32, rect.h as u32);
    let decode = |id: i16| -> Result<Option<Vec<u8>>> {
        match record.channel(id) {
            Some(c) => channels::decode_channel(c, w, h, header.depth, header.is_psb()).map(Some),
            None => Ok(None),
        }
    };
    let mut planes = Vec::new();
    for id in color_ids(mode) {
        match decode(id)? {
            Some(p) => planes.push(p),
            // A missing color channel reads as empty (black, or no ink).
            None => planes.push(vec![0; channels::row_bytes(w, header.depth) * h as usize]),
        }
    }
    let alpha = decode(-1)?;
    let color: Vec<&[u8]> = planes.iter().map(Vec::as_slice).collect();
    let rgba = color::to_rgba(
        mode,
        header.depth,
        w,
        h,
        &color,
        alpha.as_deref(),
        &file.color_mode_data,
    );
    Ok(Raster::from_region(4, rect, &rgba))
}

/// A record's pixel mask (`-2`, or `-3` when the layer also has a vector
/// mask, whose rendering `-2` then holds).
fn decode_mask(file: &PsdFile, record: &LayerRecord) -> Result<Option<LayerMask>> {
    let Some(data) = &record.mask else {
        return Ok(None);
    };
    let (rect, default_color, flags, channel) = match data.real {
        Some(real) => (real.rect, real.default_color, real.flags, -3),
        // A mask rendered from other data (the vector mask) is not a pixel
        // mask of its own.
        None if data.flags & 0x08 != 0 => return Ok(None),
        None => (data.rect, data.default_color, data.flags, -2),
    };
    let [top, left, bottom, right] = rect;
    let rect = IRect::from_ltrb(left, top, right, bottom);
    let mut raster = Raster::gray();
    raster.set_origin((rect.x, rect.y));
    if !rect.is_empty()
        && let Some(c) = record.channel(channel)
    {
        let header = file.header;
        let (w, h) = (rect.w as u32, rect.h as u32);
        let samples = channels::decode_channel(c, w, h, header.depth, header.is_psb())?;
        let gray = color::to_gray(header.depth, w, h, &samples);
        raster.write(rect, &gray);
    }
    let params = data.params.unwrap_or_default();
    Ok(Some(LayerMask {
        raster,
        rect,
        default_color,
        disabled: flags & 0x02 != 0,
        linked: true,
        density: params.user_density.map_or(1.0, |d| f32::from(d) / 255.0),
        feather: params.user_feather.unwrap_or(0.0) as f32,
        generation: 0,
    }))
}

/// The merged image as RGBA (its transparency from the first alpha channel
/// when the file says the merged image has one).
fn decode_composite(file: &PsdFile, mode: ColorMode) -> Result<Raster> {
    let header = file.header;
    let planes = channels::decode_image(&file.image, &header)?;
    let n = mode.color_channels();
    if planes.len() < n {
        return Err(PsdError::corrupt("merged image is missing channels"));
    }
    let color: Vec<&[u8]> = planes[..n].iter().map(Vec::as_slice).collect();
    let alpha = if file.layers.info.merged_alpha {
        planes.get(n).map(Vec::as_slice)
    } else {
        None
    };
    let rgba = color::to_rgba(
        mode,
        header.depth,
        header.width,
        header.height,
        &color,
        alpha,
        &file.color_mode_data,
    );
    let rect = IRect::new(0, 0, header.width as i32, header.height as i32);
    Ok(Raster::from_region(4, rect, &rgba))
}

#[cfg(test)]
mod test;
