//! Metadata for live messages in independently shared WhatsApp groups.
use async_graphql::{ID, Object};
use model_notifications::WhatsappGroupMessageMetadata;
/// GraphQL representation of a WhatsApp group message notification.
pub struct GraphqlWhatsappGroupMessageMetadata(pub WhatsappGroupMessageMetadata);
/// Metadata for a message in an independently shared WhatsApp group.
#[Object]
impl GraphqlWhatsappGroupMessageMetadata {
    /// Display name of the group.
    async fn group_name(&self) -> &str {
        &self.0.group_name
    }
    /// Message to open within the group.
    async fn message_id(&self) -> ID {
        ID(self.0.message_id.to_string())
    }
}
