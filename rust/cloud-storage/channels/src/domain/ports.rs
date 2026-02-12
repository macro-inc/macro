use crate::domain::models::{
    ChannelAttachment, ChannelParticipant, CountedReaction, MessageAttachment, ThreadData,
    TopLevelMessageRow,
};
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
        limit: u16,
    ) -> impl Future<Output = Result<Vec<TopLevelMessageRow>, Self::Err>> + Send;

    /// Batch-fetch thread data (stats + preview replies) for parent messages in a single query.
    fn get_thread_data(
        &self,
        parent_ids: &[Uuid],
        preview_count: u16,
    ) -> impl Future<Output = Result<HashMap<Uuid, ThreadData>, Self::Err>> + Send;

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
}

/// A paginated page of channel messages.
pub type ChannelMessagesPage =
    models_pagination::PaginatedCursor<super::models::ChannelMessage, Uuid, CreatedAt, ()>;

/// A paginated page of channel attachments.
pub type ChannelAttachmentsPage =
    models_pagination::PaginatedCursor<ChannelAttachment, Uuid, CreatedAt, ()>;

/// Errors that can occur when fetching channel messages.
#[derive(Debug, thiserror::Error)]
pub enum ChannelMessagesErr {
    /// A database error occurred.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
}
