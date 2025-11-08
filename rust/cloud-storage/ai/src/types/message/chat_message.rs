use super::Role;
use crate::tokens::{TokenCount, count_tokens};
use anyhow::Result;
use async_openai::types::ChatCompletionRequestMessage;
use serde::{self, Deserialize, Serialize};
use std::fmt::{Display, Write};
use utoipa::ToSchema;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatMessages(pub Vec<ChatMessage>);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatMessage {
    pub content: ChatMessageContent,
    pub role: Role,
    pub image_urls: Option<Vec<String>>,
}

impl TokenCount for ChatMessage {
    fn token_count(&self) -> Result<i64> {
        let messages = Vec::<ChatCompletionRequestMessage>::from(self.clone());
        let messages_str = serde_json::to_string(&messages)?;
        count_tokens(&messages_str)
    }
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(untagged)]
pub enum ChatMessageContent {
    Text(String),
    AssistantMessageParts(Vec<AssistantMessagePart>),
}

impl From<&str> for ChatMessageContent {
    fn from(value: &str) -> Self {
        Self::Text(value.into())
    }
}

impl From<String> for ChatMessageContent {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}

impl std::default::Default for ChatMessageContent {
    fn default() -> Self {
        ChatMessageContent::Text(String::default())
    }
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UserMessagePart {
    Text(String),
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistantMessagePart {
    Text {
        text: String,
    },
    ToolCall {
        name: String,
        json: serde_json::Value,
        id: String,
    },
    ToolCallResponseJson {
        name: String,
        json: serde_json::Value,
        id: String,
    },
    ToolCallErr {
        name: String,
        description: String,
        id: String,
    },
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToolResponseMessage {
    ToolCallResponseText {
        name: String,
        response: String,
        id: String,
    },
}

impl ChatMessageContent {
    pub fn user_message_text(&self) -> Option<String> {
        match self {
            Self::Text(text) => Some(text.to_owned()),
            Self::AssistantMessageParts(_) => None,
        }
    }

    pub fn assistant_message_text_with_tools(&self) -> Option<String> {
        match self {
            Self::Text(text) => Some(text.to_owned()),
            Self::AssistantMessageParts(parts) => {
                let mut response = String::new();
                parts.iter().for_each(|part| {
                    let _ = write!(response, "{}", part);
                });
                Some(response)
            }
        }
    }

    pub fn assistant_message_text(&self) -> Option<String> {
        match self {
            Self::Text(text) => Some(text.to_owned()),
            Self::AssistantMessageParts(parts) => {
                let mut response = String::new();
                parts.iter().for_each(|part| {
                    if let AssistantMessagePart::Text { text } = part {
                        let _ = write!(response, "{}", text);
                    }
                });
                Some(response)
            }
        }
    }

    pub fn system_message_text(&self) -> Option<String> {
        if let Self::Text(text) = self {
            Some(text.to_owned())
        } else {
            None
        }
    }
    pub fn message_text(&self) -> String {
        match self {
            Self::Text(text) => text.to_owned(),
            Self::AssistantMessageParts(parts) => {
                let mut response = String::new();
                parts.iter().for_each(|part| {
                    if let AssistantMessagePart::Text { text } = part {
                        let _ = write!(response, "{}", text);
                    }
                });
                response
            }
        }
    }
    pub fn message_text_with_tools(&self) -> String {
        match self {
            Self::Text(text) => text.to_owned(),
            Self::AssistantMessageParts(parts) => {
                let mut response = String::new();
                parts.iter().for_each(|part| {
                    let _ = write!(response, "{}", part);
                });
                response
            }
        }
    }
}

impl Display for AssistantMessagePart {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Text { text } => write!(f, "{}", text),
            Self::ToolCall { name, json, .. } => write!(f, "tool call: {}\n{}", name, json),
            Self::ToolCallResponseJson { name, json, .. } => {
                write!(f, "tool response {}: {}", name, json)
            }
            Self::ToolCallErr {
                name, description, ..
            } => {
                write!(f, "tool call failed {}: {}", name, description)
            }
        }
    }
}
