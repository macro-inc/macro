use super::NewAttachment;
use agent::types::{ChatMessageContent, Role};
use chrono::{DateTime, Utc};
use model_entity::Entity;
use serde::{self, Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(sqlx::FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// The chat message id
    pub id: String,
    /// Message content
    pub content: ChatMessageContent,
    /// Whether the chat is from the user or system
    pub role: Role,
    /// the model used to generate the message
    pub model: Option<String>,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageWithAttachments {
    /// The chat message id
    pub id: String,
    /// Message content
    pub content: ChatMessageContent,
    /// Whether the chat is from the user or system
    pub role: Role,
    /// The ids of the attachments used to generate the message
    // transform to Vec<Entity<'static>>
    pub attachments: Vec<Entity<'static>>,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewChatMessage {
    /// Optional pre-generated ID. If None, the database generates one.
    pub id: Option<String>,
    /// Content of the message
    pub content: ChatMessageContent,
    /// Whether the chat is from the user or system
    pub role: Role,
    /// The ids of the attachments used to generate the message
    pub attachments: Option<Vec<NewAttachment>>,
    /// The model used to generate the chat (provider api id)
    pub model: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ChatMessage {
    pub fn content_text(&self) -> Option<String> {
        match self.role {
            Role::Assistant => self.content.assistant_message_text(),
            Role::User => self.content.user_message_text(),
            Role::System => self.content.system_message_text(),
        }
    }
    pub fn conent_text_with_tools(&self) -> Option<String> {
        match self.role {
            Role::Assistant => self.content.assistant_message_text_with_tools(),
            Role::User => self.content.user_message_text(),
            Role::System => self.content.system_message_text(),
        }
    }
}

impl NewChatMessage {
    pub fn content_text(&self) -> Option<String> {
        match self.role {
            Role::Assistant => self.content.assistant_message_text(),
            Role::User => self.content.user_message_text(),
            Role::System => self.content.system_message_text(),
        }
    }
    pub fn conent_text_with_tools(&self) -> Option<String> {
        match self.role {
            Role::Assistant => self.content.assistant_message_text_with_tools(),
            Role::User => self.content.user_message_text(),
            Role::System => self.content.system_message_text(),
        }
    }
}

impl ChatMessageWithAttachments {
    pub fn content_text(&self) -> Option<String> {
        match self.role {
            Role::Assistant => self.content.assistant_message_text(),
            Role::User => self.content.user_message_text(),
            Role::System => self.content.system_message_text(),
        }
    }
    pub fn conent_text_with_tools(&self) -> Option<String> {
        match self.role {
            Role::Assistant => self.content.assistant_message_text_with_tools(),
            Role::User => self.content.user_message_text(),
            Role::System => self.content.system_message_text(),
        }
    }
}
