use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use std::collections::HashMap;
use utoipa::ToSchema;
use uuid::Uuid;

// Re-export ChannelType for use by other modules in this crate
pub use models_comms::ChannelType;

/// Ugly place to store the models that are used by service client.
/// it's ugly to promot someone else moving it as I am lazy -- Hutch.

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AddUserToOrgChannelsRequest {
    pub user_id: String,
    pub org_id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RemoveUserFromOrgChannelsRequest {
    pub user_id: String,
    pub org_id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GetOrCreateAction {
    Get,
    Create,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckChannelsForUserRequest {
    pub user_id: String,
    pub channel_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserActivityForChannel {
    /// The user id of the activity
    pub user_id: String,
    /// The updated_at time of the activity
    /// This is used to compare against channel_notification_email_sent updated_at from
    /// notification db to determine if the user should be notified via email.
    pub updated_at: chrono::NaiveDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, ToSchema, Default)]
#[sqlx(type_name = "comms_participant_role", rename_all = "lowercase")]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Owner,
    Admin,
    #[default]
    Member,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ChannelParticipant {
    /// id of the channel
    pub channel_id: Uuid,
    /// id of the user
    pub user_id: String,
    /// type of the participant
    pub role: ParticipantRole,
    /// timestamp of when the user joined the channel
    pub joined_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the user left the channel
    pub left_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
pub struct Channel {
    /// uuid of the channel
    pub id: Uuid,
    /// string name of the channel
    pub name: Option<String>,
    /// type of the channel
    pub channel_type: ChannelType,
    /// id of the organization this channel belongs too
    pub org_id: Option<i64>,
    /// timestamp of when the channel was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// timestamp of when the channel was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// id of the user who created the channel
    pub owner_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ChannelWithParticipants {
    #[serde(flatten)]
    pub channel: Channel,
    pub participants: Vec<ChannelParticipant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct LatestMessage {
    pub latest_message: Option<ChannelMessage>,
    pub latest_non_thread_message: Option<ChannelMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ChannelWithLatest {
    #[serde(flatten)]
    pub channel: ChannelWithParticipants,
    #[serde(flatten)]
    pub latest_message: LatestMessage,
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub frecency_score: f64,
}

/// information about a channel used in search responses
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelHistoryInfo {
    pub item_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
    pub interacted_at: Option<DateTime<Utc>>,
    /// The id of the user who created the channel
    pub user_id: String,
    /// The string value of the channel type
    pub channel_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetChannelsHistoryRequest {
    pub user_id: String,
    pub channel_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetChannelsHistoryResponse {
    pub channels_history: HashMap<Uuid, ChannelHistoryInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWelcomeMessageRequest {
    /// The id of the user to create the welcome message to
    pub welcome_user_id: String,
    /// The id of the user to send the welcome message to
    pub to_user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ChannelMessage {
    pub message_id: Uuid,
    pub thread_id: Option<Uuid>,
    pub sender_id: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// message mentions formatted as `{ENTITY_TYPE}:{ENTITY_ID}`
    pub mentions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub thread_id: Option<Uuid>,
    pub sender_id: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetChannelMessageResponse {
    pub channel_id: Uuid,
    pub name: Option<String>,
    pub channel_type: ChannelType,
    pub org_id: Option<i64>,
    pub channel_message: ChannelMessage,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetMessageWithContextResponse {
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelMetadataRequest {
    pub channel_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelAttachmentTextRequest {
    pub channel_id: Uuid,
    pub since: Option<chrono::DateTime<chrono::Utc>>,
    pub limit: Option<i64>,
}
