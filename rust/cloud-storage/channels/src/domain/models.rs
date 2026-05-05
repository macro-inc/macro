use chrono::{DateTime, Utc};
use models_pagination::{CreatedAt, CursorVal, Identify, SortOn};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Request to fetch a page of channel messages.
#[derive(Debug)]
pub struct GetChannelMessagesRequest {
    /// The channel to fetch messages from.
    pub channel_id: Uuid,
    /// Page size, clamped to [1, 100].
    pub limit: u16,
}

/// Filter for the type of channel attachments to return.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ChannelAttachmentType {
    /// Static file attachments (images, videos).
    Static,
    /// Document storage service attachments.
    Dss,
}

/// Filters for channel message queries.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelMessageFilters {
    /// When non-empty, only return messages with these IDs.
    #[serde(default)]
    pub message_ids: Vec<Uuid>,
    /// When set, only return top-level messages created at or after this timestamp.
    #[serde(default)]
    pub created_after: Option<DateTime<Utc>>,
    /// When set, only return top-level messages created before this timestamp.
    #[serde(default)]
    pub created_before: Option<DateTime<Utc>>,
    /// When set, only return top-level messages with channel activity at or after
    /// this timestamp. Activity means either the message itself was created after
    /// this time, or a thread reply was created after this time.
    ///
    /// Accepts the legacy JSON field `last_activity` for backwards compatibility.
    #[serde(default, alias = "last_activity")]
    pub activity_after: Option<DateTime<Utc>>,
    /// When set, only return top-level messages with channel activity before this
    /// timestamp. Activity means either the parent message or at least one thread
    /// reply falls in the requested activity window.
    #[serde(default)]
    pub activity_before: Option<DateTime<Utc>>,
    /// When set, only return top-level messages where the message itself or
    /// any active thread reply has a notification for the requesting user that
    /// matches these notification state constraints.
    #[serde(default)]
    pub notification_filters: NotificationFilters,
}

/// Notification state filters for channel message queries.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct NotificationFilters {
    /// Filter by notification done state. `Some(true)` selects done
    /// notifications; `Some(false)` selects not-done notifications.
    #[serde(default)]
    pub done: Option<bool>,
    /// Filter by notification seen state. `Some(true)` selects seen
    /// notifications; `Some(false)` selects not-seen notifications.
    #[serde(default)]
    pub seen: Option<bool>,
}

impl NotificationFilters {
    /// Returns true when no notification constraints are requested.
    pub fn is_empty(&self) -> bool {
        self.done.is_none() && self.seen.is_none()
    }
}

/// Where a channel message sits in the channel/thread model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelMessageKind {
    /// A top-level message in the channel timeline.
    TopLevelMessage,
    /// A reply inside a top-level message's thread.
    ThreadReply,
}

/// Resolution metadata for any channel message id.
#[derive(Debug, Clone)]
pub struct ResolvedChannelMessage {
    /// The requested message id.
    pub message_id: Uuid,
    /// Channel this message belongs to.
    pub channel_id: Uuid,
    /// Whether the message is top-level or a thread reply.
    pub kind: ChannelMessageKind,
    /// The top-level parent/thread id. Equals `message_id` for top-level messages.
    pub thread_id: Uuid,
    /// When the requested message was created.
    pub created_at: DateTime<Utc>,
}

/// Direction for cursor-based message pagination.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessagePageDirection {
    /// Fetch older messages than the cursor.
    Older,
    /// Fetch newer messages than the cursor.
    Newer,
}

/// A top-level message with thread info, reactions, and attachments.
#[derive(Debug)]
pub struct ChannelMessage {
    /// Message id.
    pub id: Uuid,
    /// Channel this message belongs to.
    pub channel_id: Uuid,
    /// User who sent the message.
    pub sender_id: String,
    /// Message body.
    pub content: String,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the message was edited (if ever).
    pub edited_at: Option<DateTime<Utc>>,
    /// When the message was soft-deleted (if ever).
    pub deleted_at: Option<DateTime<Utc>>,
    /// Thread metadata and preview replies.
    pub thread: ThreadInfo,
    /// Aggregated reactions on this message.
    pub reactions: Vec<CountedReaction>,
    /// Attachments on this message.
    pub attachments: Vec<MessageAttachment>,
}

impl Identify for ChannelMessage {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }
}

impl SortOn<CreatedAt> for ChannelMessage {
    fn sort_on(sort_type: CreatedAt) -> impl FnMut(&Self) -> CursorVal<CreatedAt> {
        move |msg| CursorVal {
            sort_type,
            last_val: msg.created_at,
        }
    }
}

