//! Layer records for saving: an unedited layer's record as it was, an
//! edited one patched field by field, a new one built from scratch.

use crate::binary::to_mac_roman;
use crate::channels;
use crate::codec;
use crate::color;
use crate::document::blocks::{self, Divider};
use crate::error::{PsdError, Result};
use crate::file::{Channel, Compression, Header, LayerRecord, MaskData, MaskParams};
use crate::model::{ColorMode, Document, Layer, LayerKind, flags};
use crate::raster::IRect;

/// A record with no pixels: `-1` and the color channels, empty.
fn empty_channels(color: usize) -> Vec<Channel> {
    std::iter::once(-1)
        .chain(0..color as i16)
        .map(|id| Channel {
            id,
            compression: Compression::Raw,
            bytes: Vec::new(),
        })
        .collect()
}

/// A fresh record for a layer with no record to start from.
fn blank_record(color: usize) -> LayerRecord {
    LayerRecord {
        rect: [0; 4],
        channels: empty_channels(color),
        blend: *b"norm",
        opacity: 255,
        clipping: 0,
        // Bit 3: bit 4 is meaningful (Photoshop 5 and later).
        flags: 0x08,
        filler: 0,
        mask: None,
        blend_ranges: Vec::new(),
        name: Vec::new(),
        tagged: Vec::new(),
        extra_tail: Vec::new(),
        name_padding: 0,
    }
}

/// The record that ends a group (below its children).
pub(super) fn end_record(color: usize) -> LayerRecord {
    let mut r = blank_record(color);
    r.name = b"</Layer group>".to_vec();
    r.flags = 0x18;
    r.set_block(
        b"lsct",
        blocks::divider_data(Divider::End, crate::model::BlendMode::Normal),
    );
    r
}

/// Keys of the blocks a layer kind is made of.
const KIND_KEYS: [&[u8; 4]; 9] = [
    b"TySh", b"SoCo", b"GdFl", b"PtFl", b"vscg", b"vstk", b"SoLd", b"PlLd", b"vogk",
];

fn rect_of(r: IRect) -> [i32; 4] {
    [r.y, r.x, r.bottom(), r.right()]
}

/// Encodes a layer's pixels as its channels; returns the rectangle and the
/// channels (transparency first, then color).
fn encode_pixels(
    doc: &Document,
    header: &Header,
    layer: &Layer,
) -> Result<([i32; 4], Vec<Channel>)> {
    let color_count = doc.mode.color_channels();
    let Some(rect) = layer.pixels.content_bounds() else {
        return Ok(([0; 4], empty_channels(color_count)));
    };
    if !matches!(doc.mode, ColorMode::Rgb | ColorMode::Grayscale) {
        return Err(PsdError::Unsupported(
            "convert the document to RGB to save edited pixels".into(),
        ));
    }
    let (w, h) = (rect.w as u32, rect.h as u32);
    let rgba = layer.pixels.read_vec(rect);
    let planes = color::from_rgba(doc.mode, header.depth, w, h, &rgba);
    let psb = header.is_psb();
    let mut out = Vec::new();
    // The planes are the color channels, then transparency.
    let alpha = planes.get(color_count);
    if !layer.background
        && let Some(a) = alpha
    {
        out.push(channels::encode_channel(-1, a, w, h, header.depth, psb));
    }
    for (k, plane) in planes.iter().take(color_count).enumerate() {
        out.push(channels::encode_channel(
            k as i16,
            plane,
            w,
            h,
            header.depth,
            psb,
        ));
    }
    Ok((rect_of(rect), out))
}

/// A pixel mask's data and channel (`-2`).
fn encode_mask(header: &Header, layer: &Layer) -> Option<(MaskData, Channel)> {
    let mask = layer.mask.as_ref()?;
    let rect = mask.rect;
    let (w, h) = (rect.w.max(0) as u32, rect.h.max(0) as u32);
    let gray = if rect.is_empty() {
        Vec::new()
    } else {
        mask.raster.read_vec(rect)
    };
    let samples = color::from_gray(header.depth, w, h, &gray);
    let channel = channels::encode_channel(-2, &samples, w, h, header.depth, header.is_psb());
    let density =
        (mask.density < 1.0).then(|| (mask.density.clamp(0.0, 1.0) * 255.0).round() as u8);
    let feather = (mask.feather > 0.0).then_some(f64::from(mask.feather));
    let params = (density.is_some() || feather.is_some()).then_some(MaskParams {
        user_density: density,
        user_feather: feather,
        vector_density: None,
        vector_feather: None,
    });
    let mut f = 0u8;
    if mask.disabled {
        f |= 0x02;
    }
    if params.is_some() {
        f |= 0x10;
    }
    Some((
        MaskData {
            rect: rect_of(rect),
            default_color: mask.default_color,
            flags: f,
            params,
            real: None,
            tail: Vec::new(),
        },
        channel,
    ))
}

