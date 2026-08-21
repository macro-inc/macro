#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct ChannelMessageUpdate {
    /// The channel id
    pub channel_id: String,
    /// The message id
    pub message_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}
