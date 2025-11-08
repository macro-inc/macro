use anyhow::Result;
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    #[serde(rename = "type")]
    pub message_type: String,
    pub data: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum OutgoingMessage {
    Pong,
    Message(Message),
}

// Represents a single unique message sent to a recipient
#[derive(serde::Deserialize, serde::Serialize, Debug, ToSchema)]
pub struct UniqueMessage {
    /// the message to send
    pub message_content: serde_json::Value,
    /// all entity to send the message to
    pub entity: Entity<'static>,
    /// the type of the message we are sending
    pub message_type: String,
}

impl TryFrom<Message> for axum::extract::ws::Message {
    type Error = anyhow::Error;

    fn try_from(msg: Message) -> Result<Self> {
        let string: String = serde_json::to_string(&msg)?;
        Ok(axum::extract::ws::Message::Text(string))
    }
}

impl TryFrom<OutgoingMessage> for axum::extract::ws::Message {
    type Error = anyhow::Error;

    fn try_from(msg: OutgoingMessage) -> Result<Self> {
        match msg {
            OutgoingMessage::Pong => Ok(axum::extract::ws::Message::Text("pong".to_string())),
            OutgoingMessage::Message(message) => message.try_into(),
        }
    }
}
