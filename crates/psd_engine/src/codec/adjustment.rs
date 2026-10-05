//! Adjustment layer blocks: `brit`, `CgEd`, `levl`, `curv`, `expA`, `vibA`,
//! `hue2`, `blnc`, `blwh`, `phfl`, `mixr`, `nvrt`, `post`, `thrs`, `grdm`,
//! `selc`, and the ones kept without being drawn.

use crate::error::Result;
use crate::model::Adjustment;

/// Whether a block key is an adjustment layer's.
pub fn is_adjustment_key(key: &[u8; 4]) -> bool {
    let _ = key;
    todo!("adjustment::is_adjustment_key")
}

/// Reads an adjustment block. When a layer has both `brit` and `CgEd`,
/// pass `CgEd` (it holds the modern settings).
pub fn decode(key: &[u8; 4], data: &[u8]) -> Result<Adjustment> {
    let _ = (key, data);
    todo!("adjustment::decode")
}

/// Writes an adjustment as blocks (key and data; Brightness/Contrast
/// writes both `brit` and `CgEd`), starting from the `original` blocks
/// when there are some. Empty for [`Adjustment::Other`].
pub fn encode(adjustment: &Adjustment, original: &[([u8; 4], &[u8])]) -> Vec<([u8; 4], Vec<u8>)> {
    let _ = (adjustment, original);
    todo!("adjustment::encode")
}
