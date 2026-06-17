use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Organization id for soup channel payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct OrganizationId(pub u32);

/// Channel id for soup channel payloads.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelId(pub Uuid);

/// Channel type for soup channel payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ChannelType {
    /// Public channel.
    Public,
    /// Private group channel.
    Private,
    /// One-to-one direct message channel.
    DirectMessage,
    /// Team channel.
    Team,
}

/// Role of a channel participant.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ParticipantRole {
    /// Channel owner.
    Owner,
    /// Channel admin.
    Admin,
    /// Regular member.
    #[default]
    Member,
}

/// Channel metadata in soup payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct Channel {
    /// Channel id.
    #[cfg_attr(feature = "schema", schema(value_type = Uuid))]
    pub id: ChannelId,
    /// Channel display name.
    pub name: Option<String>,
    /// Channel type.
    pub channel_type: ChannelType,
    /// Organization id.
    #[cfg_attr(feature = "schema", schema(value_type = Option<u32>))]
    pub org_id: Option<OrganizationId>,
    /// Team id.
    #[serde(default)]
    pub team_id: Option<Uuid>,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Channel owner.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,
}

/// Lightweight channel message for soup payloads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelMessage {
    /// Message id.
    pub message_id: Uuid,
    /// Thread parent id.
    pub thread_id: Option<Uuid>,
    /// Sender id.
    pub sender_id: String,
    /// Message content.
    pub content: String,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Deletion timestamp.
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Message mentions formatted as `{ENTITY_TYPE}:{ENTITY_ID}`.
    pub mentions: Vec<String>,
}

/// Latest-message bundle for soup payloads.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct LatestMessage {
    /// Latest message including thread replies.
    pub latest_message: Option<ChannelMessage>,
    /// Latest top-level non-thread message.
    pub latest_non_thread_message: Option<ChannelMessage>,
}

/// A channel as displayed in Soup.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupChannel {
    /// Channel metadata and participants.
    #[serde(flatten)]
    pub channel: ChannelWithParticipants,
    /// Latest message metadata for the channel.
    #[serde(flatten)]
    pub latest_message: LatestMessage,
    /// Timestamp when the requesting user last viewed this channel.
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Timestamp when the requesting user last interacted with this channel.
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// A top-level channel message thread for soup payloads.
///
/// This reuses the existing lightweight [`ChannelMessage`] shape used by
/// [`SoupChannel`] latest-message data.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupChannelThread {
    /// Channel that owns the thread.
    #[cfg_attr(feature = "schema", schema(value_type = Uuid))]
    pub channel_id: ChannelId,
    /// Top-level message that acts as the thread parent.
    pub root_message: ChannelMessage,
    /// Thread replies, using the same lightweight channel message shape.
    pub messages: Vec<ChannelMessage>,
}

impl SoupChannelThread {
    /// Latest update timestamp across the parent message and replies.
    pub fn updated_at(&self) -> chrono::DateTime<chrono::Utc> {
        self.messages
            .iter()
            .map(|message| message.updated_at)
            .max()
            .unwrap_or(self.root_message.updated_at)
            .max(self.root_message.updated_at)
    }
}

/// Channel metadata together with its participants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelWithParticipants {
    /// Channel metadata.
    pub channel: Channel,
    /// Participants in the channel.
    pub participants: Vec<ChannelParticipant>,
}

/// A user's membership in a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelParticipant {
    /// Channel id for the participant membership.
    #[cfg_attr(feature = "schema", schema(value_type = Uuid))]
    pub channel_id: ChannelId,
    /// Participant user id.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// Participant role in the channel.
    pub role: ParticipantRole,
    /// Timestamp when the participant joined the channel.
    pub joined_at: chrono::DateTime<chrono::Utc>,
    /// Timestamp when the participant left the channel, if any.
    pub left_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl ChannelType {
    /// Converts a channels-domain channel type into the Soup channel type.
    pub fn new_from_channels(channel_type: channels::domain::models::ChannelType) -> Self {
        match channel_type {
            channels::domain::models::ChannelType::Public => Self::Public,
            channels::domain::models::ChannelType::Private => Self::Private,
            channels::domain::models::ChannelType::DirectMessage => Self::DirectMessage,
            channels::domain::models::ChannelType::Team => Self::Team,
        }
    }
}

impl ParticipantRole {
    /// Converts a channels-domain participant role into the Soup participant role.
    pub fn new_from_channels(role: channels::domain::models::ParticipantRole) -> Self {
        match role {
            channels::domain::models::ParticipantRole::Owner => Self::Owner,
            channels::domain::models::ParticipantRole::Admin => Self::Admin,
            channels::domain::models::ParticipantRole::Member => Self::Member,
        }
    }
}

