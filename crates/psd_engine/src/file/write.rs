//! Joining a file's parts back into bytes.

use super::{
    Channel, Compression, ESCAPED, Header, ImageData, LayerInfo, LayerRecord, LayerSection, Level,
    MaskData, MaskParams, PsdFile, Resource, TaggedBlock, is_large, pad4, writer_signature,
};
use crate::binary::Writer;

/// Mask data is at least this long (Photoshop pads a lone mask's 18 bytes).
const MIN_MASK: usize = 20;

pub(super) fn file(file: &PsdFile) -> Vec<u8> {
    let psb = file.header.is_psb();
    let mut w = Writer {
        buf: Vec::with_capacity(size_hint(file)),
    };
    header(&mut w, &file.header);
    w.u32(file.color_mode_data.len() as u32);
    w.bytes(&file.color_mode_data);
    resources(&mut w, &file.resources);
    layer_section(&mut w, &file.layers, psb);
    image(&mut w, &file.image);
    w.into_bytes()
}

/// Roughly the bytes a file takes, so the output grows once.
fn size_hint(file: &PsdFile) -> usize {
    let blocks = |tagged: &[TaggedBlock]| tagged.iter().map(|b| b.data.len() + 16).sum::<usize>();
    let records: usize = file
        .layers
        .info
        .records
        .iter()
        .map(|r| {
            r.channels.iter().map(|c| c.bytes.len() + 12).sum::<usize>()
                + blocks(&r.tagged)
                + r.name.len()
                + 128
        })
        .sum();
    let resources: usize = file.resources.iter().map(|r| r.data.len() + 16).sum();
    1024 + file.color_mode_data.len()
        + resources
        + records
        + blocks(&file.layers.tagged)
        + file.image.bytes.len()
}

fn header(w: &mut Writer, h: &Header) {
    w.sig(b"8BPS");
    w.u16(h.version);
    w.zeros(6);
    w.u16(h.channels);
    w.u32(h.height);
    w.u32(h.width);
    w.u16(h.depth);
    w.u16(h.mode);
}

fn resources(w: &mut Writer, resources: &[Resource]) {
    let at = w.placeholder(false);
    for r in resources {
        w.sig(&r.signature);
        w.u16(r.id);
        w.pascal(&r.name, 2);
        w.u32(r.data.len() as u32);
        w.bytes(&r.data);
        if r.data.len() % 2 == 1 {
            w.u8(0);
        }
    }
    w.fill_length(at, false, 0);
}

fn layer_section(w: &mut Writer, s: &LayerSection, psb: bool) {
    if s.is_empty() {
        w.length(0, psb);
        return;
    }
    let at = w.placeholder(psb);
    if s.info_key.is_some() {
        w.length(0, psb);
    } else {
        let follows = s.global_mask.is_some() || !s.tagged.is_empty() || !s.tail.is_empty();
        section_layer_info(w, &s.info, s.info_padding, psb, follows);
    }
    if let Some(mask) = &s.global_mask {
        w.u32(mask.len() as u32);
        w.bytes(mask);
    }
    // In 16- and 32-bit documents the layers go inside their `Lr16` or
    // `Lr32` block; a section that lost the block gets it first, where
    // Photoshop puts it.
    let marker = s
        .info_key
        .and_then(|key| s.tagged.iter().position(|b| b.key == key));
    let inner = |w: &mut Writer| {
        layer_info(w, &s.info, psb);
        w.zeros(s.info_padding.saturating_sub(ESCAPED));
    };
    if let (Some(key), None) = (s.info_key, marker) {
        block(
            w,
            &TaggedBlock::new(&key, Vec::new()),
            psb,
            Level::Document,
            inner,
        );
    }
    for (i, b) in s.tagged.iter().enumerate() {
        if Some(i) == marker {
            block(w, b, psb, Level::Document, inner);
        } else {
            block(w, b, psb, Level::Document, |w| w.bytes(&b.data));
        }
    }
    w.bytes(&s.tail);
    w.fill_length(at, psb, 0);
}

/// The section's own layer info: no bytes for no layers, otherwise
/// padded to four (or as the file had it, when that still keeps the
/// length even before what follows).
fn section_layer_info(w: &mut Writer, info: &LayerInfo, padding: usize, psb: bool, follows: bool) {
    if info.records.is_empty() && padding < ESCAPED {
        w.length(0, psb);
        return;
    }
    let at = w.placeholder(psb);
    let start = w.len();
    layer_info(w, info, psb);
    let used = w.len() - start;
    let pad = match padding.checked_sub(ESCAPED) {
        Some(kept) if (used + kept).is_multiple_of(2) || !follows => kept,
        _ => pad4(used),
    };
    w.zeros(pad);
    w.fill_length(at, psb, 0);
}

