//! Searchable text of Photoshop (`.psd`, `.psb`) documents: the layer
//! names and the text of text layers, one per line, as one chunk. Long text
//! is capped where chunks are written, as for every file type.

use psd_engine::document::{self, OpenOptions};

/// Bytes of decoded pixels a document may take while it is indexed.
/// Opening a document decodes every layer, and several events are indexed
/// at once, so documents beyond this are indexed by name only.
pub const PIXEL_BUDGET: u64 = 256 * 1024 * 1024;

/// Decodes a Photoshop document and returns its searchable text.
pub fn parse_psd_text(bytes: &[u8]) -> anyhow::Result<String> {
    let opened = document::open(
        bytes,
        OpenOptions {
            pixel_budget: PIXEL_BUDGET,
        },
    )
    .map_err(|e| anyhow::anyhow!("unable to decode the Photoshop document: {e}"))?;
    Ok(psd_engine::describe::text(&opened.document))
}

#[cfg(test)]
mod test;
