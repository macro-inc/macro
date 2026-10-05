//! Vector masks (`vmsk`, or `vsms` in newer files): path records with
//! points in fixed 8.24 fractions of the canvas, read into canvas pixels.

use crate::error::Result;
use crate::model::VectorMask;

/// Reads a vector mask on a `width × height` canvas.
pub fn decode(data: &[u8], width: u32, height: u32) -> Result<VectorMask> {
    let _ = (data, width, height);
    todo!("vector::decode")
}

/// Writes a vector mask on a `width × height` canvas.
pub fn encode(mask: &VectorMask, width: u32, height: u32) -> Vec<u8> {
    let _ = (mask, width, height);
    todo!("vector::encode")
}
