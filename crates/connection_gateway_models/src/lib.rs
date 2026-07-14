#![deny(missing_docs)]
//! Shared types for the connection gateway service and client.

use model_entity::Entity;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A receipt for a message that was sent to a user.
#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct MessageReceipt {
    /// The user id of the user who received the message
    pub user_id: String,
    /// The numer of times the message was delivered to the user
    pub delivery_count: u64,
    /// If one of those connections was active for the entity
    pub active: bool,
}

/// Represents a single unique message sent to a recipient.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct UniqueMessage {
    /// the message to send
    pub message_content: serde_json::Value,
    /// all entity to send the message to
    pub entity: Entity<'static>,
    /// the type of the message we are sending
    pub message_type: String,
}

/// The body of a send message request.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct SendMessageBody {
    /// the message to send
    pub message: serde_json::Value,
    /// the type of the message we are sending
    pub message_type: String,
}

/// The body of a batch send message request.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct BatchSendMessageBody<'a> {
    /// the message to send
    pub message: serde_json::Value,
    /// all entities to send the message to
    pub entities: Vec<Entity<'a>>,
    /// the type of the message we are sending
    pub message_type: String,
}

/// The body of a batch send unique messages request.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct BatchSendUniqueMessagesBody {
    /// the messages to send
    pub messages: Vec<UniqueMessage>,
}

/// The response from sending a message.
#[derive(Serialize, Debug, ToSchema)]
pub struct SendMessageResponse {
    /// the receipts for each message sent
    pub receipts: Vec<MessageReceipt>,
}
