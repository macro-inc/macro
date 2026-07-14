use super::message::{Message, OutgoingMessage};
use stream::domain::StreamItem;

const STREAM_MESSAGE_TYPE: &str = "stream";

impl TryFrom<StreamItem> for OutgoingMessage {
    type Error = serde_json::Error;
    fn try_from(value: StreamItem) -> Result<Self, Self::Error> {
        serde_json::to_string(&value).map(|data| {
            OutgoingMessage::Message(Message {
                message_type: STREAM_MESSAGE_TYPE.into(),
                data,
            })
        })
    }
}
