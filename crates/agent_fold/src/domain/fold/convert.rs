//! ACP-to-vocabulary conversions and params access shared by the handlers.

use agent_client_protocol::RawJsonRpcParams;
use agent_client_protocol::schema::v1::{ContentBlock, ImageContent, ToolKind};
use agent_runtime_protocol::domain::action::PromptAttachment;

use crate::domain::model::MessagePart;

/// The text carried by a content block, if it carries any.
pub(super) fn content_block_text(block: ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text(text) => Some(text.text),
        // Images fold to attachment parts — see [`user_content_part`]. Audio
        // and embedded resources have nothing this side renders.
        _ => None,
    }
}

/// What a user's content block folds to: prose, an attachment for a
/// `resource_link`, or an attachment for an image frame. `None` for the
/// block kinds this side does not render.
pub(super) fn user_content_part(block: ContentBlock) -> Option<MessagePart> {
    if let Some(attachment) = PromptAttachment::from_content_block(&block) {
        return Some(MessagePart::Attachment {
            uri: attachment.uri,
            name: attachment.name,
            mime_type: attachment.mime_type,
            size: attachment.size,
        });
    }
    if let ContentBlock::Image(image) = block {
        return image_attachment(image);
    }
    content_block_text(block).map(|text| MessagePart::Text { text })
}

/// An image frame as an attachment. The source URL is the picture; the bytes
/// stay on the frame and are not copied into the folded message.
fn image_attachment(image: ImageContent) -> Option<MessagePart> {
    let mime_type = if image.mime_type.is_empty() {
        None
    } else {
        Some(image.mime_type.clone())
    };
    let source = image.uri.filter(|uri| !uri.is_empty());
    let uri = if let Some(uri) = source.clone() {
        uri
    } else if image.data.is_empty() {
        return None;
    } else {
        let mime = mime_type.as_deref().unwrap_or("application/octet-stream");
        format!("data:{mime};base64,{}", image.data)
    };
    let name = image_name(source.as_deref().unwrap_or(&uri), mime_type.as_deref());
    Some(MessagePart::Attachment {
        uri,
        name,
        mime_type,
        size: None,
    })
}

fn image_name(uri: &str, mime: Option<&str>) -> String {
    let path = uri.split(['?', '#']).next().unwrap_or(uri);
    if let Some(name) = path.rsplit('/').next().filter(|name| name.contains('.')) {
        return name.to_owned();
    }
    let ext = match mime {
        Some("image/png") => "png",
        Some("image/jpeg") | Some("image/jpg") => "jpg",
        Some("image/gif") => "gif",
        Some("image/webp") => "webp",
        _ => "img",
    };
    format!("image.{ext}")
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
