use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Assistant,
    User,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(untagged, rename_all = "lowercase")]
pub enum InputContent {
    Text(String),
    Blocks(ContentKind),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentKind {
    Text {
        text: String,
        cache_control: Option<CacheControl>,
        // TODO?
        citations: Vec<serde_json::Value>,
    },
    Base64 {
        data: String,
        /// one of image/jpeg | image/png | image/gif | image/webp
        media_type: String,
    },
    Url {
        url: String,
    },
    ToolUse {
        id: String,
        input: serde_json::Value,
        name: String,
        cache_control: Option<CacheControl>,
    },
    ToolResponse {
        tool_use_id: String,
        cache_control: Option<CacheControl>,
        // his accepts more complete content input https://docs.claude.com/en/api/messages#tool-result
        content: String,
        is_err: bool,
    },
}

// who cares https://docs.claude.com/en/api/messages#tool-result
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CacheControl(serde_json::Value);

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct InputMessage {
    pub role: Role,
    pub content: InputContent,
}

// unused
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct McpServer;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Metadata {
    pub user_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ServiceTier {
    #[default]
    Auto,
    StandardOnly,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum SystemPrompt {
    Blocks(Vec<SystemContent>),
    Text(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SystemContent {
    r#type: String,
    text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "lowercase", tag = "type")]
pub enum Thinking {
    Enabled {
        budget_tokens: u32,
    },
    #[default]
    Disabled,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase", tag = "type")]
pub enum ToolChoice {
    Auto {
        disable_parallel_tool_use: bool,
    },
    Any {
        disable_parallel_tool_use: bool,
    },
    Tool {
        name: String,
        disable_parallel_tool_use: bool,
    },
    None,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Tool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CreateMessageRequestBody {
    pub model: String,
    pub messages: Vec<InputMessage>,
    pub max_tokens: u32,
    pub container: Option<String>,
    pub context_management: Option<String>,
    pub mcp_servers: Vec<McpServer>,
    pub metadata: Metadata,
    pub service_tier: ServiceTier,
    pub stop_sequences: Vec<String>,
    pub stream: bool,
    pub system: SystemPrompt,
    pub temperature: f32,
    pub thinking: Thinking,
    pub tool_choice: ToolChoice,
    pub tools: Vec<Tool>,
    pub top_k: u32,
    pub top_p: u32,
}
