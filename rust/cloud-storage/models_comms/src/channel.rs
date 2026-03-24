use chrono::{DateTime, Utc};
use doppleganger::Primitive;
use frecency::domain::models::AggregateFrecency;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Display, Deserialize)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    Public,
    Organization,
    Private,
    DirectMessage,
    Team,
}

#[derive(Debug, Clone)]
pub struct ChannelMetadata {
    pub name: String,
    pub channel_type: ChannelType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct OrganizationId(pub u32);

impl Primitive for OrganizationId {}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct ChannelId(pub Uuid);

impl Primitive for ChannelId {}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Owner,
    Admin,
    #[default]
    Member,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChannelParticipant {
    pub channel_id: ChannelId,
    pub user_id: MacroUserIdStr<'static>,
    pub role: ParticipantRole,
    pub joined_at: DateTime<Utc>,
    pub left_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct Channel {
    pub id: ChannelId,
    pub name: Option<String>,
    pub channel_type: ChannelType,
    pub org_id: Option<OrganizationId>,
    pub team_id: Option<uuid::Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub owner_id: MacroUserIdStr<'static>,
}

#[derive(Debug, Clone)]
pub struct ChannelWithParticipants {
    pub channel: Channel,
    pub participants: Vec<ChannelParticipant>,
}

#[derive(Debug, Clone, Default)]
pub struct LatestMessage {
    pub latest_message: Option<ChannelMessage>,
    pub latest_non_thread_message: Option<ChannelMessage>,
}

#[derive(Debug, Clone)]
pub struct ChannelWithLatest {
    pub channel: ChannelWithParticipants,
    pub latest_message: LatestMessage,
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub frecency_score: Option<AggregateFrecency>,
}

#[derive(Debug, Clone)]
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

pub struct EnrichedChannel {
    pub channel: ChannelWithParticipants,
    pub latest_message: LatestMessage,
}

/// Represents a user's activity in a channel
pub struct Activity {
    pub id: Uuid,
    pub user_id: String,
    pub channel_id: ChannelId,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// the last time the user viewed the channel
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// the last time the user intereacted with the channel
    /// eg. reacting, replying, sending a message
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
}