/// Layer records (at most what a count holds), then their channel data.
fn layer_info(w: &mut Writer, info: &LayerInfo, psb: bool) {
    let records = &info.records[..info.records.len().min(i16::MAX as usize)];
    let count = records.len() as i16;
    w.i16(if info.merged_alpha { -count } else { count });
    for r in records {
        record(w, r, psb);
    }
    for r in records {
        for c in channels(r) {
            w.u16(c.compression.code());
            w.bytes(&c.bytes);
        }
    }
}

/// A record's channels, at most what its count holds.
fn channels(r: &LayerRecord) -> &[Channel] {
    &r.channels[..r.channels.len().min(u16::MAX as usize)]
}

fn record(w: &mut Writer, r: &LayerRecord, psb: bool) {
    for v in r.rect {
        w.i32(v);
    }
    let channels = channels(r);
    w.u16(channels.len() as u16);
    for c in channels {
        w.i16(c.id);
        w.length(c.bytes.len() + 2, psb);
    }
    w.sig(b"8BIM");
    w.sig(&r.blend);
    w.u8(r.opacity);
    w.u8(r.clipping);
    w.u8(r.flags);
    w.u8(r.filler);
    let at = w.placeholder(false);
    mask_data(w, r.mask.as_ref());
    w.u32(r.blend_ranges.len() as u32);
    w.bytes(&r.blend_ranges);
    let name = &r.name[..r.name.len().min(255)];
    w.u8(name.len() as u8);
    w.bytes(name);
    w.zeros(match r.name_padding.checked_sub(ESCAPED) {
        Some(kept) => kept,
        None => pad4(1 + name.len()),
    });
    for b in &r.tagged {
        block(w, b, psb, Level::Record, |w| w.bytes(&b.data));
    }
    w.bytes(&r.extra_tail);
    w.fill_length(at, false, 0);
}

fn mask_data(w: &mut Writer, mask: Option<&MaskData>) {
    let Some(m) = mask else {
        w.u32(0);
        return;
    };
    let at = w.placeholder(false);
    for v in m.rect {
        w.i32(v);
    }
    w.u8(m.default_color);
    w.u8(m.flags);
    if let Some(real) = &m.real {
        w.u8(real.flags);
        w.u8(real.default_color);
        for v in real.rect {
            w.i32(v);
        }
    }
    if let Some(params) = &m.params {
        mask_params(w, params);
    }
    let len = w.len() - at - 4;
    w.zeros(MIN_MASK.saturating_sub(len));
    w.fill_length(at, false, 0);
}

fn mask_params(w: &mut Writer, p: &MaskParams) {
    let bits = u8::from(p.user_density.is_some())
        | u8::from(p.user_feather.is_some()) << 1
        | u8::from(p.vector_density.is_some()) << 2
        | u8::from(p.vector_feather.is_some()) << 3;
    w.u8(bits);
    if let Some(v) = p.user_density {
        w.u8(v);
    }
    if let Some(v) = p.user_feather {
        w.f64(v);
    }
    if let Some(v) = p.vector_density {
        w.u8(v);
    }
    if let Some(v) = p.vector_feather {
        w.f64(v);
    }
}

/// A tagged block whose data `data` writes, padded as it was read or, for
/// new and changed blocks, as Photoshop pads blocks at `level`.
fn block(w: &mut Writer, b: &TaggedBlock, psb: bool, level: Level, data: impl FnOnce(&mut Writer)) {
    let signature = match b.padding {
        Some(_) => b.signature,
        None => writer_signature(&b.key, psb),
    };
    w.sig(&signature);
    w.sig(&b.key);
    let large = is_large(&signature, &b.key, psb);
    let at = w.placeholder(large);
    data(w);
    match &b.padding {
        Some(padding) if b.length_includes_padding => {
            w.bytes(padding);
            w.fill_length(at, large, 0);
        }
        Some(padding) => {
            w.fill_length(at, large, 0);
            w.bytes(padding);
        }
        None => {
            let len = w.len() - at - if large { 8 } else { 4 };
            match level {
                Level::Record => {
                    w.zeros(pad4(len));
                    w.fill_length(at, large, 0);
                }
                Level::Document => {
                    w.fill_length(at, large, 0);
                    w.zeros(pad4(len));
                }
            }
        }
    }
}

/// The merged image; a file read without one is written without one.
fn image(w: &mut Writer, image: &ImageData) {
    if image.compression == Compression::Raw && image.bytes.is_empty() {
        return;
    }
    w.u16(image.compression.code());
    w.bytes(&image.bytes);
}
