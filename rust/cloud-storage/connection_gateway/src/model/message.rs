use anyhow::Result;
use serde::{Deserialize, Serialize};
use stream::domain::StreamEvent;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    #[serde(rename = "type")]
    pub message_type: String,
    pub data: String,
}

static STREAM_EVENT_TYPE: &str = "stream_event";
impl TryFrom<StreamEvent> for Message {
    type Error = anyhow::Error;
    fn try_from(value: StreamEvent) -> Result<Self, Self::Error> {
        serde_json::to_string(&value)
            .map(|data| Self {
                data,
                message_type: STREAM_EVENT_TYPE.into(),
            })
            .map_err(anyhow::Error::from)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum OutgoingMessage {
    Pong,
    Message(Message),
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