impl Channel {
    /// Converts a channels-domain list item into Soup channel metadata.
    pub fn new_from_channels(channel: channels::domain::models::ChannelListItem) -> Self {
        Self {
            id: ChannelId(channel.id),
            name: channel.name,
            channel_type: ChannelType::new_from_channels(channel.channel_type),
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
}

impl ChannelMessage {
    /// Converts a channels-domain recent message into a Soup channel message.
    pub fn new_from_recent_channel_message(
        message: channels::domain::models::RecentChannelMessage,
    ) -> Self {
        Self {
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

    /// Converts a channels-domain channel message into a Soup channel message.
    pub fn new_from_channel_message(message: channels::domain::models::ChannelMessage) -> Self {
        Self {
            message_id: message.id,
            thread_id: None,
            sender_id: message.sender_id,
            content: message.content,
            created_at: message.created_at,
            updated_at: message.updated_at,
            deleted_at: message.deleted_at,
            mentions: Vec::new(),
        }
    }

    /// Converts a channels-domain thread reply into a Soup channel message.
    pub fn new_from_thread_reply(
        parent_id: Uuid,
        reply: channels::domain::models::ThreadReply,
    ) -> Self {
        Self {
            message_id: reply.id,
            thread_id: Some(parent_id),
            sender_id: reply.sender_id,
            content: reply.content,
            created_at: reply.created_at,
            updated_at: reply.updated_at,
            deleted_at: None,
            mentions: Vec::new(),
        }
    }

    /// Converts a raw channels-domain top-level message row into a Soup channel message.
    pub fn new_from_top_level_message_row(
        row: channels::domain::models::TopLevelMessageRow,
    ) -> Self {
        Self {
            message_id: row.id,
            thread_id: None,
            sender_id: row.sender_id,
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            mentions: Vec::new(),
        }
    }

    /// Converts a raw channels-domain thread reply row into a Soup channel message.
    pub fn new_from_thread_reply_row(row: channels::domain::models::ThreadReplyRow) -> Self {
        Self {
            message_id: row.id,
            thread_id: Some(row.thread_id),
            sender_id: row.sender_id,
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: None,
            mentions: Vec::new(),
        }
    }
}

impl LatestMessage {
    /// Converts channels-domain latest message data into Soup latest message data.
    pub fn new_from_channels(latest_message: channels::domain::models::LatestMessage) -> Self {
        Self {
            latest_message: latest_message
                .latest_message
                .map(ChannelMessage::new_from_recent_channel_message),
            latest_non_thread_message: latest_message
                .latest_non_thread_message
                .map(ChannelMessage::new_from_recent_channel_message),
        }
    }
}

impl ChannelParticipant {
    /// Converts a channels-domain participant into a Soup participant.
    pub fn try_new_from_channels(
        participant: channels::domain::models::ChannelParticipant,
    ) -> Result<Self, macro_user_id::error::ParseErr> {
        Ok(Self {
            channel_id: ChannelId(participant.channel_id),
            user_id: MacroUserIdStr::parse_from_str(&participant.user_id)?.into_owned(),
            role: ParticipantRole::new_from_channels(participant.role),
            joined_at: participant.joined_at,
            left_at: participant.left_at,
        })
    }
}

impl ChannelWithParticipants {
    /// Converts channels-domain metadata and participants into the Soup shape.
    pub fn new_from_channels(channel: channels::domain::models::ChannelWithParticipants) -> Self {
        Self {
            channel: Channel::new_from_channels(channel.channel),
            participants: channel
                .participants
                .into_iter()
                .filter_map(|participant| {
                    ChannelParticipant::try_new_from_channels(participant).ok()
                })
                .collect(),
        }
    }
}

impl SoupChannel {
    /// Converts channels-domain channel data with latest messages into Soup.
    pub fn new_from_channels(channel: channels::domain::models::ChannelWithLatest) -> Self {
        Self {
            channel: ChannelWithParticipants::new_from_channels(channel.channel),
            latest_message: LatestMessage::new_from_channels(channel.latest_message),
            viewed_at: channel.viewed_at,
            interacted_at: channel.interacted_at,
        }
    }
}

impl SoupChannelThread {
    /// Converts a channels-domain channel message with preview replies into a Soup thread.
    pub fn new_from_channel_message(message: channels::domain::models::ChannelMessage) -> Self {
        let channels::domain::models::ChannelMessage {
            id,
            channel_id,
            sender_id,
            content,
            created_at,
            updated_at,
            deleted_at,
            thread,
            ..
        } = message;
        let messages = thread
            .preview
            .into_iter()
            .map(|reply| ChannelMessage::new_from_thread_reply(id, reply))
            .collect();

        Self {
            channel_id: ChannelId(channel_id),
            root_message: ChannelMessage {
                message_id: id,
                thread_id: None,
                sender_id,
                content,
                created_at,
                updated_at,
                deleted_at,
                mentions: Vec::new(),
            },
            messages,
        }
    }

    /// Converts a channels-domain channel message and replies into a Soup thread.
    pub fn new_from_channel_message_and_replies(
        message: channels::domain::models::ChannelMessage,
        replies: Vec<channels::domain::models::ThreadReply>,
    ) -> Self {
        let parent_id = message.id;
        Self {
            channel_id: ChannelId(message.channel_id),
            root_message: ChannelMessage::new_from_channel_message(message),
            messages: replies
                .into_iter()
                .map(|reply| ChannelMessage::new_from_thread_reply(parent_id, reply))
                .collect(),
        }
    }

    /// Converts raw channels-domain parent/reply rows into a Soup thread.
    pub fn new_from_thread_reply_rows(
        rows: channels::domain::models::ChannelThreadReplyRows,
    ) -> Self {
        let channel_id = rows.parent.channel_id;
        Self {
            channel_id: ChannelId(channel_id),
            root_message: ChannelMessage::new_from_top_level_message_row(rows.parent),
            messages: rows
                .replies
                .into_iter()
                .map(ChannelMessage::new_from_thread_reply_row)
                .collect(),
        }
    }
}