/// Shifts a record's rectangles to where the layer's pixels (and mask)
/// moved, keeping their data.
fn shift(record: &mut LayerRecord, layer: &Layer, moved_mask: bool) {
    let [top, left, _, _] = record.rect;
    let (ox, oy) = layer.pixels.origin();
    let (dx, dy) = (ox - left, oy - top);
    if (dx, dy) != (0, 0) && record.rect != [0; 4] {
        record.rect = [
            record.rect[0] + dy,
            record.rect[1] + dx,
            record.rect[2] + dy,
            record.rect[3] + dx,
        ];
    }
    if moved_mask && let (Some(m), Some(data)) = (&layer.mask, &mut record.mask) {
        let target = rect_of(m.rect);
        match &mut data.real {
            Some(real) => real.rect = target,
            None => data.rect = target,
        }
    }
}

/// The record a layer saves as.
pub(super) fn layer_record(doc: &Document, header: &Header, layer: &Layer) -> Result<LayerRecord> {
    let source = doc.source.as_ref().and_then(|s| {
        layer
            .record
            .and_then(|r| s.layers.info.records.get(r as usize))
    });
    let created = layer.edits & flags::CREATED != 0;
    if let Some(original) = source
        && layer.edits == 0
    {
        return Ok(original.clone());
    }
    let color_count = doc.mode.color_channels();
    let mut r = source.cloned().unwrap_or_else(|| blank_record(color_count));
    // A copy (or a new layer) writes every modeled field.
    let all = created || source.is_none();
    let e = if all { u64::MAX } else { layer.edits };
    let has = |f: u64| e & f != 0;

    // Fields of the record itself.
    r.opacity = layer.opacity;
    r.clipping = u8::from(layer.clipping);
    r.flags = (r.flags & !0x03)
        | if layer.visible { 0 } else { 0x02 }
        | u8::from(layer.locks.transparency);
    r.blend = layer.blend.key();
    if has(flags::NAME) {
        r.name = to_mac_roman(&layer.name).into_iter().take(255).collect();
        r.name_padding = 0;
        r.set_block(b"luni", blocks::unicode_name_data(&layer.name));
    }
    if all {
        r.set_block(b"lyid", layer.id.to_be_bytes().to_vec());
    }
    if has(flags::FILL_OPACITY) {
        r.set_block(b"iOpa", blocks::byte_setting_data(layer.fill_opacity));
    }
    if has(flags::LOCKS) {
        r.set_block(b"lspf", blocks::locks_data(&layer.locks));
    }
    if has(flags::COLOR_TAG) {
        r.set_block(b"lclr", blocks::color_tag_data(layer.color_tag));
    }
    if has(flags::ADVANCED) {
        r.set_block(
            b"clbl",
            blocks::byte_setting_data(u8::from(layer.blend_clipped_as_group)),
        );
        r.set_block(
            b"infx",
            blocks::byte_setting_data(u8::from(layer.blend_interior_as_group)),
        );
        r.set_block(b"knko", blocks::byte_setting_data(layer.knockout));
        r.set_block(
            b"tsly",
            blocks::byte_setting_data(u8::from(layer.transparency_shapes)),
        );
    }
    if has(flags::BLEND_RANGES) {
        r.blend_ranges = match &layer.blend_ranges {
            Some(ranges) => blocks::blend_ranges_data(ranges, color_count),
            None => blocks::blend_ranges_data(&Default::default(), color_count),
        };
    }

    // What the layer is.
    if has(flags::KIND) {
        for key in KIND_KEYS {
            r.remove_block(key);
        }
        r.tagged
            .retain(|b| !codec::adjustment::is_adjustment_key(&b.key) && &b.key != b"CgEd");
    }
    match &layer.kind {
        LayerKind::Group { open } => {
            if all || has(flags::OPEN | flags::BLEND | flags::KIND) {
                r.set_block(
                    b"lsct",
                    blocks::divider_data(Divider::Group { open: *open }, layer.blend),
                );
                r.remove_block(b"lsdk");
            }
            r.rect = [0; 4];
            r.channels = empty_channels(color_count);
        }
        LayerKind::Text { text } if has(flags::TEXT | flags::KIND) => {
            let original = source.and_then(|s| s.block(b"TySh")).map(|b| &b.data[..]);
            r.set_block(b"TySh", codec::text::encode(text, original));
        }
        LayerKind::Fill { fill, stroke } if has(flags::FILL | flags::KIND) => {
            let vscg = source.and_then(|s| s.block(b"vscg"));
            let original_fill = match vscg {
                Some(b) if b.data.len() > 4 => {
                    let mut key = [0u8; 4];
                    key.copy_from_slice(&b.data[..4]);
                    Some((key, b.data[4..].to_vec()))
                }
                _ => codec::fill::KEYS.iter().find_map(|k| {
                    source
                        .and_then(|s| s.block(k))
                        .map(|b| (*k, b.data.clone()))
                }),
            };
            let (key, data) =
                codec::fill::encode(fill, original_fill.as_ref().map(|(k, d)| (k, &d[..])));
            for k in codec::fill::KEYS {
                r.remove_block(&k);
            }
            if vscg.is_some() {
                let mut d = key.to_vec();
                d.extend_from_slice(&data);
                r.set_block(b"vscg", d);
            } else {
                r.set_block(&key, data);
            }
            match stroke {
                Some(s) => {
                    let original = source.and_then(|s| s.block(b"vstk")).map(|b| &b.data[..]);
                    r.set_block(b"vstk", codec::fill::encode_stroke(s, original));
                }
                None => r.remove_block(b"vstk"),
            }
        }
        LayerKind::Adjustment { adjustment } if has(flags::ADJUSTMENT | flags::KIND) => {
            let originals: Vec<([u8; 4], &[u8])> = source
                .map(|s| {
                    s.tagged
                        .iter()
                        .filter(|b| {
                            codec::adjustment::is_adjustment_key(&b.key) || &b.key == b"CgEd"
                        })
                        .map(|b| (b.key, &b.data[..]))
                        .collect()
                })
                .unwrap_or_default();
            let blocks = codec::adjustment::encode(adjustment, &originals);
            if !blocks.is_empty() {
                r.tagged
                    .retain(|b| !codec::adjustment::is_adjustment_key(&b.key) && &b.key != b"CgEd");
                for (key, data) in blocks {
                    r.set_block(&key, data);
                }
            }
        }
        LayerKind::SmartObject { object } if has(flags::PLACEMENT) => {
            for key in [b"SoLd", b"PlLd"] {
                if let Some(b) = source.and_then(|s| s.block(key)) {
                    r.set_block(
                        key,
                        codec::smart::encode_corners(key, &b.data, &object.corners),
                    );
                }
            }
        }
        _ => {}
    }
    if layer.is_group() {
        r.flags |= 0x18;
    } else if has(flags::KIND) {
        r.remove_block(b"lsct");
        r.remove_block(b"lsdk");
    }

    // Pixels.
    let pixels = has(flags::PIXELS) && !layer.is_group();
    if pixels {
        let (rect, mut chans) = if layer.kind.has_pixels() {
            encode_pixels(doc, header, layer)?
        } else {
            ([0; 4], empty_channels(color_count))
        };
        r.rect = rect;
        // Masks keep their channels unless they are rewritten below.
        chans.extend(r.channels.iter().filter(|c| c.id <= -2).cloned());
        r.channels = chans;
    } else if e & flags::OFFSET != 0 {
        shift(&mut r, layer, !has(flags::MASK));
    }

    // The pixel mask.
    if has(flags::MASK | flags::MASK_SETTINGS) {
        r.channels.retain(|c| c.id > -2);
        r.mask = None;
        if let Some((data, channel)) = encode_mask(header, layer) {
            r.mask = Some(data);
            r.channels.push(channel);
        }
    }

    // The vector mask (and the live shape data that would contradict it).
    if has(flags::VECTOR_MASK) {
        let key = if source.is_some_and(|s| s.block(b"vsms").is_some()) {
            *b"vsms"
        } else {
            *b"vmsk"
        };
        r.remove_block(b"vmsk");
        r.remove_block(b"vsms");
        if !all {
            r.remove_block(b"vogk");
        }
        if let Some(v) = &layer.vector_mask {
            r.set_block(&key, codec::vector::encode(v, doc.width, doc.height));
        }
    }

    // The style.
    if has(flags::EFFECTS) {
        let original = source
            .and_then(|s| s.block(b"lmfx").or_else(|| s.block(b"lfx2")))
            .map(|b| &b.data[..]);
        for key in [b"lfx2", b"lmfx", b"lrFX"] {
            r.remove_block(key);
        }
        if let Some(fx) = &layer.effects {
            let (key, data) = codec::effects::encode(fx, original);
            r.set_block(&key, data);
        }
    }
    Ok(r)
}
