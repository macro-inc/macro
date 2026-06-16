#[cfg(test)]
mod test;

/// Conversions between agent message types and `rig` message types.
use crate::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use attachment::image::ImageData;
use attachment::{AttachmentContent, AttachmentPart, Attachments};
use rig_core::OneOrMany;
use rig_core::message::{
    AssistantContent, ImageMediaType, Message, ToolCall, ToolFunction, ToolResultContent,
    UserContent,
};

/// Conversion of an attachment value into RIG user-content blocks.
///
/// Implemented for the attachment tree types so a user message's resolved
/// attachments can be flattened into the [`UserContent`] blocks RIG sends to
/// the model. Foreign-type orphan rules rule out a `From` impl, so this local
/// trait carries the conversions instead.
trait ToUserContent {
    /// Convert `self` into zero or more RIG user-content blocks.
    fn to_user_content(&self) -> Vec<UserContent>;
}

impl ToUserContent for Attachments<'_> {
    fn to_user_content(&self) -> Vec<UserContent> {
        // Failed resolutions carry no content useful to the model; skip them.
        self.parts()
            .iter()
            .filter_map(|resolved| resolved.as_ref().ok())
            .flat_map(ToUserContent::to_user_content)
            .collect()
    }
}

impl ToUserContent for AttachmentContent<'_> {
    fn to_user_content(&self) -> Vec<UserContent> {
        self.content
            .iter()
            .flat_map(ToUserContent::to_user_content)
            .collect()
    }
}

impl ToUserContent for AttachmentPart<'_> {
    fn to_user_content(&self) -> Vec<UserContent> {
        match self {
            Self::Content(text) => vec![UserContent::text(text.clone())],
            Self::Image(image) => image.to_user_content(),
            Self::Metadata { key, value } => vec![UserContent::text(format!("{key}: {value}"))],
            // Errors, child references, and resolved children are not
            // represented as inline model content here.
            Self::ImageError(_) | Self::Child(_) | Self::ChildReference(_) => vec![],
        }
    }
}

impl ToUserContent for ImageData {
    fn to_user_content(&self) -> Vec<UserContent> {
        let content = match self {
            // `Base64Image` is always a downscaled WebP by construction.
            Self::Base64(image) => UserContent::image_base64(
                image.base64_data().to_owned(),
                Some(ImageMediaType::WEBP),
                None,
            ),
            Self::StaticUrl(url) => UserContent::image_url(url.clone(), None, None),
        };
        vec![content]
    }
}

/// Convert a slice of [`ChatMessage`] into RIG [`Message`]s.
///
/// System messages are skipped (the system prompt is set on the agent).
///
/// A single persisted assistant message may contain a flattened multi-turn
/// tool loop: `[text, tool_calls, tool_results, text]`. This function
/// reconstructs the turn boundaries Anthropic expects:
/// `assistant(text + tool_calls)`, `user(tool_results)`, `assistant(text)`.
pub fn to_rig_messages(messages: &[ChatMessage]) -> Vec<Message> {
    messages.iter().flat_map(convert_one).collect()
}

fn convert_one(msg: &ChatMessage) -> Vec<Message> {
    match msg.role {
        Role::System => vec![],
        Role::User => convert_user(msg),
        Role::Assistant => convert_assistant(msg),
    }
}

/// Convert a user message into a single RIG [`Message::User`].
///
/// The message text becomes a leading [`UserContent::Text`] block (when
/// non-empty) and any resolved [`attachments`](ChatMessage::attachments) are
/// appended as additional text and image content blocks. Without this, image
/// attachments would never reach the model.
fn convert_user(msg: &ChatMessage) -> Vec<Message> {
    let mut content: Vec<UserContent> = Vec::new();

    let text = msg.content.message_text();
    if !text.is_empty() {
        content.push(UserContent::text(text));
    }

    if let Some(attachments) = &msg.attachments {
        content.extend(attachments.to_user_content());
    }

    // A user turn must contain at least one content block.
    if content.is_empty() {
        content.push(UserContent::text(String::new()));
    }

    match OneOrMany::many(content) {
        Ok(content) => vec![Message::User { content }],
        Err(_) => vec![Message::user(msg.content.message_text())],
    }
}

