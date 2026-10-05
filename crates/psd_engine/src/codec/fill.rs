//! Fill layers (`SoCo` solid color, `GdFl` gradient, `PtFl` pattern) and
//! shape strokes (`vstk`).

use crate::error::Result;
use crate::model::{Fill, VectorStroke};

/// Keys of the fill layer blocks.
pub const KEYS: [[u8; 4]; 3] = [*b"SoCo", *b"GdFl", *b"PtFl"];

/// Reads a fill layer block.
pub fn decode(key: &[u8; 4], data: &[u8]) -> Result<Fill> {
    let _ = (key, data);
    todo!("fill::decode")
}

/// Writes a fill layer block: its key and data, starting from the
/// `original` block of the same key when there is one.
pub fn encode(fill: &Fill, original: Option<(&[u8; 4], &[u8])>) -> ([u8; 4], Vec<u8>) {
    let _ = (fill, original);
    todo!("fill::encode")
}

/// Reads a `vstk` block.
pub fn decode_stroke(data: &[u8]) -> Result<VectorStroke> {
    let _ = data;
    todo!("fill::decode_stroke")
}

/// Writes a `vstk` block, starting from the `original` when there is one.
pub fn encode_stroke(stroke: &VectorStroke, original: Option<&[u8]>) -> Vec<u8> {
    let _ = (stroke, original);
    todo!("fill::encode_stroke")
}
