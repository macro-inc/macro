//! Layer styles: the `lfx2` descriptor (and `lmfx`, which holds several of
//! one effect), or the legacy `lrFX` block in files without one.

use crate::error::Result;
use crate::model::Effects;

/// Reads a layer's effects from its blocks: `lmfx` or `lfx2` first, then
/// `lrFX`. `None` when the layer has no style.
pub fn decode(
    lfx2: Option<&[u8]>,
    lmfx: Option<&[u8]>,
    lrfx: Option<&[u8]>,
) -> Result<Option<Effects>> {
    let _ = (lfx2, lmfx, lrfx);
    todo!("effects::decode")
}

/// Writes effects as an `lfx2` block (single instances) or an `lmfx` block
/// (several of one effect): returns the key and data. Starts from the
/// `original` block's data when there is one.
pub fn encode(effects: &Effects, original: Option<&[u8]>) -> ([u8; 4], Vec<u8>) {
    let _ = (effects, original);
    todo!("effects::encode")
}
