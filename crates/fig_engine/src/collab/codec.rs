//! The binary form of a node's state in the shared maps.
//!
//! An entry holds everything [`Props`] models (so a peer reproduces the
//! node exactly: floats keep their bits, geometry and glyph outlines keep
//! their blobs), plus whether the node is removed, which of its fields were
//! edited, and the node a copy was made from. Blob references are either
//! indices into the blobs every peer's file starts with (below the shared
//! base count) or keys of the shared blob map, listed once at the start of
//! the entry. Entries travel as base64 text.

use crate::model::{
    BlendMode, EffectKind, GradientKind, Guid, ImageScaleMode, MaskType, NodeType, Paint,
    PaintKind, PropField, Props, StrokeAlign, StyleType, VariableType, WindingRule,
};
use std::sync::Arc;

mod read;
mod write;

pub use read::Reader;
pub use write::Writer;

/// Layout version of a node entry (its first byte).
pub(super) const ENTRY_VERSION: u8 = 2;

/// A node as the shared maps hold it.
#[derive(Clone, Debug, PartialEq)]
pub struct NodeState {
    pub props: Props,
    pub removed: bool,
    /// Whether the node is in its parent's children: always when live; a
    /// removed node stays listed when it went with a removed ancestor (so
    /// components deleted with their layers still show in instances).
    pub listed: bool,
    /// [`crate::edit::flags`] of every field edited during the collaboration.
    pub edits: u64,
    /// For a copy: the file node it was copied from.
    pub source: Option<Guid>,
}

/// Where a blob reference points.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BlobRef {
    /// An index below the shared base count: the same blob in every file.
    Base(u32),
    /// A key of the shared blob map.
    Shared(Arc<str>),
}

/// Why an entry could not be read.
#[derive(Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// The entry references a shared blob this peer has not received yet.
    Missing(Arc<str>),
    /// The entry is damaged or from a newer layout.
    Invalid,
}

pub(super) type Decoded<T> = Result<T, DecodeError>;

