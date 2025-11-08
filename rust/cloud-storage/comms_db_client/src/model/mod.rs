use model::comms::ChannelType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TypingAction {
    Start,
    Stop,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Message {
    /// uuid of the message
    pub id: Uuid,
    /// uuid of the channel this message belongs to
    pub channel_id: Uuid,
    pub thread_id: Option<Uuid>,
    /// id of the user who sent the message
    pub sender_id: String,
    /// string content of the message
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// the time that the message was edited
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    /// the time that the message was deleted
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Attachment {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub entity_type: String,
    pub entity_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NewAttachment {
    pub entity_type: String,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct SimpleMention {
    pub entity_type: String,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MessageMention {
    pub message_id: Uuid,
    pub entity_type: String,
    pub entity_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EntityMention {
    pub id: Uuid,
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub user_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Reaction {
    pub message_id: Uuid,
    pub user_id: String,
    pub emoji: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CountedReaction {
    pub emoji: String,
    pub users: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ActivityType {
    /// The user viewed the channel
    View,
    /// the user interacted with the channel
    Interact,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
/// Represents a user's activity in a channel
pub struct Activity {
    pub id: Uuid,
    pub user_id: String,
    pub channel_id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// the last time the user viewed the channel
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// the last time the user intereacted with the channel
    /// eg. reacting, replying, sending a message
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChannelPreview {
    Access(ChannelPreviewData),
    NoAccess(WithChannelId),
    DoesNotExist(WithChannelId),
}

#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema,
)]
pub struct ChannelPreviewData {
    pub channel_id: String,
    pub channel_name: String,
    pub channel_type: ChannelType,
}

#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema,
)]
pub struct WithChannelId {
    pub channel_id: String,
}
