//! Smart objects (`SoLd`, `PlLd`): the placed content's id, name, and
//! corners.

use crate::error::Result;
use crate::model::SmartObject;

/// Reads a `SoLd` (preferred) or `PlLd` block.
pub fn decode(key: &[u8; 4], data: &[u8]) -> Result<SmartObject> {
    let _ = (key, data);
    todo!("smart::decode")
}

/// Rewrites a `SoLd` or `PlLd` block with new corners (the placement's
/// transform), keeping everything else.
pub fn encode_corners(key: &[u8; 4], original: &[u8], corners: &[f64; 8]) -> Vec<u8> {
    let _ = (key, original, corners);
    todo!("smart::encode_corners")
}
