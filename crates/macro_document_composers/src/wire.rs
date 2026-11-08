//! Wire-only source replay retains legacy cases; native route parsing rejects them.
/// Exact source-function replay for the complete recorded corpus.
pub use crate::context_wire::compose_agent_context_prompt as compose_source_context;
/// Source image-function input, including cases outside the endpoint contract.
pub use crate::image::WireImageInput;
/// Exact source image function, before endpoint validation.
pub use crate::image::compose_source_image;
use macro_document_model::{DocumentContext, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
mod announcement;
pub use announcement::*;
/// Markdown response shared by the composer routes.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarkdownResponse {
    /// Composed Markdown bytes.
    pub markdown: String,
}
/// Markdown input shared by extraction routes.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarkdownRequest {
    /// Authored Markdown.
    pub markdown: String,
}
/// Parse the current server request and reject every obsolete conversation field.
#[cfg(not(target_arch = "wasm32"))]
pub fn agent_context_from_json(value: &Value) -> Result<AgentContextRequest> {
    for name in [
        "parent",
        "anchor",
        "replyTarget",
        "promptMessageId",
        "thread",
        "channel",
    ] {
        if value.get(name).is_some() {
            return Err(Error::InvalidArgument("legacy conversation fields".into()));
        }
    }
    let request: AgentContextRequest = serde_json::from_value(value.clone())?;
    crate::context::validate_context(&serde_json::to_value(&request)?)?;
    Ok(request)
}
/// Handle the current typed server prompt endpoint.
#[cfg(not(target_arch = "wasm32"))]
pub fn handle_agent_context(value: &Value, context: &DocumentContext) -> Result<MarkdownResponse> {
    Ok(MarkdownResponse {
        markdown: compose_agent_context(&agent_context_from_json(value)?, context)?,
    })
}
/// Validate endpoint UUID, URL and positive u32 dimensions without rewriting strings.
pub fn image_from_json(value: &Value) -> Result<crate::ImageMarkdownInput> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Input {
        static_file_id: String,
        url: String,
        width: std::num::NonZeroU32,
        height: std::num::NonZeroU32,
    }
    let input: Input = serde_json::from_value(value.clone())?;
    let bytes = input.static_file_id.as_bytes();
    let uuid = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    let special = input.static_file_id == "00000000-0000-0000-0000-000000000000"
        || input
            .static_file_id
            .eq_ignore_ascii_case("ffffffff-ffff-ffff-ffff-ffffffffffff");
    let version = bytes
        .get(14)
        .is_some_and(|value| (b'1'..=b'8').contains(value));
    let variant = bytes
        .get(19)
        .is_some_and(|value| matches!(value.to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b'));
    if !(uuid && (special || version && variant)) {
        return Err(Error::InvalidArgument("invalid static file UUID".into()));
    }
    if url::Url::parse(lexical_model::js_trim(&input.url)).is_err() {
        return Err(Error::InvalidArgument("invalid image URL".into()));
    }
    Ok(crate::ImageMarkdownInput {
        static_file_id: input.static_file_id,
        url: input.url,
        width: input.width,
        height: input.height,
    })
}
/// Handle validated generated-image Markdown.
pub fn handle_image_markdown(value: &Value, context: &DocumentContext) -> Result<MarkdownResponse> {
    Ok(MarkdownResponse {
        markdown: crate::compose_image_markdown(&image_from_json(value)?, context)?,
    })
}

/// Current endpoint input preserving IDs and time facts verbatim.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextRequest {
    /// Authored prompt text.
    pub prompt_markdown: String,
    /// Private instructions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "non_null_option")]
    pub instructions: Option<String>,
    /// Session owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "non_null_option")]
    pub owner: Option<crate::AgentContextPerson>,
    /// Distinct sender.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "non_null_option")]
    pub sender: Option<crate::AgentContextPerson>,
    /// Caller-provided time facts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "non_null_option")]
    pub current_time: Option<crate::AgentContextCurrentTime>,
    /// Current trigger shape with source string scalars.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "non_null_option")]
    pub trigger: Option<crate::wire_trigger::TriggerContext>,
}
/// Render a validated wire request without canonicalizing its scalar values.
#[cfg(not(target_arch = "wasm32"))]
pub fn compose_agent_context(
    input: &AgentContextRequest,
    context: &DocumentContext,
) -> Result<String> {
    let value = serde_json::to_value(input)?;
    crate::context::validate_context(&value)?;
    compose_source_context(&value, context)
}

pub(crate) fn non_null_option<'de, D, T>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
/// Ordered channel mentions from authored Markdown.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Mentions {
    /// Deduplicated shareable entity references.
    pub mentions: Vec<macro_document_model::mentions::MessageReference>,
}
/// Parse Markdown before extracting references, including nested presented forms.
pub fn handle_mentions(input: &MarkdownRequest, context: &DocumentContext) -> Result<Mentions> {
    Ok(Mentions {
        mentions: macro_document_model::mentions::extract_channel_mentions_from_markdown(
            &input.markdown,
            context,
        )?,
    })
}
/// Leading reply target, when followed by authored content.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractReplyResponse {
    /// Full source reply data or null.
    pub reply: Option<macro_document_model::nodes::ReplyTargetNode>,
}
/// Extract an explicit reply using the portable document model.
pub fn handle_extract_reply(
    input: &MarkdownRequest,
    context: &DocumentContext,
) -> Result<ExtractReplyResponse> {
    Ok(ExtractReplyResponse {
        reply: macro_document_model::mentions::extract_explicit_reply(&input.markdown, context)?,
    })
}
