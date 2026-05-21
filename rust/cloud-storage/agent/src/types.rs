//! Message and model types previously exported from `ai::types`.
//!
//! These live in the `agent` crate so that consumers which relied on
//! `ai::types::{Role, ChatMessage, …}` can import them from `agent::types`
//! instead.

use attachment::Attachments;
use serde::{Deserialize, Serialize};
use std::fmt;
use strum::{Display, EnumString};
use utoipa::ToSchema;

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/// The role of a message participant.
#[derive(
    Serialize,
    Deserialize,
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Display,
    EnumString,
    ToSchema,
    strum::AsRefStr,
)]
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
/// flat sequence of these parts.  [`crate::convert::to_rig_messages`]
/// reconstructs the turn boundaries that providers expect.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
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
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
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

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

/// A single chat message with its role, content, and optional attachments.
#[derive(Debug)]
pub struct ChatMessage {
    /// The content of the message.
    pub content: ChatMessageContent,
    /// Which participant produced this message.
    pub role: Role,
    /// Resolved attachments (if any) associated with this message.
    pub attachments: Option<Attachments<'static>>,
}

// ---------------------------------------------------------------------------
// ChatMessages
// ---------------------------------------------------------------------------

/// A sequence of [`ChatMessage`]s.
#[derive(Debug)]
pub struct ChatMessages(pub Vec<ChatMessage>);

impl ChatMessages {
    /// Borrow the inner slice.
    pub fn as_slice(&self) -> &[ChatMessage] {
        &self.0
    }
}

impl From<Vec<ChatMessage>> for ChatMessages {
    fn from(v: Vec<ChatMessage>) -> Self {
        Self(v)
    }
}

impl std::ops::Deref for ChatMessages {
    type Target = [ChatMessage];
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
