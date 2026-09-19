//! Content-capture policy and size bounding for GenAI span attributes.
//!
//! Prompts, tool arguments, tool results and model output are the most useful
//! and the most dangerous span attributes: an LLM-as-a-judge evaluation needs
//! them, but they carry user data and can be arbitrarily large. Two controls
//! apply to every content attribute this workspace records:
//!
//! - **Capture** — [`ContentPolicy::capture`], read once from the
//!   OpenTelemetry-standard `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`
//!   variable. It defaults to **on** here (the spec's default is off): the point
//!   of the instrumentation is evaluation, which is impossible without content,
//!   and traces already reach the same backend as the service logs. Set it to
//!   `false` to export structure (spans, names, usage, ids) only.
//! - **Size** — [`Limits`]. Every string leaf is cut to `max_part_chars`, and
//!   a whole attribute to `max_attribute_bytes`; message lists shed their
//!   oldest entries first so the most recent turn survives. Unbounded content
//!   would blow the OTLP batch past the agent's receive limit (dropping the
//!   whole batch) and pay for the same conversation once per model call.

#[cfg(test)]
mod test;

use macro_env_var::maybe_env_vars;
use std::borrow::Cow;
use std::sync::OnceLock;

maybe_env_vars! {
    pub struct OtelInstrumentationGenaiCaptureMessageContent;
}

/// Size budgets for content attributes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Maximum characters of a single string leaf — a text part, a tool
    /// argument value, a tool response. Longer values are cut and marked.
    pub max_part_chars: usize,
    /// Maximum bytes of one serialized attribute value. Message lists drop
    /// their oldest messages to fit; tool definitions drop their parameter
    /// schemas; anything else is cut and marked.
    pub max_attribute_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_part_chars: 8_000,
            max_attribute_bytes: 64_000,
        }
    }
}

/// Whether, and how much, content may be recorded on GenAI spans.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentPolicy {
    /// Record prompts, tool arguments/results and model output.
    pub capture: bool,
    /// Size budgets applied to everything recorded.
    pub limits: Limits,
}

impl Default for ContentPolicy {
    /// Capture on, default [`Limits`] — the same as an unset environment.
    fn default() -> Self {
        Self::enabled()
    }
}

impl ContentPolicy {
    /// Capture content with the default [`Limits`].
    pub const fn enabled() -> Self {
        Self {
            capture: true,
            limits: Limits {
                max_part_chars: 8_000,
                max_attribute_bytes: 64_000,
            },
        }
    }

    /// Record structure only.
    pub const fn disabled() -> Self {
        Self {
            capture: false,
            ..Self::enabled()
        }
    }

    /// The process-wide policy, read from
    /// `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` once and cached.
    /// Unset means capture is on; see [`Self::parse`].
    pub fn from_env() -> Self {
        static POLICY: OnceLock<ContentPolicy> = OnceLock::new();
        *POLICY.get_or_init(|| {
            Self::parse(OtelInstrumentationGenaiCaptureMessageContent::new().as_deref())
        })
    }

    /// Interpret the capture switch: `false`, `0`, `no` and `off`
    /// (case-insensitive) disable capture; anything else, including unset,
    /// enables it.
    pub fn parse(value: Option<&str>) -> Self {
        let off = value.is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "false" | "0" | "no" | "off"
            )
        });
        if off {
            Self::disabled()
        } else {
            Self::enabled()
        }
    }
}

/// Cut `s` to at most `max_chars` characters, appending a marker naming how
/// many characters were dropped. Borrows when nothing needs cutting.
pub fn truncate_chars(s: &str, max_chars: usize) -> Cow<'_, str> {
    // Bytes are never fewer than chars, so this cheap check settles the common case.
    if s.len() <= max_chars {
        return Cow::Borrowed(s);
    }
    let total = s.chars().count();
    if total <= max_chars {
        return Cow::Borrowed(s);
    }
    let mut cut: String = s.chars().take(max_chars).collect();
    cut.push_str(&format!("…[truncated {} chars]", total - max_chars));
    Cow::Owned(cut)
}

/// Room kept for the marker [`truncate_bytes`] appends, so a cut value never
/// overshoots its byte budget.
const TRUNCATION_MARKER_RESERVE: usize = 40;

/// Cut `s` to at most `max_bytes` bytes of UTF-8, on a character boundary,
/// appending a marker naming how many bytes were dropped. The marker is
/// counted against the budget. Borrows when nothing needs cutting.
pub fn truncate_bytes(s: &str, max_bytes: usize) -> Cow<'_, str> {
    if s.len() <= max_bytes {
        return Cow::Borrowed(s);
    }
    // A budget too small to hold the marker keeps half of itself; the marker
    // then overshoots, which beats recording nothing at all.
    let mut keep = max_bytes.saturating_sub(TRUNCATION_MARKER_RESERVE.min(max_bytes / 2));
    while keep > 0 && !s.is_char_boundary(keep) {
        keep -= 1;
    }
    let mut cut = s[..keep].to_owned();
    cut.push_str(&format!("…[truncated {} bytes]", s.len() - keep));
    Cow::Owned(cut)
}

