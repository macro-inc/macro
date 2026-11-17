//! Metadata for live messages in independently shared external chats, and
//! for linked accounts that stopped syncing.
use async_graphql::{ID, Object};
use model_notifications::{
    ExternalChatAccountEndedMetadata, ExternalChatAccountEndedReason, ExternalChatMessageMetadata,
};
/// GraphQL representation of an external chat message notification.
pub struct GraphqlExternalChatMessageMetadata(pub ExternalChatMessageMetadata);
/// Metadata for a message in an independently shared external chat.
#[Object]
impl GraphqlExternalChatMessageMetadata {
    /// The messaging service the chat lives in (`whatsapp`).
    async fn provider(&self) -> &'static str {
        self.0.provider.into()
    }
    /// Display name of the chat.
    async fn chat_name(&self) -> &str {
        &self.0.chat_name
    }
    /// Message to open within the chat.
    async fn message_id(&self) -> ID {
        ID(self.0.message_id.to_string())
    }
}

/// GraphQL representation of an ended external chat account notification.
pub struct GraphqlExternalChatAccountEndedMetadata(pub ExternalChatAccountEndedMetadata);
/// A linked external chat account that stopped syncing.
#[Object]
impl GraphqlExternalChatAccountEndedMetadata {
    /// The messaging service the account is at.
    async fn provider(&self) -> &'static str {
        self.0.provider.into()
    }
    /// The provider account.
    async fn account_id(&self) -> ID {
        ID(self.0.account_id.to_string())
    }
    /// What the account is called.
    async fn account_name(&self) -> &str {
        &self.0.account_name
    }
    /// Why it ended: `session_ended`, `restricted` or `unreadable`.
    async fn reason(&self) -> &'static str {
        match self.0.reason {
            ExternalChatAccountEndedReason::SessionEnded => "session_ended",
            ExternalChatAccountEndedReason::Restricted => "restricted",
            ExternalChatAccountEndedReason::Unreadable => "unreadable",
        }
    }
}
