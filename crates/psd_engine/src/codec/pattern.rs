//! Document patterns (`Patt`, `Pat2`, `Pat3`): each pattern's id, name,
//! and pixels (virtual memory array lists), converted to RGBA.

use crate::error::Result;
use crate::model::Pattern;

/// Reads the patterns of a document-level pattern block.
pub fn decode(data: &[u8], large: bool) -> Result<Vec<Pattern>> {
    let _ = (data, large);
    todo!("pattern::decode")
}
