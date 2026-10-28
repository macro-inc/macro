use crate::types::request::Role;
use crate::types::response::code_execution::{
    BashCodeExecutionResponse, TextEditorCodeExecutionResponse,
};
use crate::types::response::web_fetch::WebFetchResponse;
use crate::types::response::web_search::WebSearchResponse;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResponseContentKind {
    Text(TextResponse),
    Thinking(ThinkingResponse),
    ToolUse(ToolUse),
    ServerToolUse(ServerToolUse),
    WebSearchToolResult(WebSearchResponse),
    WebFetchToolResult(WebFetchResponse),
    BashCodeExecutionToolResult(BashCodeExecutionResponse),
    TextEditorCodeExecutionToolResult(TextEditorCodeExecutionResponse),
    #[serde(other)]
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case", untagged)]
pub enum Content {
    Text(String),
    Array(Vec<ResponseContentKind>),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ServerToolUse {
    pub id: String,
    pub input: serde_json::Value,
    // one of web_search | web_fetch | code_execution | bash_code_execution | text_editor_code_execution
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ToolUse {
    pub id: String,
    pub input: serde_json::Value,
    pub name: String,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ThinkingResponse {
    pub signature: String,
    pub thinking: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RedactedThinking {
    pub data: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct TextResponse {
    #[serde(default)]
    citations: Vec<serde_json::Value>,
    text: String,
}

/// Why the model stopped generating.
///
/// Every variant the API documents is named so callers can match on it, and
/// anything newer lands in [`StopReason::Unknown`]: a stop reason this crate
/// has not heard of must not make the whole response unparseable, since the
/// content it carries is still good.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    StopSequence,
    ToolUse,
    /// A server-tool loop (web search, web fetch, code execution) hit its
    /// iteration limit. The content so far is complete up to that point;
    /// sending it back continues the turn.
    PauseTurn,
    Refusal,
    /// The response filled the model's context window; treat it as truncated.
    ModelContextWindowExceeded,
    /// A stop reason added to the API after this enum.
    #[serde(other)]
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ApiError {
    pub r#type: String,
    pub request_id: String,
    pub error: Error,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Error {
    pub r#type: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u32>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_tool_use: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
}

/// Container information for code execution sessions
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Container {
    /// Unique identifier for the container
    pub id: String,
    /// When the container expires (ISO 8601 timestamp)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct MessageResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Content>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub stop_reason: Option<StopReason>,
    pub stop_sequence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_management: Option<serde_json::Value>,
    /// Container information for code execution sessions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<Container>,
}
