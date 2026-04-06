//! Types and errors used by the chat domain ports.

use ai::types::{ChatMessageContent, Model};
use entity_access::domain::models::AccessError;
use model::chat::{ChatAttachmentWithName, ChatMessageWithAttachments};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

/// Domain error type for chat operations.
#[derive(Debug, Error)]
pub enum ChatErr {
    /// The requested chat was not found.
    #[error("chat not found")]
    NotFound,
    /// An unexpected error occurred.
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
    /// Bad request
    #[error("bad request: {0}")]
    BadRequest(String),
    /// Access denied.
    #[error(transparent)]
    Access(#[from] AccessError),
}

#[cfg(feature = "inbound")]
impl axum::response::IntoResponse for ChatErr {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;

        let (status, msg) = match &self {
            ChatErr::NotFound => (StatusCode::NOT_FOUND, "Not found"),
            ChatErr::BadRequest(_) => (StatusCode::BAD_REQUEST, "Bad request"),
            ChatErr::Access(
                AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
            ) => (StatusCode::FORBIDDEN, "Forbidden"),
            ChatErr::Access(AccessError::NotFound(_)) => (StatusCode::NOT_FOUND, "Not found"),
            ChatErr::Access(AccessError::BadRequest(_)) => (StatusCode::BAD_REQUEST, "Bad request"),
            ChatErr::Unknown(_) | ChatErr::Access(_) => {
                tracing::error!(error=?self, "chat handler error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
        };

        (status, msg.to_string()).into_response()
    }
}

/// Arguments for creating a new chat.
#[derive(Debug)]
pub struct CreateChatArgs {
    /// The name of the chat.
    pub name: String,
    /// The project to associate the chat with.
    pub project_id: Option<String>,
}

/// Arguments for copying a chat.
#[derive(Debug)]
pub struct CopyChatArgs {
    /// The name for the new (copied) chat.
    pub name: String,
    /// The project to place the copy in (may differ from the source).
    pub project_id: Option<String>,
}

/// Arguments for patching a chat.
#[derive(Debug)]
pub struct PatchChatArgs {
    /// New name for the chat, if changing.
    pub name: Option<String>,
    /// New project ID for the chat, if moving. Empty string clears the project.
    pub project_id: Option<String>,
    /// Share permission updates, if changing.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}

/// A web citation associated with a chat message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema, Default)]
pub struct WebCitation {
    /// The URL of the citation.
    pub url: String,
    /// The title of the cited page.
    pub title: String,
    /// A description of the cited page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The URL of the page's image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// The URL of the page's favicon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
}

/// Wrapper response for get_chat, matching the DCS API response shape.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetChatResponse {
    /// The full chat data.
    pub chat: ChatResponse,
    /// The requesting user's access level on this chat.
    pub user_access_level: AccessLevel,
}

/// The full chat response, matching the DCS API response shape.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    /// The chat uuid.
    pub id: String,
    /// Who the chat belongs to.
    pub user_id: String,
    /// The project id the chat belongs to.
    pub project_id: Option<String>,
    /// The name of the chat.
    pub name: String,
    /// The messages in the chat.
    pub messages: Vec<ChatMessageWithAttachments>,
    /// The model used to generate the chat.
    pub model: Option<Model>,
    /// The time the chat was created.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the chat was last updated.
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Attachment context — attachments not attached to messages.
    #[deprecated(note = "Attachments are now stateless and no longer float until message send")]
    pub attachments: Vec<ChatAttachmentWithName>,
    /// Current number of tokens in the chat.
    pub token_count: Option<i64>,
    /// Available models for the chat.
    pub available_models: Vec<Model>,
    /// Message ID to web citation list.
    pub web_citations: Vec<(String, Vec<WebCitation>)>,
    /// Whether the chat is persistent or not.
    pub is_persistent: bool,
}

/// Arguments for patching a chat message's content.
#[derive(Debug)]
pub struct PatchChatMessageArgs {
    /// The message ID to patch.
    pub message_id: String,
    /// The new content for the message.
    pub content: ChatMessageContent,
}
