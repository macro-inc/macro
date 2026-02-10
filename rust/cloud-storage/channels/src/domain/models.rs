use chrono::{DateTime, Utc};
use models_pagination::{CreatedAt, CursorVal, Identify, SortOn};
use uuid::Uuid;

/// Request to fetch a page of channel messages.
#[derive(Debug)]
pub struct GetChannelMessagesRequest {
    /// The channel to fetch messages from.
    pub channel_id: Uuid,
    /// Page size, clamped to [1, 100].
    pub limit: u16,
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
    /// Last N replies for the collapsed thread preview.
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
    /// When the attachment was created.
    pub created_at: DateTime<Utc>,
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

/// Thread statistics for a parent message.
#[derive(Debug, Clone)]
pub struct ThreadStats {
    /// Number of replies in this thread.
    pub reply_count: i64,
    /// Timestamp of the latest reply.
    pub latest_reply_at: Option<DateTime<Utc>>,
}

/// Raw row returned from the thread previews query.
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
