use super::request::Role;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentKind {
    Text(TextResponse),
    Thinking(ThinkingResponse),
    ToolUse(ToolUse),
    // there are many more options that could be implemented here
    // https://docs.claude.com/en/api/messages#responsewebfetchtoolresultblock
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case", untagged)]
pub enum Content {
    Text(String),
    Array(Vec<ContentKind>),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct WebSearchToolResult {
    pub content: serde_json::Value,
    pub tool_use_id: String,
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
    citations: Vec<serde_json::Value>,
    text: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    StopSequence,
    ToolUse,
    PausTurn,
    Refusal,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<serde_json::Value>,
}
