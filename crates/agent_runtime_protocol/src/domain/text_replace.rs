//! Agent-neutral text snapshots carried by ACP agent message chunks.
//!
//! A text chunk with `_meta: {"macro.textReplace": {"id": "item-id"}}`
//! replaces the complete text of that keyed prose part in the current turn.
//! Its first appearance fixes its position, even across interleaved tools.
//! An empty snapshot clears the text; repeated snapshots are idempotent.
//! Keys are local to a turn. Unmarked chunks retain ACP append semantics.
//! Clients advertise support with the same key set to `true` in capabilities.

use agent_client_protocol::schema::v1::{ContentBlock, ContentChunk, Meta};
use serde_json::json;

/// ACP metadata key for text replacement and its client capability.
pub const TEXT_REPLACE_META_KEY: &str = "macro.textReplace";

/// Metadata for a full snapshot of the text part identified by `id`.
/// The caller supplies a nonempty, stable, turn-local key.
pub fn text_replace_meta(id: &str) -> Meta {
    Meta::from_iter([(TEXT_REPLACE_META_KEY.to_owned(), json!({"id": id}))])
}

/// Read a nonempty replacement key from a text chunk.
/// Unmarked, malformed, and non-text chunks have no replacement semantics.
pub fn text_replace_id(chunk: &ContentChunk) -> Option<&str> {
    if !matches!(chunk.content, ContentBlock::Text(_)) {
        return None;
    }
    chunk
        .meta
        .as_ref()?
        .get(TEXT_REPLACE_META_KEY)?
        .get("id")?
        .as_str()
        .filter(|id| !id.is_empty())
}

#[cfg(test)]
mod test;
