use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::comms;
use serde::{Deserialize, Serialize};

pub use comms::{
    Channel, ChannelId, ChannelMessage, ChannelType, LatestMessage, OrganizationId, ParticipantRole,
};

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupChannel {
    #[serde(flatten)]
    pub channel: ChannelWithParticipants,
    #[serde(flatten)]
    pub latest_message: LatestMessage,
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelWithParticipants {
    pub channel: Channel,
    pub participants: Vec<ChannelParticipant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelParticipant {
    #[cfg_attr(feature = "schema", schema(value_type = uuid::Uuid))]
    pub channel_id: ChannelId,
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
    pub role: ParticipantRole,
    pub joined_at: chrono::DateTime<chrono::Utc>,
    pub left_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn channel_type_from_channels(channel_type: channels::domain::models::ChannelType) -> ChannelType {
    match channel_type {
        channels::domain::models::ChannelType::Public => ChannelType::Public,
        channels::domain::models::ChannelType::Private => ChannelType::Private,
        channels::domain::models::ChannelType::DirectMessage => ChannelType::DirectMessage,
        channels::domain::models::ChannelType::Team => ChannelType::Team,
    }
}

fn participant_role_from_channels(
    role: channels::domain::models::ParticipantRole,
) -> ParticipantRole {
    match role {
        channels::domain::models::ParticipantRole::Owner => ParticipantRole::Owner,
        channels::domain::models::ParticipantRole::Admin => ParticipantRole::Admin,
        channels::domain::models::ParticipantRole::Member => ParticipantRole::Member,
    }
}

fn channel_message_from_channels(
    message: channels::domain::models::RecentChannelMessage,
) -> ChannelMessage {
    ChannelMessage {
        message_id: message.message_id,
        thread_id: message.thread_id,
        sender_id: message.sender_id,
        content: message.content,
        created_at: message.created_at,
        updated_at: message.updated_at,
        deleted_at: message.deleted_at,
        mentions: message.mentions,
    }
}

fn channel_from_channels(channel: channels::domain::models::ChannelListItem) -> Channel {
    Channel {
        id: ChannelId(channel.id),
        name: channel.name,
        channel_type: channel_type_from_channels(channel.channel_type),
        org_id: channel
            .org_id
            .and_then(|org_id| u32::try_from(org_id).ok())
            .map(OrganizationId),
        team_id: channel.team_id,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        owner_id: channel.owner_id,
    }
}

fn latest_message_from_channels(
    latest_message: channels::domain::models::LatestMessage,
) -> LatestMessage {
    LatestMessage {
        latest_message: latest_message
            .latest_message
            .map(channel_message_from_channels),
        latest_non_thread_message: latest_message
            .latest_non_thread_message
            .map(channel_message_from_channels),
    }
}

impl TryFrom<channels::domain::models::ChannelParticipant> for ChannelParticipant {
    type Error = macro_user_id::error::ParseErr;

    fn try_from(
        participant: channels::domain::models::ChannelParticipant,
    ) -> Result<Self, Self::Error> {
        Ok(Self {
            channel_id: ChannelId(participant.channel_id),
            user_id: MacroUserIdStr::parse_from_str(&participant.user_id)?.into_owned(),
            role: participant_role_from_channels(participant.role),
            joined_at: participant.joined_at,
            left_at: participant.left_at,
        })
    }
}

impl From<channels::domain::models::ChannelWithParticipants> for ChannelWithParticipants {
    fn from(channel: channels::domain::models::ChannelWithParticipants) -> Self {
        Self {
            channel: channel_from_channels(channel.channel),
            participants: channel
                .participants
                .into_iter()
                .filter_map(|participant| participant.try_into().ok())
                .collect(),
        }
    }
}

impl From<channels::domain::models::ChannelWithLatest> for SoupChannel {
    fn from(channel: channels::domain::models::ChannelWithLatest) -> Self {
        Self {
            channel: channel.channel.into(),
            latest_message: latest_message_from_channels(channel.latest_message),
            viewed_at: channel.viewed_at,
            interacted_at: channel.interacted_at,
        }
    }
}
