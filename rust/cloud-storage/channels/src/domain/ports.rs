use crate::domain::models::{
    ChannelAttachment, ChannelParticipant, CountedReaction, MessageAttachment,
    MessagePageDirection, ThreadData, ThreadReply, ThreadReplyRow, TopLevelMessageRow,
};
use chrono::{DateTime, Utc};
use models_pagination::{CreatedAt, Query};
use std::collections::HashMap;
use uuid::Uuid;

/// Repository for fetching channel message data.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait ChannelMessagesRepo: Send + Sync + 'static {
    /// Error type for repo operations.
    type Err: Send;

    /// Fetch top-level messages (thread_id IS NULL). Cursor-paginated on created_at DESC.
    fn get_top_level_messages(
        &self,
        channel_id: Uuid,
        query: &Query<Uuid, CreatedAt, ()>,
        direction: MessagePageDirection,
        limit: u16,
    ) -> impl Future<Output = Result<TopLevelMessagesQueryResult, Self::Err>> + Send;

    /// Batch-fetch thread data (stats + preview replies) for parent messages in a single query.
    fn get_thread_data(
        &self,
        parent_ids: &[Uuid],
        preview_count: u16,
    ) -> impl Future<Output = Result<HashMap<Uuid, ThreadData>, Self::Err>> + Send;

    /// Fetch all non-deleted replies for a parent message, oldest-first.
    fn get_thread_replies(
        &self,
        parent_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ThreadReplyRow>, Self::Err>> + Send;

    /// Batch-fetch reactions for a set of message ids.
    fn get_reactions_batch(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, Vec<CountedReaction>>, Self::Err>> + Send;

    /// Batch-fetch attachments for a set of message ids.
    fn get_attachments_batch(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, Vec<MessageAttachment>>, Self::Err>> + Send;

    /// Fetch channel-level attachments, cursor-paginated on created_at DESC.
    fn get_channel_attachments(
        &self,
        channel_id: Uuid,
        query: &Query<Uuid, CreatedAt, ()>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<ChannelAttachment>, Self::Err>> + Send;

    /// Fetch active participants for a channel.
    fn get_channel_participants(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, Self::Err>> + Send;

    /// Resolve a message id to its top-level parent row. If the message is a thread reply,
    /// returns the parent; if already top-level, returns itself. Returns `None` if not found.
    fn resolve_top_level_parent(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<TopLevelMessageRow>, Self::Err>> + Send;

    /// Fetch top-level messages around an anchor, split into before (DESC) and after (ASC).
    /// Each side is limited to `limit` rows for overfetch; trimming happens in the service.
    fn get_top_level_messages_around(
        &self,
        channel_id: Uuid,
        anchor_created_at: DateTime<Utc>,
        anchor_id: Uuid,
        limit: u16,
    ) -> impl Future<Output = Result<(Vec<TopLevelMessageRow>, Vec<TopLevelMessageRow>), Self::Err>> + Send;
}

/// Service for fetching paginated channel messages.
pub trait ChannelMessagesService: Send + Sync + 'static {
    /// Fetch a page of channel messages with thread previews, reactions, and attachments.
    fn get_channel_messages(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        direction: MessagePageDirection,
        limit: u16,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send;

    /// Fetch a paginated page of channel-level attachments.
    fn get_channel_attachments(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        limit: u16,
    ) -> impl Future<Output = Result<ChannelAttachmentsPage, ChannelMessagesErr>> + Send;

    /// Fetch active participants for a channel.
    fn get_channel_participants(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, ChannelMessagesErr>> + Send;

    /// Fetch a centered window of messages around a specific message id.
    fn get_channel_messages_around(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        limit: u16,
    ) -> impl Future<Output = Result<ChannelMessagesPage, ChannelMessagesErr>> + Send;

    /// Fetch all replies for the thread identified by `message_id`.
    ///
    /// If `message_id` is itself a reply, replies are fetched for its top-level parent.
    fn get_thread_replies(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ThreadReply>, ChannelMessagesErr>> + Send;
}

/// Access check for channel membership. Separated from the business logic service.
pub trait ChannelAccessCheck: Send + Sync + 'static {
    /// Check whether a user is an active participant in a channel.
    fn is_channel_member(
        &self,
        channel_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<bool, anyhow::Error>> + Send;
}

/// A paginated page of channel messages.
pub type ChannelMessagesPage =
    models_pagination::PaginatedCursor<super::models::ChannelMessage, Uuid, CreatedAt, ()>;

/// Result for a cursor-paginated channel messages query.
pub struct ChannelMessagesQueryResult {
    /// The page of messages.
    pub page: ChannelMessagesPage,
    /// Whether at least one newer message exists before the first item of this page.
    pub has_more_newer: bool,
}

/// Result from fetching top-level message rows for pagination.
pub struct TopLevelMessagesQueryResult {
    /// Message rows for the requested direction.
    pub rows: Vec<TopLevelMessageRow>,
    /// Whether at least one newer message exists before the first returned row.
    pub has_more_newer: bool,
}

/// A paginated page of channel attachments.
pub type ChannelAttachmentsPage =
    models_pagination::PaginatedCursor<ChannelAttachment, Uuid, CreatedAt, ()>;

/// Errors that can occur when fetching channel messages.
#[derive(Debug, thiserror::Error)]
pub enum ChannelMessagesErr {
    /// A database error occurred.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
    /// The requested message was not found.
    #[error("message {0} not found")]
    MessageNotFound(Uuid),
}