/// Cut every string leaf in `value` to `max_part_chars` characters, in place.
/// Returns whether anything was cut.
fn bound_json_strings(value: &mut serde_json::Value, max_part_chars: usize) -> bool {
    match value {
        serde_json::Value::String(s) => match truncate_chars(s, max_part_chars) {
            Cow::Borrowed(_) => false,
            Cow::Owned(cut) => {
                *s = cut;
                true
            }
        },
        serde_json::Value::Array(items) => items.iter_mut().fold(false, |cut, item| {
            bound_json_strings(item, max_part_chars) || cut
        }),
        serde_json::Value::Object(map) => map.values_mut().fold(false, |cut, item| {
            bound_json_strings(item, max_part_chars) || cut
        }),
        _ => false,
    }
}

/// Serialize `value` as an opaque string attribute within `limits`: string
/// leaves are cut to `max_part_chars` characters, then the whole
/// serialization to `max_attribute_bytes` bytes. Returns the string and
/// whether anything was cut.
///
/// A cut serialization is no longer valid JSON, so use this only for
/// attributes the backend treats as plain text (tool arguments and results);
/// message lists and tool definitions have structure-preserving bounds
/// ([`bound_messages`], [`bound_tool_definitions`]).
pub fn bounded_json_string(value: &serde_json::Value, limits: &Limits) -> (String, bool) {
    let mut value = value.clone();
    let cut_parts = bound_json_strings(&mut value, limits.max_part_chars);
    let json = match value {
        // A bare string reads better than its quoted JSON encoding.
        serde_json::Value::String(s) => s,
        other => other.to_string(),
    };
    match truncate_bytes(&json, limits.max_attribute_bytes) {
        Cow::Borrowed(_) => (json, cut_parts),
        Cow::Owned(cut) => (cut, true),
    }
}

/// A bounded `gen_ai.*.messages` list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedMessages {
    /// The serialized JSON array.
    pub json: String,
    /// How many of the oldest messages were dropped to fit the budget.
    pub omitted: usize,
    /// Whether any content was cut (parts shortened or messages dropped).
    pub truncated: bool,
}

/// Bound a message list (see [`crate::messages`]) to `limits`: every string
/// leaf is cut to `max_part_chars`, then the oldest messages are dropped —
/// never the last one, which is the current turn — until the serialized list
/// fits `max_attribute_bytes`. A last message that is over budget on its own
/// is shrunk in place - its leaves cut shorter, then its oldest parts dropped
/// - so the result is always a valid JSON array.
pub fn bound_messages(mut messages: Vec<serde_json::Value>, limits: &Limits) -> BoundedMessages {
    let mut truncated = false;
    for message in &mut messages {
        truncated |= bound_json_strings(message, limits.max_part_chars);
    }
    let mut omitted = 0;
    let mut json = serialize(&messages);
    while json.len() > limits.max_attribute_bytes && messages.len() > 1 {
        messages.remove(0);
        omitted += 1;
        json = serialize(&messages);
    }
    if json.len() > limits.max_attribute_bytes
        && let Some(last) = messages.last_mut()
    {
        shrink_message(last, limits);
        truncated = true;
        json = serialize(&messages);
    }
    BoundedMessages {
        json,
        omitted,
        truncated: truncated || omitted > 0,
    }
}

/// Shrink one message until it serializes within the attribute budget: halve
/// the leaf budget while that helps, then drop its oldest parts (never the
/// last), and as a last resort keep only a note of what was dropped.
fn shrink_message(message: &mut serde_json::Value, limits: &Limits) {
    let over = |message: &serde_json::Value| message.to_string().len() > limits.max_attribute_bytes;
    let mut part_chars = limits.max_part_chars / 2;
    while over(message) && part_chars >= 16 {
        bound_json_strings(message, part_chars);
        part_chars /= 2;
    }
    while over(message) {
        let Some(parts) = message
            .get_mut("parts")
            .and_then(serde_json::Value::as_array_mut)
        else {
            break;
        };
        if parts.len() <= 1 {
            break;
        }
        parts.remove(0);
    }
    if over(message)
        && let Some(object) = message.as_object_mut()
    {
        let dropped = object
            .get("parts")
            .map(|parts| parts.to_string().len())
            .unwrap_or(0);
        object.insert(
            "parts".to_owned(),
            serde_json::json!([{
                "type": "text",
                "content": format!("[content omitted: {dropped} bytes]"),
            }]),
        );
    }
}

/// Bound a `gen_ai.tool.definitions` list to `limits`. Definitions are our
/// own code, not user content, so nothing is dropped unless the list is over
/// budget; then the parameter schemas go first (a judge grades a tool choice
/// on names and descriptions), then descriptions are cut. Returns the
/// serialized array and whether anything was removed or cut.
pub fn bound_tool_definitions(
    mut definitions: Vec<serde_json::Value>,
    limits: &Limits,
) -> (String, bool) {
    let json = serialize(&definitions);
    if json.len() <= limits.max_attribute_bytes {
        return (json, false);
    }
    for definition in &mut definitions {
        if let Some(object) = definition.as_object_mut() {
            object.remove("parameters");
        }
    }
    let json = serialize(&definitions);
    if json.len() <= limits.max_attribute_bytes {
        return (json, true);
    }
    for definition in &mut definitions {
        bound_json_strings(definition, limits.max_part_chars);
    }
    // Still over: the list itself is too long. Drop definitions from the end
    // rather than cut the serialization, so what remains is valid JSON.
    let mut json = serialize(&definitions);
    while json.len() > limits.max_attribute_bytes && !definitions.is_empty() {
        definitions.pop();
        json = serialize(&definitions);
    }
    (json, true)
}

fn serialize(values: &[serde_json::Value]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string())
}