// ---- base64 and hashing -------------------------------------------------

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for (k, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if k <= chunk.len() {
                out.push(ALPHABET[((n >> shift) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Decodes [`base64`]; `None` when `text` is not base64.
pub fn unbase64(text: &str) -> Option<Vec<u8>> {
    let digit = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let bytes = text.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        if chunk.len() == 1 {
            return None;
        }
        let mut n = 0u32;
        for (k, &c) in chunk.iter().enumerate() {
            n |= digit(c)? << (18 - 6 * k);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// The shared key of a blob: FNV-1a (128-bit) of its bytes, in hex. Every
/// peer computes the same key for the same bytes.
pub fn blob_key(bytes: &[u8]) -> String {
    const OFFSET: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
    const PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;
    let mut h = OFFSET;
    for &b in bytes {
        h ^= u128::from(b);
        h = h.wrapping_mul(PRIME);
    }
    format!("{h:032x}")
}

// ---- enum codes ---------------------------------------------------------

/// Two-way tables between an enum and stable one-byte codes. Encoding is
/// an exhaustive match, so a new variant fails to compile until it has a
/// code; unknown codes decode to the default.
macro_rules! codes {
    ($enc:ident, $dec:ident, $ty:ty, default $default:expr; $($variant:path = $code:literal),* $(,)?) => {
        pub(super) fn $enc(v: $ty) -> u8 {
            match v {
                $($variant => $code,)*
            }
        }

        pub(super) fn $dec(c: u8) -> $ty {
            match c {
                $($code => $variant,)*
                _ => $default,
            }
        }
    };
}

codes!(enc_node_type, dec_node_type, NodeType, default NodeType::Other;
    NodeType::Document = 0, NodeType::Canvas = 1, NodeType::Group = 2, NodeType::Frame = 3,
    NodeType::BooleanOperation = 4, NodeType::Vector = 5, NodeType::Star = 6,
    NodeType::Line = 7, NodeType::Ellipse = 8, NodeType::Rectangle = 9,
    NodeType::RegularPolygon = 10, NodeType::RoundedRectangle = 11, NodeType::Text = 12,
    NodeType::Slice = 13, NodeType::Symbol = 14, NodeType::Instance = 15,
    NodeType::Sticky = 16, NodeType::ShapeWithText = 17, NodeType::Connector = 18,
    NodeType::CodeBlock = 19, NodeType::Widget = 20, NodeType::Stamp = 21,
    NodeType::Media = 22, NodeType::Highlight = 23, NodeType::Section = 24,
    NodeType::SectionOverlay = 25, NodeType::WashiTape = 26, NodeType::Table = 27,
    NodeType::TableCell = 28, NodeType::Slide = 29, NodeType::TextPath = 30,
    NodeType::Other = 31,
);

codes!(enc_blend, dec_blend, BlendMode, default BlendMode::PassThrough;
    BlendMode::PassThrough = 0, BlendMode::Normal = 1, BlendMode::Darken = 2,
    BlendMode::Multiply = 3, BlendMode::LinearBurn = 4, BlendMode::ColorBurn = 5,
    BlendMode::Lighten = 6, BlendMode::Screen = 7, BlendMode::LinearDodge = 8,
    BlendMode::ColorDodge = 9, BlendMode::Overlay = 10, BlendMode::SoftLight = 11,
    BlendMode::HardLight = 12, BlendMode::Difference = 13, BlendMode::Exclusion = 14,
    BlendMode::Hue = 15, BlendMode::Saturation = 16, BlendMode::Color = 17,
    BlendMode::Luminosity = 18,
);

codes!(enc_align, dec_align, StrokeAlign, default StrokeAlign::Center;
    StrokeAlign::Center = 0, StrokeAlign::Inside = 1, StrokeAlign::Outside = 2,
);

codes!(enc_winding, dec_winding, WindingRule, default WindingRule::NonZero;
    WindingRule::NonZero = 0, WindingRule::EvenOdd = 1,
);

codes!(enc_mask, dec_mask, MaskType, default MaskType::Alpha;
    MaskType::Alpha = 0, MaskType::Outline = 1, MaskType::Luminance = 2,
);

codes!(enc_gradient, dec_gradient, GradientKind, default GradientKind::Linear;
    GradientKind::Linear = 0, GradientKind::Radial = 1, GradientKind::Angular = 2,
    GradientKind::Diamond = 3,
);

codes!(enc_scale_mode, dec_scale_mode, ImageScaleMode, default ImageScaleMode::Fill;
    ImageScaleMode::Stretch = 0, ImageScaleMode::Fit = 1, ImageScaleMode::Fill = 2,
    ImageScaleMode::Tile = 3,
);

codes!(enc_effect, dec_effect, EffectKind, default EffectKind::Other;
    EffectKind::DropShadow = 0, EffectKind::InnerShadow = 1, EffectKind::LayerBlur = 2,
    EffectKind::BackgroundBlur = 3, EffectKind::Other = 4,
);

codes!(enc_prop_field, dec_prop_field, PropField, default PropField::Other;
    PropField::Visible = 0, PropField::Text = 1, PropField::SwappedSymbol = 2,
    PropField::Other = 3,
);

codes!(enc_variable_type, dec_variable_type, VariableType, default VariableType::Other;
    VariableType::Color = 0, VariableType::Float = 1, VariableType::String = 2,
    VariableType::Boolean = 3, VariableType::Other = 4,
);

codes!(enc_style_type, dec_style_type, StyleType, default StyleType::Other;
    StyleType::Fill = 0, StyleType::Text = 1, StyleType::Effect = 2, StyleType::Grid = 3,
    StyleType::Other = 4,
);

/// The names unsupported paints carry (see `decode::paint`).
pub(super) const UNSUPPORTED_PAINTS: [&str; 5] = ["emoji", "video", "pattern", "noise", "paint"];

/// Image hashes the paints of `p` (and its overrides, derived layout,
/// generated layers, and text runs) reference.
pub fn image_hashes(p: &Props, out: &mut Vec<Arc<str>>) {
    let mut paints = |list: &Option<Arc<[Paint]>>| {
        for paint in list.as_deref().unwrap_or_default() {
            if let PaintKind::Image(img) = &paint.kind
                && let Some(h) = &img.hash
                && !out.contains(h)
            {
                out.push(h.clone());
            }
        }
    };
    paints(&p.fills);
    paints(&p.strokes);
    if let Some(t) = &p.text_content {
        for run in t.styles.iter() {
            paints(&run.fills);
        }
    }
    for run in p.vector_styles.iter().flat_map(|s| s.iter()) {
        paints(&run.fills);
    }
    let nested: Vec<&Props> = p
        .symbol
        .iter()
        .flat_map(|s| s.overrides.iter())
        .chain(p.derived.iter().flat_map(|d| d.iter()))
        .chain(p.generated.iter().flat_map(|d| d.iter()))
        .collect();
    for n in nested {
        image_hashes(n, out);
    }
}
