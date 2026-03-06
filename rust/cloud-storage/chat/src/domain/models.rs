//! Types and errors used by the chat domain ports.

use ai::types::Model;
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
