#![allow(deprecated)]
use ai::types::Model;
use chrono::serde::ts_seconds_option;
use model::chat::{Chat, ChatAttachmentWithName, ChatMessageWithAttachments};
use serde::{Deserialize, Serialize};
use unfurl_service::GetUnfurlResponse;
use utoipa::ToSchema;

#[derive(sqlx::FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    /// The chat uuid
    pub id: String,
    /// Who the chat belongs to
    pub user_id: String,
    /// The project id the chat belongs to
    pub project_id: Option<String>,
    /// The name of the Chat
    pub name: String,
    /// The messages in the chat
    pub messages: Vec<ChatMessageWithAttachments>,
    /// The model used to generate the chat
    pub model: Option<Model>,
    /// The time the chat was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the chat was last updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// attachment context - attachments not attached to messages
    #[deprecated(note = "Attachments are now stateless and no longer float until message send")]
    pub attachments: Vec<ChatAttachmentWithName>,
    /// Current number of tokens in the chat
    pub token_count: Option<i64>,
    /// Available models for the chat
    pub available_models: Vec<Model>,
    /// message_id - web citation list
    pub web_citations: Vec<(String, Vec<GetUnfurlResponse>)>,
    /// whether the chat is persistent or not
    pub is_persistent: bool,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct ChatsResponse {
    pub chats: Vec<Chat>,
}
