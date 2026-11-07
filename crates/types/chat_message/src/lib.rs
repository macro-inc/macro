//! The role and content of a stored AI chat message.
//!
//! Split out of `agent` so the crates that store or ship chat messages
//! (`model`, `macro_db_client`, `chat`) don't depend on the agent loop and its
//! provider SDKs. `agent::types` re-exports these types.

use serde::{Deserialize, Serialize};
use std::fmt;
use strum::{Display, EnumString};

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/// The role of a message participant.
#[derive(
    Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Display, EnumString, strum::AsRefStr,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// A user message.
    User,
    /// An assistant (model) message.
    Assistant,
    /// A system prompt.
    System,
}

// ---------------------------------------------------------------------------
// AssistantMessagePart
// ---------------------------------------------------------------------------

/// A structured part within an assistant message.
///
/// When the model responds with tool calls the full turn is persisted as a
/// flat sequence of these parts. `agent`'s `to_rig_messages` reconstructs the
/// turn boundaries that providers expect.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistantMessagePart {
    /// Plain text produced by the model.
    Text {
        /// The text content.
        text: String,
    },
    /// A native tool call issued by the model.
    ToolCall {
        /// Tool name.
        name: String,
        /// Tool arguments as JSON.
        json: serde_json::Value,
        /// Provider-assigned call id.
        id: String,
    },
    /// A tool call routed through an MCP service.
    McpToolCall {
        /// Tool name.
        name: String,
        /// MCP service identifier.
        service: String,
        /// Optional human-readable name.
        display_name: Option<String>,
        /// Tool arguments as JSON.
        json: serde_json::Value,
        /// Provider-assigned call id.
        id: String,
    },
    /// A JSON response from a tool call.
    ToolCallResponseJson {
        /// Tool name.
        name: String,
        /// Response payload.
        json: serde_json::Value,
        /// Corresponding call id.
        id: String,
    },
    /// An error response from a tool call.
    ToolCallErr {
        /// Tool name.
        name: String,
        /// Human-readable error description.
        description: String,
        /// Corresponding call id.
        id: String,
    },
    /// A thinking/reasoning block from the model.
    Thinking {
        /// The thinking text content.
        thinking: String,
    },
}

impl fmt::Display for AssistantMessagePart {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Text { text } => write!(f, "{text}"),
            Self::ToolCall { name, id, .. } => write!(f, "[tool_call:{name}({id})]"),
            Self::McpToolCall {
                name, service, id, ..
            } => write!(f, "[mcp_tool_call:{service}/{name}({id})]"),
            Self::ToolCallResponseJson { name, id, .. } => {
                write!(f, "[tool_response:{name}({id})]")
            }
            Self::ToolCallErr {
                name, description, ..
            } => write!(f, "[tool_err:{name}: {description}]"),
            Self::Thinking { .. } => Ok(()),
        }
    }
}

// ---------------------------------------------------------------------------
// ChatMessageContent
// ---------------------------------------------------------------------------

/// The content of a [`ChatMessage`].
///
/// For user and system messages the content is plain [`Text`](Self::Text).
/// For assistant messages it may additionally be a sequence of
/// [`AssistantMessagePart`]s that encode tool-call round trips.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(untagged)]
pub enum ChatMessageContent {
    /// Plain text content.
    Text(String),
    /// Structured assistant message parts.
    AssistantMessageParts(Vec<AssistantMessagePart>),
}

impl Default for ChatMessageContent {
    fn default() -> Self {
        Self::Text(String::default())
    }
}

impl ChatMessageContent {
    /// Extract text suitable for display from a user message.
    ///
    /// Returns the full text for [`Text`](Self::Text) or an empty string for
    /// structured parts (which belong to assistant messages).
    pub fn user_message_text(&self) -> Option<String> {
        match self {
            Self::Text(t) => Some(t.clone()),
            Self::AssistantMessageParts(_) => None,
        }
    }

    /// Extract text from an assistant message, ignoring tool parts.
    pub fn assistant_message_text(&self) -> Option<String> {
        match self {
            Self::Text(t) => Some(t.clone()),
            Self::AssistantMessageParts(parts) => {
                let mut s = String::new();
                for p in parts {
                    if let AssistantMessagePart::Text { text } = p {
                        s.push_str(text);
                    }
                }
                Some(s)
            }
        }
    }

    /// Extract text from an assistant message, including a summary of tool
    /// calls.
    pub fn assistant_message_text_with_tools(&self) -> Option<String> {
        match self {
            Self::Text(t) => Some(t.clone()),
            Self::AssistantMessageParts(parts) => {
                let mut s = String::new();
                for p in parts {
                    use std::fmt::Write;
                    let _ = write!(s, "{p}");
                }
                Some(s)
            }
        }
    }

    /// Extract text from a system message.
    pub fn system_message_text(&self) -> Option<String> {
        match self {
            Self::Text(t) => Some(t.clone()),
            Self::AssistantMessageParts(_) => None,
        }
    }

    /// Extract the text content regardless of role.
    pub fn message_text(&self) -> String {
        match self {
            Self::Text(t) => t.clone(),
            Self::AssistantMessageParts(parts) => {
                let mut s = String::new();
                for p in parts {
                    if let AssistantMessagePart::Text { text } = p {
                        s.push_str(text);
                    }
                }
                s
            }
        }
    }

    /// Like [`message_text`](Self::message_text) but includes tool-call
    /// summaries.
    pub fn message_text_with_tools(&self) -> String {
        match self {
            Self::Text(t) => t.clone(),
            Self::AssistantMessageParts(parts) => {
                let mut s = String::new();
                for p in parts {
                    use std::fmt::Write;
                    let _ = write!(s, "{p}");
                }
                s
            }
        }
    }
}
