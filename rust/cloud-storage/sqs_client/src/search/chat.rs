use chrono::{DateTime, Utc};

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct ChatMessage {
    /// The chat id
    pub chat_id: String,
    /// The message id
    pub message_id: String,
    /// The user id
    pub user_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct RemoveChatMessage {
    /// The chat id to remove
    pub chat_id: String,
    /// The message id to remove, if None then all messages for the chat will be removed
    pub message_id: Option<String>,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}
