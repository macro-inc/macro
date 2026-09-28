//! Builders for the GenAI semantic-convention JSON shapes.
//!
//! `gen_ai.input.messages` / `gen_ai.output.messages` are arrays of
//! `{"role": …, "parts": […]}` objects (output messages add
//! `"finish_reason"`), `gen_ai.system_instructions` is an array of parts and
//! `gen_ai.tool.definitions` an array of function definitions. Datadog parses
//! exactly these shapes; a backend without structured attributes receives them
//! as JSON strings, which is how this workspace records them (see
//! [`crate::bound_messages`] for the size bounds applied on the way out).
//!
//! The builders take plain values so callers stay independent of any agent
//! runtime's message types.

#[cfg(test)]
mod test;

use serde_json::{Value, json};

/// The `user` role.
pub const ROLE_USER: &str = "user";
/// The `assistant` role.
pub const ROLE_ASSISTANT: &str = "assistant";
/// The `system` role.
pub const ROLE_SYSTEM: &str = "system";
/// The `tool` role (tool results).
pub const ROLE_TOOL: &str = "tool";

/// Where a media part's bytes live. Inline data is never copied onto a span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaSource {
    /// A URL.
    Uri(String),
    /// A provider-side file id.
    FileId(String),
    /// Inline bytes (base64, raw, …) — recorded as a placeholder only.
    Inline,
}

/// A text part.
pub fn text_part(content: impl Into<String>) -> Value {
    json!({ "type": "text", "content": content.into() })
}

/// A reasoning (thinking) part.
pub fn reasoning_part(content: impl Into<String>) -> Value {
    json!({ "type": "reasoning", "content": content.into() })
}

/// A tool call requested by the model.
pub fn tool_call_part(id: Option<&str>, name: &str, arguments: Value) -> Value {
    let mut part = json!({ "type": "tool_call", "name": name, "arguments": arguments });
    if let Some(id) = id {
        part["id"] = Value::String(id.to_string());
    }
    part
}

/// The response to a tool call.
pub fn tool_call_response_part(id: Option<&str>, response: Value) -> Value {
    let mut part = json!({ "type": "tool_call_response", "response": response });
    if let Some(id) = id {
        part["id"] = Value::String(id.to_string());
    }
    part
}

/// A media part (`image`, `audio`, `video`, `document` modality). Inline
/// bytes are replaced by a placeholder: a span is not the place for a file.
/// A URI is recorded without its credentials, query or fragment (see
/// [`redact_uri`]).
pub fn media_part(modality: &str, mime_type: Option<&str>, source: MediaSource) -> Value {
    let mut part = match source {
        MediaSource::Uri(uri) => {
            json!({ "type": "uri", "modality": modality, "uri": redact_uri(&uri) })
        }
        MediaSource::FileId(file_id) => {
            json!({ "type": "file", "modality": modality, "file_id": file_id })
        }
        MediaSource::Inline => {
            json!({ "type": "blob", "modality": modality, "content": "[inline data omitted]" })
        }
    };
    if let Some(mime_type) = mime_type {
        part["mime_type"] = Value::String(mime_type.to_string());
    }
    part
}

/// A URI reduced to what identifies the resource: scheme, host and path.
/// Userinfo (`user:password@`), the query string and the fragment are
/// dropped - that is where credentials, signed-URL tokens and session state
/// travel, none of which belongs on a span. A `data:` URI *is* its payload,
/// so only its media type survives.
pub fn redact_uri(uri: &str) -> String {
    let uri = uri.split(['?', '#']).next().unwrap_or_default();
    let (scheme, rest) = match uri.split_once(':') {
        Some((scheme, rest)) if is_scheme(scheme) => (Some(scheme), rest),
        _ => (None, uri),
    };
    if scheme.is_some_and(|scheme| scheme.eq_ignore_ascii_case("data")) {
        let media_type = rest.split([';', ',']).next().unwrap_or_default();
        return format!("data:{media_type};[inline data omitted]");
    }
    // Hierarchical (`scheme://authority/path`) or protocol-relative
    // (`//authority/path`): the authority may carry userinfo.
    if let Some(rest) = rest.strip_prefix("//") {
        let (authority, path) = match rest.find('/') {
            Some(slash) => rest.split_at(slash),
            None => (rest, ""),
        };
        let host = authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host);
        return match scheme {
            Some(scheme) => format!("{scheme}://{host}{path}"),
            None => format!("//{host}{path}"),
        };
    }
    // Opaque (`urn:…`, `mailto:…`): the identifier is the whole thing.
    uri.to_owned()
}

/// Whether `candidate` is a URI scheme (RFC 3986: a letter, then letters,
/// digits, `+`, `-` or `.`).
fn is_scheme(candidate: &str) -> bool {
    let mut chars = candidate.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

/// An input message.
pub fn message(role: &str, parts: Vec<Value>) -> Value {
    json!({ "role": role, "parts": parts })
}

/// An output message (one choice) with the reason generation stopped.
pub fn output_message(role: &str, parts: Vec<Value>, finish_reason: &str) -> Value {
    json!({ "role": role, "parts": parts, "finish_reason": finish_reason })
}

/// The `gen_ai.system_instructions` value for one block of instructions.
pub fn system_instructions(text: impl Into<String>) -> Vec<Value> {
    vec![text_part(text)]
}

/// One entry of `gen_ai.tool.definitions`.
pub fn tool_definition(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "name": name,
        "description": description,
        "parameters": parameters,
    })
}
