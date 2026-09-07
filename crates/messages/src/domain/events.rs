//! Committed message facts shared by consumers independently of transport.

use super::models::{Message, MessageParent, SimpleMention};
use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An attachment persisted with a posted message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageEventAttachment {
    /// Attachment row identifier.
    pub attachment_id: Uuid,
    /// Referenced entity type.
    pub entity_type: String,
    /// Referenced entity identifier.
    pub entity_id: String,
    /// Attachment creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// A committed post, independent of the surface presenting the conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessagePostedMetadata {
    /// Entity that owns the message and determines access to it.
    pub parent: MessageParent,
    /// Posted message identifier.
    pub message_id: Uuid,
    /// Root identifier for a reply; absent for a new root.
    pub thread_id: Option<Uuid>,
    /// Author, including bot principals.
    pub sender: ChannelSender<'static>,
    /// User whose invocation produced a bot response.
    pub triggered_by: Option<String>,
    /// Macro Markdown body.
    pub content: String,
    /// Explicit mentions recorded with the post.
    pub mentions: Vec<SimpleMention>,
    /// Persisted attachments available to authorized consumers.
    pub attachments: Vec<MessageEventAttachment>,
    /// Message creation timestamp.
    pub created_at: DateTime<Utc>,
}

impl MessagePostedMetadata {
    /// Build the event from the persisted message, never from client parent claims.
    pub fn from_message(message: &Message, mentions: Vec<SimpleMention>) -> Self {
        Self {
            parent: message.parent.clone(),
            message_id: message.id,
            thread_id: message.thread_id,
            sender: message.sender_id.clone(),
            triggered_by: message.triggered_by.clone(),
            content: message.content.clone(),
            mentions,
            attachments: message
                .attachments
                .iter()
                .map(|attachment| MessageEventAttachment {
                    attachment_id: attachment.id,
                    entity_type: attachment.entity_type.clone(),
                    entity_id: attachment.entity_id.clone(),
                    created_at: attachment.created_at,
                })
                .collect(),
            created_at: message.created_at,
        }
    }

    /// Stable identity of the conversation, shared by roots and replies.
    pub fn root_id(&self) -> Uuid {
        self.thread_id.unwrap_or(self.message_id)
    }
}
