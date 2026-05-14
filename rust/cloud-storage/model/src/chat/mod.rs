mod message;
pub mod preview;
pub mod utils;

use macro_user_id::user_id::MacroUserIdStr;
pub use message::{ChatMessage, ChatMessageWithAttachments, NewChatMessage};
use serde::{Deserialize, Serialize};
use strum::Display;
use utoipa::ToSchema;

use crate::comms::ChannelType;
use crate::document::FileType;

#[derive(sqlx::FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    /// The chat uuid
    pub id: String,
    /// The name of the chat
    pub name: String,
    /// Who the chat belongs to
    pub user_id: String,
    /// The model used to generate the chat
    pub model: Option<String>,
    /// The project id of the chat
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// The time the chat was created
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the chat was last updated
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    // count of tokens in the chat
    pub token_count: Option<i64>,
    // whether the chat is persistent or not
    pub is_persistent: bool,
    /// The time the chat was deleted
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Returns basic information of a chat used for some db queries
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct ChatBasic {
    pub id: String,
    pub name: String,
    pub user_id: MacroUserIdStr<'static>,
    pub project_id: Option<String>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq, ToSchema, Debug, Clone, Display, sqlx::Type)]
#[sqlx(type_name = "CloudStorageType", rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum AttachmentType {
    Document,
    Image,
    Channel,
    Email,
    Project,
}

#[derive(sqlx::FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
pub struct ChatAttachment {
    /// db attachment id - unused
    pub id: String,
    /// The type of attachment
    pub attachment_type: AttachmentType,
    /// The id of the attachment
    /// either a `document_id` or `project_id` or `chat_id`
    pub attachment_id: String,
    /// The id of the chat if the attachment is a chat
    pub chat_id: Option<String>,
    /// The id of the message if the attachment is a message
    pub message_id: Option<String>,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AttachmentMetadata {
    Document {
        /// Type of the document ['pdf' | 'docx' | 'md']
        document_type: FileType,
        /// Name of the document
        document_name: String,
    },
    Project {
        project_name: String,
    },
    Image {
        /// jpg | png | etc
        image_extension: FileType,
        /// image name
        image_name: String,
    },
    Channel {
        channel_name: String,
        channel_type: ChannelType,
    },
    /// an email thread
    Email {
        email_subject: String,
    },
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewChatAttachment {
    /// The id of the chat
    pub chat_id: String,
    pub attachment_type: AttachmentType,
    /// The id of the document
    pub attachment_id: String,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewMessageAttachment {
    pub message_id: String,
    pub attachment_type: AttachmentType,
    pub attachment_id: String,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, Eq, PartialEq, Clone)]
pub struct NewAttachment {
    pub attachment_type: AttachmentType,
    pub attachment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, schemars::JsonSchema)]
pub struct ChatHistory {
    pub conversation: Vec<ConversationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, schemars::JsonSchema)]
pub struct ConversationRecord {
    pub chat_id: String,
    pub title: String,
    pub messages: Vec<MessageWithAttachments>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MessageWithAttachments {
    pub content: String,
    pub date: chrono::DateTime<chrono::Utc>,
    pub attachment_ids: Vec<String>,
}
