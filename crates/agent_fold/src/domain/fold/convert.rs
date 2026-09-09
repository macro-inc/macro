//! ACP-to-vocabulary conversions and params access shared by the handlers.

use agent_client_protocol::RawJsonRpcParams;
use agent_client_protocol::schema::v1::{ContentBlock, ToolKind};

/// The text carried by a content block, if it carries any.
pub(super) fn content_block_text(block: ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text(text) => Some(text.text),
        // Images, audio, resource links and embedded resources have no text
        // to fold. Rendering them is a separate problem from this one.
        _ => None,
    }
}

pub(super) fn tool_kind_name(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "execute",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "switch_mode",
        ToolKind::Other => "other",
        _ => "unknown",
    }
}

/// A named JSON-RPC param, borrowed. `None` for positional params - every
/// frame this fold reads carries an object.
///
/// Only [`State::apply_session_update`] still uses this, to reach the one
/// field it wants (`update`) without paying to deserialize the rest of the
/// notification - `session/update` is most of any log, so that is the
/// difference between one clone per log and one clone per frame. Everywhere
/// else, [`deserialize_params`] reads the whole params object as ACP's own
/// type, because those frames are rare enough that the clone is free and the
/// typed struct is far harder to get wrong than a chain of `.get(key)`s.
pub(super) fn param<'params>(
    params: Option<&'params RawJsonRpcParams>,
    key: &str,
) -> Option<&'params serde_json::Value> {
    match params? {
        RawJsonRpcParams::Object(map) => map.get(key),
        RawJsonRpcParams::Array(_) => None,
    }
}

/// Deserialize a request's or notification's params as a specific ACP type.
///
/// `None` for positional params (nothing this fold reads uses those) or when
/// the object does not match `T`'s shape - the crate's total-by-construction
/// design point: a mismatch here is a state to render around, not a reason
/// to fail. Callers that want that mismatch to warn do so themselves; most
/// do not, because the alternative to a malformed prompt or permission
/// request is simply deriving less from it, same as any other partial frame.
pub(super) fn deserialize_params<T: serde::de::DeserializeOwned>(
    params: Option<&RawJsonRpcParams>,
) -> Option<T> {
    match params? {
        RawJsonRpcParams::Object(map) => {
            serde_json::from_value(serde_json::Value::Object(map.clone())).ok()
        }
        RawJsonRpcParams::Array(_) => None,
    }
}
