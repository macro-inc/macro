use chrono::{DateTime, Utc};

#[cfg(test)]
mod test;

/// SQS backfill work-queue contract for reconciling a chat message.
///
/// Live chat updates use Kafka. This payload remains available so search
/// backfills can target an alternate OpenSearch index with
/// [`Self::index_override`].
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
