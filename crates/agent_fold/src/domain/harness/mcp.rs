//! MCP's result envelope, as it reaches the fold through any harness.
//!
//! Not a harness: MCP is the protocol a harness reaches an external tool
//! server over, and it wraps every result the same way whoever the harness
//! is - [`CallToolResult`], `{ content: [blocks], structuredContent?,
//! isError? }`. A harness may copy that whole envelope into ACP's `rawOutput`
//! rather than the tool's own JSON, so the fold unwraps it before reading.
//! Its content blocks are the same shape as ACP's [`ContentBlock`], which is
//! what they deserialize as.
//!
//! What is inside the envelope belongs to whoever serves the tool; this
//! module does not read it. A value that is not an envelope is left alone.

use agent_client_protocol::schema::v1::ContentBlock;
use serde::Deserialize;
use serde_json::Value;

/// MCP's `CallToolResult`, as far as the fold reads it.
///
/// Deserializing an object into this is how an envelope is recognized: a
/// tool's own JSON may well have a `content` field (Macro's `ReadContent`
/// returns `{ content: { text }, comments }`), but only an array of typed
/// blocks deserializes as one, and an object with neither `content` nor
/// `structuredContent` is no envelope at all.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallToolResult {
    content: Option<Vec<ContentBlock>>,
    structured_content: Option<Value>,
    #[serde(default)]
    is_error: bool,
}

impl CallToolResult {
    /// The envelope `raw` is, if it is one.
    fn recognize(raw: &Value) -> Option<Self> {
        match raw {
            Value::Object(_) => {
                let result: Self = serde_json::from_value(raw.clone()).ok()?;
                (result.content.is_some() || result.structured_content.is_some()).then_some(result)
            }
            // How Claude Code copies `content` into `rawOutput`: the blocks
            // alone, no envelope around them.
            Value::Array(items) if !items.is_empty() => {
                let content: Vec<ContentBlock> = serde_json::from_value(raw.clone()).ok()?;
                Some(Self {
                    content: Some(content),
                    structured_content: None,
                    is_error: false,
                })
            }
            _ => None,
        }
    }

    /// The text blocks' text, in order.
    fn texts(&self) -> Vec<&str> {
        self.content
            .iter()
            .flatten()
            .filter_map(|block| match block {
                ContentBlock::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect()
    }
}

/// A tool's own result, with any MCP [`CallToolResult`] envelope removed,
/// and the error text when the envelope marked the call failed.
///
/// Preference order for the payload: `structuredContent`; else the first
/// text block that parses as JSON; else the text blocks joined as a string;
/// else `null`. A value that is not an envelope is returned untouched.
#[must_use]
pub fn unwrap_call_result(raw: &Value) -> (Value, Option<String>) {
    let Some(result) = CallToolResult::recognize(raw) else {
        return (raw.clone(), None);
    };
    let texts = result.texts();
    let error = result.is_error.then(|| texts.join("\n"));

    if let Some(structured) = result.structured_content {
        return (structured, error);
    }
    if let Some(parsed) = texts
        .iter()
        .find_map(|text| serde_json::from_str::<Value>(text).ok())
    {
        return (parsed, error);
    }
    if texts.is_empty() {
        return (Value::Null, error);
    }
    (Value::String(texts.join("\n")), error)
}
