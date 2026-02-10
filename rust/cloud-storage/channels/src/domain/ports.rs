use crate::domain::models::{
    CountedReaction, MessageAttachment, ThreadReplyRow, TopLevelMessageRow,
};
use models_pagination::{CreatedAt, Query};
use std::collections::HashMap;
use uuid::Uuid;

/// Repository for fetching channel message data.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait ChannelMessagesRepo: Send + Sync + 'static {
    /// Error type for repo operations.
    type Err: Send;

    /// Fetch top-level messages (thread_id IS NULL) with thread reply count
    /// and latest_reply_at. Cursor-paginated on created_at DESC.
    fn get_top_level_messages(
        &self,
        channel_id: Uuid,
        query: &Query<Uuid, CreatedAt, ()>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<TopLevelMessageRow>, Self::Err>> + Send;

    /// Fetch the last N replies per parent message (for thread previews).
    fn get_thread_previews(
        &self,
        parent_ids: &[Uuid],
        preview_count: u16,
    ) -> impl Future<Output = Result<HashMap<Uuid, Vec<ThreadReplyRow>>, Self::Err>> + Send;

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
}

/// Service for fetching paginated channel messages.
pub trait ChannelMessagesService: Send + Sync + 'static {
    /// Fetch a page of channel messages with thread previews, reactions, and attachments.
    fn get_channel_messages(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        limit: u16,
    ) -> impl Future<Output = Result<ChannelMessagesPage, ChannelMessagesErr>> + Send;
}

/// A paginated page of channel messages.
pub type ChannelMessagesPage =
    models_pagination::PaginatedCursor<super::models::ChannelMessage, Uuid, CreatedAt, ()>;

/// Errors that can occur when fetching channel messages.
#[derive(Debug, thiserror::Error)]
pub enum ChannelMessagesErr {
    /// A database error occurred.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
}
