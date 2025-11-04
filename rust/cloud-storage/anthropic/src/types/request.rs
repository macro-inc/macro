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
    Blocks(Vec<ContentKind>),
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
        input: String,
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
    /// An external identifier for the user who is associated with the request.
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

impl SystemPrompt {
    pub fn push_text(&mut self, text: &str) {
        match self {
            Self::Blocks(parts) => {
                parts.push(SystemContent {
                    r#type: "text".into(),
                    text: text.to_owned(),
                    cache_control: None,
                    citations: None,
                });
            }
            Self::Text(prompt) => {
                prompt.push_str(text);
            }
        }
    }
}

impl Default for SystemPrompt {
    fn default() -> Self {
        SystemPrompt::Text("".into())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SystemContent {
    /// type: "text"
    pub r#type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citations: Option<serde_json::Value>,
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

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq)]
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
    #[default]
    None,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Tool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Default, Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CreateMessageRequestBody {
    /// The model that will complete your prompt.
    /// https://docs.claude.com/en/docs/about-claude/models/overview
    pub model: String,
    /// Input messages.
    pub messages: Vec<InputMessage>,
    /// The maximum number of tokens to generate before stopping.
    pub max_tokens: u32,
    /// !Not Implemented!
    /// Container identifier for reuse across requests.
    /// Container parameters with skills to be loaded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    /// !Not Implemented!
    /// Context management configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_management: Option<String>,
    /// !Not Implemented!
    /// MCP servers to be utilized in this request
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<Vec<McpServer>>,
    /// An object describing metadata about the request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Metadata>,
    /// Determines whether to use priority capacity (if available) or standard capacity for this request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<ServiceTier>,
    /// Custom text sequences that will cause the model to stop generating.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequences: Option<Vec<String>>,
    /// Whether to incrementally stream the response using server-sent events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    /// System prompt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<SystemPrompt>,
    /// Amount of randomness injected into the response.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    /// Configuration for enabling Claude's extended thinking.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<Thinking>,
    /// How the model should use the provided tools. The model can use a specific tool, any available tool, decide by itself, or not use tools at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,
    /// Definitions of tools that the model may use.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool>>,
    /// Only sample from the top K options for each subsequent token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
    /// Use nucleus sampling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
}
