//! Text layers (`TySh`): the transform, the text descriptor with its engine
//! data (characters, style runs, paragraph runs, fonts), and the warp.

use crate::error::Result;
use crate::model::TextLayer;

/// Reads a `TySh` block.
pub fn decode(data: &[u8]) -> Result<TextLayer> {
    let _ = data;
    todo!("text::decode")
}

/// Writes a `TySh` block for `text`, starting from the `original` block
/// when there is one (warp, fonts, and settings the model does not cover
/// are kept).
pub fn encode(text: &TextLayer, original: Option<&[u8]>) -> Vec<u8> {
    let _ = (text, original);
    todo!("text::encode")
}
