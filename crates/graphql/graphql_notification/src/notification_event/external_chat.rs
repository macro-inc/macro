//! Metadata for live messages in independently shared external chats.
use async_graphql::{ID, Object};
use model_notifications::ExternalChatMessageMetadata;
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
