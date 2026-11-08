use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Organization id for soup channel payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct OrganizationId(pub u32);

pub use channel_id::ChannelId;

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
#[derive(Clone, Debug, Serialize, Deserialize)]
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
/// This mirrors the public channel-message API shape so soup consumers can
/// render a thread root the same way they render a channel timeline message.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupChannelThread {
    /// Message id.
    pub id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Sender id.
    pub sender_id: String,
    /// Structured sender identity.
    pub sender: SoupMessageSender,
    /// Message content.
    pub content: String,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Edit timestamp.
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Deletion timestamp.
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Thread metadata and preview replies.
    pub thread: SoupThreadInfo,
    /// Reactions on this message.
    pub reactions: Vec<SoupCountedReaction>,
    /// Attachments on this message.
    pub attachments: Vec<SoupMessageAttachment>,
}

/// Public sender identity for soup channel messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupMessageSender {
    /// Sender type.
    #[serde(rename = "type")]
    pub sender_type: SoupMessageSenderType,
    /// Sender id without the storage namespace prefix.
    pub id: String,
    /// Display name for bot senders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Avatar URL for bot senders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

/// Public sender type for soup channel messages.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum SoupMessageSenderType {
    /// Macro user sender.
    User,
    /// Bot sender.
    Bot,
}

/// Thread metadata and preview replies for soup channel messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupThreadInfo {
    /// Total reply count.
    pub reply_count: i64,
    /// Timestamp of the latest reply.
    pub latest_reply_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Preview replies.
    pub preview: Vec<SoupThreadReply>,
}

/// A thread reply shown in preview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupThreadReply {
    /// Reply id.
    pub id: Uuid,
    /// Sender id.
    pub sender_id: String,
    /// Structured sender identity.
    pub sender: SoupMessageSender,
    /// Reply content.
    pub content: String,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Edit timestamp.
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Reactions on this reply.
    pub reactions: Vec<SoupCountedReaction>,
    /// Attachments on this reply.
    pub attachments: Vec<SoupMessageAttachment>,
}

/// A reaction with emoji and user list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupCountedReaction {
    /// Emoji string.
    pub emoji: String,
    /// User ids who added this reaction.
    pub users: Vec<String>,
}

/// An attachment on a message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupMessageAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Type of entity.
    pub entity_type: String,
    /// Entity id.
    pub entity_id: String,
    /// Width for images.
    pub width: Option<i32>,
    /// Height for images.
    pub height: Option<i32>,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl SoupChannelThread {
    /// Latest update timestamp across the parent message and thread metadata.
    pub fn effective_updated_at(&self) -> chrono::DateTime<chrono::Utc> {
        self.thread
            .latest_reply_at
            .unwrap_or(self.updated_at)
            .max(self.updated_at)
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
    /// Whether the requesting user is an active participant of the channel.
    /// False for team channels of the user's teams they have not joined.
    #[serde(default)]
    pub is_participant: bool,
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

impl SoupMessageSender {
    /// Resolves a sender from its `channel_sender` storage string, filling the
    /// bot display name and avatar for bot senders when the caller has them.
    pub fn from_message_sender(
        sender_id: &str,
        bot_name: Option<String>,
        bot_avatar_url: Option<String>,
    ) -> Self {
        let mut sender = Self::from_storage_string(sender_id);
        if matches!(sender.sender_type, SoupMessageSenderType::Bot)
            && let Some(name) = bot_name
        {
            sender.name = Some(name);
            sender.avatar_url = bot_avatar_url;
        }
        sender
    }

    fn from_storage_string(sender_id: &str) -> Self {
        let Ok(sender) = channel_sender::ChannelSender::parse_from_str(sender_id) else {
            return Self {
                sender_type: SoupMessageSenderType::User,
                id: sender_id.to_string(),
                name: None,
                avatar_url: None,
            };
        };

        if let Some(bot_id) = sender.as_bot() {
            Self {
                sender_type: SoupMessageSenderType::Bot,
                id: bot_id.as_uuid().to_string(),
                name: None,
                avatar_url: None,
            }
        } else if let Some(user_id) = sender.as_user() {
            Self {
                sender_type: SoupMessageSenderType::User,
                id: user_id.to_string(),
                name: None,
                avatar_url: None,
            }
        } else {
            Self {
                sender_type: SoupMessageSenderType::User,
                id: sender_id.to_string(),
                name: None,
                avatar_url: None,
            }
        }
    }
}