fn convert_assistant(msg: &ChatMessage) -> Vec<Message> {
    let parts = match &msg.content {
        ChatMessageContent::Text(text) => {
            return vec![Message::assistant(text)];
        }
        ChatMessageContent::AssistantMessageParts(parts) => parts,
    };

    let mut out: Vec<Message> = Vec::new();
    let mut assistant_parts: Vec<AssistantContent> = Vec::new();
    let mut tool_results: Vec<UserContent> = Vec::new();
    let mut saw_tool_call = false;

    for part in parts {
        match part {
            AssistantMessagePart::Text { text } => {
                if saw_tool_call {
                    flush(&mut out, &mut assistant_parts, &mut tool_results);
                    saw_tool_call = false;
                }
                if let Some(AssistantContent::Text(prev)) = assistant_parts.last_mut() {
                    prev.text.push_str(text);
                } else {
                    assistant_parts.push(AssistantContent::text(text));
                }
            }
            AssistantMessagePart::ToolCall { name, json, id }
            | AssistantMessagePart::McpToolCall { name, json, id, .. } => {
                saw_tool_call = true;
                assistant_parts.push(AssistantContent::ToolCall(
                    ToolCall::new(
                        replay_item_id(id),
                        ToolFunction::new(name.clone(), json.clone()),
                    )
                    .with_call_id(id.clone()),
                ));
            }
            AssistantMessagePart::ToolCallResponseJson { id, json, .. } => {
                let text = serde_json::to_string(json).unwrap_or_default();
                tool_results.push(UserContent::tool_result_with_call_id(
                    replay_item_id(id),
                    id.clone(),
                    OneOrMany::one(ToolResultContent::text(text)),
                ));
            }
            AssistantMessagePart::ToolCallErr {
                id, description, ..
            } => {
                tool_results.push(UserContent::tool_result_with_call_id(
                    replay_item_id(id),
                    id.clone(),
                    OneOrMany::one(ToolResultContent::text(description.clone())),
                ));
            }
            AssistantMessagePart::Thinking { .. } => {}
        }
    }

    flush(&mut out, &mut assistant_parts, &mut tool_results);
    out
}

/// Item id replayed to the provider for a persisted tool call or result.
///
/// The persisted id is the provider call id when one exists (OpenAI's
/// `call_…`) or an internal nanoid otherwise. OpenAI's Responses API rejects
/// replayed `function_call` item ids that don't begin with `fc`, and pairs
/// calls to results through `call_id` — which is why the persisted id is also
/// set as `call_id` above. Anthropic ignores `call_id` and only requires a
/// result's id to match its call's id, which this uniform prefix preserves.
fn replay_item_id(id: &str) -> String {
    format!("fc_{id}")
}

/// Merges consecutive `Text` and `Thinking` parts into single entries.
pub fn merge_consecutive_parts(parts: Vec<AssistantMessagePart>) -> Vec<AssistantMessagePart> {
    let mut out: Vec<AssistantMessagePart> = Vec::with_capacity(parts.len());
    for part in parts {
        match (&mut out.last_mut(), &part) {
            (
                Some(AssistantMessagePart::Text { text: acc }),
                AssistantMessagePart::Text { text },
            ) => {
                acc.push_str(text);
            }
            (
                Some(AssistantMessagePart::Thinking { thinking: acc }),
                AssistantMessagePart::Thinking { thinking },
            ) => {
                acc.push_str(thinking);
            }
            _ => out.push(part),
        }
    }
    out
}

fn flush(
    out: &mut Vec<Message>,
    assistant_parts: &mut Vec<AssistantContent>,
    tool_results: &mut Vec<UserContent>,
) {
    if !assistant_parts.is_empty() {
        let parts = std::mem::take(assistant_parts);
        if let Ok(content) = OneOrMany::many(parts) {
            out.push(Message::Assistant { id: None, content });
        }
    }
    if !tool_results.is_empty() {
        let results = std::mem::take(tool_results);
        if let Ok(content) = OneOrMany::many(results) {
            out.push(Message::User { content });
        }
    }
}
