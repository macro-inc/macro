//! The small per-layer blocks the model reads directly: names, ids, group
//! dividers, fill opacity, locks, color tags, and advanced blending.

use crate::binary::{Reader, Writer};
use crate::file::LayerRecord;
use crate::model::{BlendMode, BlendRanges, Locks};

/// What a section divider (`lsct`, `lsdk`) says a record is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Divider {
    /// An ordinary layer.
    Layer,
    /// A group's own record (its children are below it): expanded or not.
    Group {
        /// Expanded in the layers panel.
        open: bool,
    },
    /// The hidden record closing a group (below its children).
    End,
}

/// A record's section divider and the blend mode a group record keeps in
/// it.
pub fn divider(record: &LayerRecord) -> (Divider, Option<BlendMode>) {
    let Some(block) = record.block(b"lsct").or_else(|| record.block(b"lsdk")) else {
        return (Divider::Layer, None);
    };
    let mut r = Reader::new(&block.data);
    let kind = match r.u32().unwrap_or(0) {
        1 => Divider::Group { open: true },
        2 => Divider::Group { open: false },
        3 => Divider::End,
        _ => Divider::Layer,
    };
    let blend = match (r.sig(), r.sig()) {
        (Ok(sig), Ok(key)) if &sig == b"8BIM" => BlendMode::from_key(&key),
        _ => None,
    };
    (kind, blend)
}

/// A section divider block's data.
pub fn divider_data(kind: Divider, blend: BlendMode) -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(match kind {
        Divider::Layer => 0,
        Divider::Group { open: true } => 1,
        Divider::Group { open: false } => 2,
        Divider::End => 3,
    });
    if kind != Divider::End {
        w.sig(b"8BIM");
        w.sig(&blend.key());
    }
    w.into_bytes()
}

/// The layer's Unicode name (`luni`), else its Pascal name.
pub fn name(record: &LayerRecord) -> String {
    record
        .block(b"luni")
        .and_then(|b| Reader::new(&b.data).unicode().ok())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| crate::binary::mac_roman(&record.name))
}

/// A `luni` block's data.
pub fn unicode_name_data(name: &str) -> Vec<u8> {
    let mut w = Writer::new();
    w.unicode(name);
    // Photoshop pads the name block to four bytes.
    w.pad_from(0, 4);
    w.into_bytes()
}

/// The layer id (`lyid`).
pub fn layer_id(record: &LayerRecord) -> Option<u32> {
    record
        .block(b"lyid")
        .and_then(|b| Reader::new(&b.data).u32().ok())
}

/// A one-byte setting followed by three padding bytes (`iOpa`, `clbl`,
/// `infx`, `knko`, `tsly`, `lmgm`, `vmgm`).
pub fn byte_setting(record: &LayerRecord, key: &[u8; 4]) -> Option<u8> {
    record.block(key).and_then(|b| b.data.first().copied())
}

/// A one-byte setting block's data.
pub fn byte_setting_data(value: u8) -> Vec<u8> {
    vec![value, 0, 0, 0]
}

/// Lock settings (`lspf`), with the record's transparency-protected flag.
pub fn locks(record: &LayerRecord) -> Locks {
    let flags = record
        .block(b"lspf")
        .and_then(|b| Reader::new(&b.data).u32().ok())
        .unwrap_or(0);
    Locks {
        transparency: flags & 0x01 != 0 || record.flags & 0x01 != 0,
        pixels: flags & 0x02 != 0,
        position: flags & 0x04 != 0,
        artboard: flags & 0x08 != 0,
    }
}

/// An `lspf` block's data.
pub fn locks_data(locks: &Locks) -> Vec<u8> {
    let mut flags = 0u32;
    if locks.transparency {
        flags |= 0x01;
    }
    if locks.pixels {
        flags |= 0x02;
    }
    if locks.position {
        flags |= 0x04;
    }
    if locks.artboard {
        flags |= 0x08;
    }
    flags.to_be_bytes().to_vec()
}

/// The color tag (`lclr`).
pub fn color_tag(record: &LayerRecord) -> u8 {
    record
        .block(b"lclr")
        .and_then(|b| Reader::new(&b.data).u16().ok())
        .map_or(0, |c| c.min(7) as u8)
}

/// An `lclr` block's data.
pub fn color_tag_data(tag: u8) -> Vec<u8> {
    let mut w = Writer::new();
    w.u16(u16::from(tag));
    w.zeros(6);
    w.into_bytes()
}

/// Blend If ranges from a record's blending ranges.
pub fn blend_ranges(record: &LayerRecord) -> Option<BlendRanges> {
    let data = &record.blend_ranges;
    if data.len() < 8 {
        return None;
    }
    let range = |c: &[u8]| [c[0], c[1], c[2], c[3]];
    let channels: Vec<([u8; 4], [u8; 4])> = data
        .chunks_exact(8)
        .map(|c| (range(&c[..4]), range(&c[4..])))
        .collect();
    let ranges = BlendRanges { channels };
    (!ranges.is_default()).then_some(ranges)
}

/// Blending ranges data for a record.
pub fn blend_ranges_data(ranges: &BlendRanges, color_channels: usize) -> Vec<u8> {
    let default = ([0, 0, 255, 255], [0, 0, 255, 255]);
    let mut out = Vec::new();
    for i in 0..=color_channels {
        let (s, d) = ranges.channels.get(i).copied().unwrap_or(default);
        out.extend_from_slice(&s);
        out.extend_from_slice(&d);
    }
    out
}
