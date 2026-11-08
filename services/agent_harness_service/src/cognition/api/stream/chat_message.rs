//! The retired send endpoint for legacy AI chats.
//!
//! Legacy chats are read-only: their history stays readable, and new
//! conversations happen in agent sessions.
use axum::Json;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Why a chat message was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageErrorCode {
    /// Legacy chats are read-only; nothing can be sent to one.
    ChatReadOnly,
}

/// Error response for the chat message endpoint.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatMessageError {
    /// Human-readable message.
    pub error: String,
    /// Stable machine-readable code.
    pub code: ChatMessageErrorCode,
}

impl IntoResponse for ChatMessageError {
    fn into_response(self) -> axum::response::Response {
        let status = match self.code {
            ChatMessageErrorCode::ChatReadOnly => StatusCode::GONE,
        };
        (status, Json(self)).into_response()
    }
}

/// Refuse a chat message: legacy AI chats are read-only.
///
/// Every request is refused, whether or not the chat exists, before any
/// admission, storage, or model work. Start an agent session instead.
#[utoipa::path(
    post,
    path = "/stream/chat/message",
    responses(
        (status = 410, description = "Legacy AI chats are read-only; start an agent session instead", body = ChatMessageError),
    )
)]
#[tracing::instrument]
pub async fn send_chat_message() -> ChatMessageError {
    ChatMessageError {
        error: "AI chats are read-only. Start an agent session instead.".to_owned(),
        code: ChatMessageErrorCode::ChatReadOnly,
    }
}

#[cfg(test)]
mod test;