/// Thread metadata + preview replies for a top-level message.
#[derive(Debug)]
pub struct ThreadInfo {
    /// Total number of replies in the thread.
    pub reply_count: i64,
    /// Timestamp of the most recent reply.
    pub latest_reply_at: Option<DateTime<Utc>>,
    /// Oldest N replies for the collapsed thread preview.
    pub preview: Vec<ThreadReply>,
}

/// A reply shown in a thread preview.
#[derive(Debug)]
pub struct ThreadReply {
    /// Reply id.
    pub id: Uuid,
    /// User who sent the reply.
    pub sender_id: String,
    /// Reply body.
    pub content: String,
    /// When the reply was created.
    pub created_at: DateTime<Utc>,
    /// When the reply was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the reply was edited (if ever).
    pub edited_at: Option<DateTime<Utc>>,
    /// Aggregated reactions on this reply.
    pub reactions: Vec<CountedReaction>,
    /// Attachments on this reply.
    pub attachments: Vec<MessageAttachment>,
}

/// A reaction emoji with the list of users who reacted.
#[derive(Debug, Clone)]
pub struct CountedReaction {
    /// The emoji string.
    pub emoji: String,
    /// User ids who added this reaction.
    pub users: Vec<String>,
}

/// An attachment on a message.
#[derive(Debug, Clone)]
pub struct MessageAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Type of attached entity (e.g. "document").
    pub entity_type: String,
    /// Id of the attached entity.
    pub entity_id: String,
    /// Optional width (for images).
    pub width: Option<i32>,
    /// Optional height (for images).
    pub height: Option<i32>,
    /// When the attachment was created.
    pub created_at: DateTime<Utc>,
}

/// An attachment in a channel (for the channel-level attachments listing).
#[derive(Debug, Clone)]
pub struct ChannelAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Channel this attachment belongs to.
    pub channel_id: Uuid,
    /// Message this attachment is on.
    pub message_id: Uuid,
    /// The user who sent the message containing this attachment.
    pub sender_id: String,
    /// Type of attached entity (e.g. "document").
    pub entity_type: String,
    /// Id of the attached entity.
    pub entity_id: String,
    /// Optional width (for images).
    pub width: Option<i32>,
    /// Optional height (for images).
    pub height: Option<i32>,
    /// When the attachment was created.
    pub created_at: DateTime<Utc>,
}

impl Identify for ChannelAttachment {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }
}

impl SortOn<CreatedAt> for ChannelAttachment {
    fn sort_on(sort_type: CreatedAt) -> impl FnMut(&Self) -> CursorVal<CreatedAt> {
        move |a| CursorVal {
            sort_type,
            last_val: a.created_at,
        }
    }
}

/// Role of a channel participant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParticipantRole {
    /// Channel owner.
    Owner,
    /// Channel admin.
    Admin,
    /// Regular member.
    Member,
}

impl std::str::FromStr for ParticipantRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "owner" => Ok(Self::Owner),
            "admin" => Ok(Self::Admin),
            "member" => Ok(Self::Member),
            other => Err(format!("unknown participant role: {other}")),
        }
    }
}

/// An active participant in a channel.
#[derive(Debug, Clone)]
pub struct ChannelParticipant {
    /// Channel id.
    pub channel_id: Uuid,
    /// User id.
    pub user_id: String,
    /// Role in the channel.
    pub role: ParticipantRole,
    /// When the user joined.
    pub joined_at: DateTime<Utc>,
    /// When the user left (None if still active).
    pub left_at: Option<DateTime<Utc>>,
}

/// Raw row returned from the top-level messages query.
#[derive(Debug, Clone)]
pub struct TopLevelMessageRow {
    /// Message id.
    pub id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Sender user id.
    pub sender_id: String,
    /// Message content.
    pub content: String,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    pub updated_at: DateTime<Utc>,
    /// Edited timestamp.
    pub edited_at: Option<DateTime<Utc>>,
    /// Deleted timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Combined thread statistics and preview replies from a single query.
#[derive(Debug, Clone)]
pub struct ThreadData {
    /// Total number of replies in this thread.
    pub reply_count: i64,
    /// Timestamp of the latest reply.
    pub latest_reply_at: Option<DateTime<Utc>>,
    /// Oldest N replies for the thread preview (oldest-first).
    pub preview_replies: Vec<ThreadReplyRow>,
}

/// Raw row returned from the thread data query.
#[derive(Debug, Clone)]
pub struct ThreadReplyRow {
    /// Reply id.
    pub id: Uuid,
    /// Parent message id.
    pub thread_id: Uuid,
    /// Sender user id.
    pub sender_id: String,
    /// Reply content.
    pub content: String,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    pub updated_at: DateTime<Utc>,
    /// Edited timestamp.
    pub edited_at: Option<DateTime<Utc>>,
}
