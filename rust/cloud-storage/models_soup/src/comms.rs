use chrono::{DateTime, Utc};
use comms::domain::models::channel::{ChannelId, OrganizationId};
use doppleganger::Doppleganger;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[dg(backward = comms::domain::models::channel::ChannelWithLatest)]
pub struct SoupChannel {
    #[serde(flatten)]
    pub channel: ChannelWithParticipants,
    #[serde(flatten)]
    pub latest_message: LatestMessage,
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[dg(backward = comms::domain::models::channel::ChannelWithParticipants)]
pub struct ChannelWithParticipants {
    pub channel: Channel,
    pub participants: Vec<ChannelParticipant>,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[dg(backward = comms::domain::models::channel::LatestMessage)]
pub struct LatestMessage {
    pub latest_message: Option<ChannelMessage>,
    pub latest_non_thread_message: Option<ChannelMessage>,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[dg(backward = comms::domain::models::channel::ChannelMessage)]
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

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[dg(backward = comms::domain::models::channel::Channel)]
pub struct Channel {
    #[cfg_attr(feature = "schema", schema(value_type = Uuid))]
    pub id: ChannelId,
    pub name: Option<String>,
    pub channel_type: ChannelType,
    #[cfg_attr(feature = "schema", schema(value_type = Option<u32>))]
    pub org_id: Option<OrganizationId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Doppleganger)]
#[serde(rename_all = "snake_case")]
#[dg(backward = comms::domain::models::channel::ChannelType)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ChannelType {
    Public,
    Organization,
    Private,
    DirectMessage,
}

#[derive(Debug, Doppleganger, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[dg(backward = comms::domain::models::channel::ChannelParticipant)]
pub struct ChannelParticipant {
    #[cfg_attr(feature = "schema", schema(value_type = Uuid))]
    pub channel_id: ChannelId,
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'static>,
    pub role: ParticipantRole,
    pub joined_at: DateTime<Utc>,
    pub left_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Doppleganger)]
#[serde(rename_all = "snake_case")]
#[dg(backward = comms::domain::models::channel::ParticipantRole)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ParticipantRole {
    Owner,
    Admin,
    Member,
}
