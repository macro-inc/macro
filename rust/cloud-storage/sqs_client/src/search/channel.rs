#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct ChannelMessageUpdate {
    /// The channel id
    pub channel_id: String,
    /// The message id
    pub message_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct RemoveChannelMessage {
    /// The channel id
    pub channel_id: String,
    /// The message id
    pub message_id: Option<String>,
}
