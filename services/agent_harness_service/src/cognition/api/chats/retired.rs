//! Chat create and copy routes, kept only to refuse stale clients.
//!
//! Legacy chats are read-only. Clients built before that still call
//! `POST /chats` and `POST /chats/{chat_id}/copy`; they get the same 410
//! `chat_read_only` body as `POST /stream/chat/message` instead of a bare
//! 404/405. These routes are deliberately left out of the OpenAPI spec.
use crate::cognition::api::stream::chat_message::ChatMessageError;

/// Refuse to create a legacy chat.
#[tracing::instrument]
pub async fn create_chat() -> ChatMessageError {
    ChatMessageError::chat_read_only()
}

/// Refuse to copy a legacy chat.
#[tracing::instrument]
pub async fn copy_chat() -> ChatMessageError {
    ChatMessageError::chat_read_only()
}

#[cfg(test)]
mod test;
