use crate::domain::models::{
    AddParticipantsRequest, ChannelAttachment, ChannelAttachmentType, ChannelInfo,
    ChannelMessageFilters, ChannelMetadata, ChannelParticipant, CountedReaction,
    CreateChannelRequest, CreateChannelResponse, DeleteMessageQuery, GetOrCreateChannelResponse,
    GetOrCreateDmRequest, GetOrCreatePrivateRequest, MessageAttachment, MessagePageDirection,
    MutatedAttachment, MutatedMessage, NewChannelAttachment, PatchChannelRequest,
    PatchMessageRequest, PostMessageRequest, PostMessageResponse, PostReactionRequest,
    PostTypingRequest, RemoveParticipantsRequest, ResolvedChannelMessage, SimpleMention,
    ThreadData, ThreadReply, ThreadReplyRow, TopLevelMessageRow,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Query};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Repository for fetching channel message data.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait ChannelMessagesRepo: Send + Sync + 'static {
    /// Error type for repo operations.
    type Err: Send;

    /// Fetch top-level messages (thread_id IS NULL). Cursor-paginated on created_at DESC.
    ///
    /// `notification_user_id` is used only when `filters.notification_filters` is non-empty.
    fn get_top_level_messages(
        &self,
        channel_id: Uuid,
        query: &Query<Uuid, CreatedAt, ()>,
        direction: MessagePageDirection,
        limit: u16,
        filters: &ChannelMessageFilters,
        notification_user_id: Option<MacroUserIdStr<'static>>,
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
        attachment_type: Option<ChannelAttachmentType>,
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

    /// Resolve a message id to top-level/thread-reply metadata.
    fn resolve_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<ResolvedChannelMessage>, Self::Err>> + Send;

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
    ///
    /// `notification_user_id` is used only when `filters.notification_filters` is non-empty.
    fn get_channel_messages(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        direction: MessagePageDirection,
        limit: u16,
        filters: &ChannelMessageFilters,
        notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send;

    /// Fetch a paginated page of channel-level attachments.
    fn get_channel_attachments(
        &self,
        channel_id: Uuid,
        query: Query<Uuid, CreatedAt, ()>,
        limit: u16,
        attachment_type: Option<ChannelAttachmentType>,
    ) -> impl Future<Output = Result<ChannelAttachmentsPage, ChannelMessagesErr>> + Send;

    /// Fetch active participants for a channel.
    fn get_channel_participants(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, ChannelMessagesErr>> + Send;

    /// Fetch a centered window of messages around a specific message id.
    ///
    /// The result's `has_more_newer` reports whether newer messages exist outside the
    /// returned window.
    fn get_channel_messages_around(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        limit: u16,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send;

    /// Fetch all replies for the thread identified by `message_id`.
    ///
    /// If `message_id` is itself a reply, replies are fetched for its top-level parent.
    fn get_thread_replies(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ThreadReply>, ChannelMessagesErr>> + Send;

    /// Resolve whether a message id is top-level or a thread reply.
    fn resolve_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<ResolvedChannelMessage, ChannelMessagesErr>> + Send {
        let _ = channel_id;
        async move { Err(ChannelMessagesErr::MessageNotFound(message_id)) }
    }
}

/// A paginated page of channel messages.
pub type ChannelMessagesPage =
    models_pagination::PaginatedCursor<super::models::ChannelMessage, Uuid, CreatedAt, ()>;

/// Result for a cursor-paginated channel messages query.
#[derive(Debug)]
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

/// Repository for channel mutation persistence.
pub trait ChannelMutationsRepo: Send + Sync + 'static {
    /// Error type for repo operations.
    type Err: Into<anyhow::Error> + Send;

    /// Fetch channel metadata.
    fn get_channel_info(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<ChannelInfo, Self::Err>> + Send;

    /// Resolve channel metadata from a user's perspective.
    fn get_channel_metadata(
        &self,
        channel_id: Uuid,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ChannelMetadata, Self::Err>> + Send;

    /// Check whether a user belongs to a team.
    fn user_has_team(
        &self,
        user_id: String,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Create a channel.
    fn create_channel(
        &self,
        owner_id: String,
        org_id: Option<i64>,
        req: CreateChannelRequest,
    ) -> impl Future<Output = Result<Uuid, Self::Err>> + Send;

    /// Fetch an existing direct message channel.
    fn maybe_get_dm(
        &self,
        user_id: String,
        recipient_id: String,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Fetch an existing private channel.
    fn maybe_get_private_channel(
        &self,
        participants: Vec<String>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Patch a channel.
    fn patch_channel(
        &self,
        channel_id: Uuid,
        user_id: String,
        req: PatchChannelRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete a channel.
    fn delete_channel(
        &self,
        channel_id: Uuid,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Add a participant.
    fn add_participant(
        &self,
        channel_id: Uuid,
        user_id: String,
        role: super::models::ParticipantRole,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Remove a participant.
    fn remove_participant(
        &self,
        channel_id: Uuid,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Create a message.
    fn create_message(
        &self,
        channel_id: Uuid,
        sender_id: String,
        content: String,
        thread_id: Option<Uuid>,
    ) -> impl Future<Output = Result<MutatedMessage, Self::Err>> + Send;

    /// Update the channel activity timestamp.
    fn touch_channel_updated_at(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Create message mentions.
    fn create_message_mentions(
        &self,
        message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Sync message mentions by deleting old mentions and creating new ones.
    fn sync_message_mentions(
        &self,
        message_id: Uuid,
        mentions: Vec<SimpleMention>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Add attachments to a message.
    fn add_attachments(
        &self,
        message_id: Uuid,
        channel_id: Uuid,
        attachments: Vec<NewChannelAttachment>,
    ) -> impl Future<Output = Result<Vec<MutatedAttachment>, Self::Err>> + Send;

    /// Get all attachments for a message.
    fn get_message_attachments(
        &self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MutatedAttachment>, Self::Err>> + Send;

    /// Delete attachments by id.
    fn delete_attachments(
        &self,
        attachment_ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete entity mentions for detached attachment entity ids.
    fn delete_entity_mentions_for_entities(
        &self,
        entity_ids: Vec<String>,
        source_entity_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Patch message attachment state.
    fn patch_message_attachments(
        &self,
        message_id: Uuid,
        attachments: Vec<MutatedAttachment>,
    ) -> impl Future<Output = Result<MutatedMessage, Self::Err>> + Send;

    /// Patch message content.
    fn patch_message(
        &self,
        message_id: Uuid,
        content: String,
    ) -> impl Future<Output = Result<MutatedMessage, Self::Err>> + Send;

    /// Delete a message.
    fn delete_message(
        &self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<MutatedMessage, Self::Err>> + Send;

    /// Fetch the owner of a message.
    fn get_message_owner(
        &self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<String, Self::Err>> + Send;

    /// Fetch active participants.
    fn get_participants(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, Self::Err>> + Send;

    /// Fetch notification recipients for a thread.
    fn get_thread_participants(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Self::Err>> + Send;

    /// Upsert activity for the user in the channel.
    fn upsert_activity(
        &self,
        user_id: String,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Add a reaction.
    fn add_reaction(
        &self,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Remove a reaction.
    fn remove_reaction(
        &self,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get grouped reactions for a message.
    fn get_message_reactions(
        &self,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<CountedReaction>, Self::Err>> + Send;
}

/// Gateway for realtime channel updates.
pub trait ChannelRealtimeGateway: Send + Sync + 'static {
    /// Error type for gateway operations.
    type Err: Into<anyhow::Error> + Send;

    /// Send an update to channel participants.
    fn send_update<T: Serialize + Send>(
        &self,
        message_type: &'static str,
        payload: T,
        participants: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Dispatcher for persistent and push notifications.
pub trait ChannelNotificationDispatcher: Send + Sync + 'static {
    /// Error type for notification operations.
    type Err: Into<anyhow::Error> + Send;

    /// Dispatch message notifications.
    fn dispatch_message_notifications(
        &self,
        channel_id: Uuid,
        metadata: ChannelMetadata,
        participants: Vec<ChannelParticipant>,
        message: MutatedMessage,
        mentions: Vec<SimpleMention>,
        has_attachments: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Dispatch invite notifications.
    fn dispatch_invite_notifications(
        &self,
        channel_id: Uuid,
        invited_by_user_id: MacroUserIdStr<'static>,
        recipient_user_ids: Vec<MacroUserIdStr<'static>>,
        metadata: ChannelMetadata,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Dispatcher for contact graph updates.
pub trait ChannelContactsDispatcher: Send + Sync + 'static {
    /// Error type for contacts operations.
    type Err: Into<anyhow::Error> + Send;

    /// Enqueue a complete contact graph update for the provided users.
    fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Indexer for channel search updates.
pub trait ChannelSearchIndexer: Send + Sync + 'static {
    /// Enqueue a message upsert.
    fn index_message(&self, channel_id: Uuid, message_id: Uuid) -> impl Future<Output = ()> + Send;

    /// Enqueue a message or channel removal.
    fn remove_message(
        &self,
        channel_id: Uuid,
        message_id: Option<Uuid>,
    ) -> impl Future<Output = ()> + Send;
}

/// Service for channel share permissions caused by message references.
pub trait ChannelSharePermissionService: Send + Sync + 'static {
    /// Error type for share-permission operations.
    type Err: Into<anyhow::Error> + Send;

    /// Ensure channel participants can view referenced items.
    fn update_channel_share_permissions(
        &self,
        user_id: String,
        channel_id: Uuid,
        items: Vec<(String, String)>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Service for mutating channel state.
pub trait ChannelMutationsService: Send + Sync + 'static {
    /// Create a channel.
    fn create_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        actor_org_id: Option<i64>,
        req: CreateChannelRequest,
    ) -> impl Future<Output = Result<CreateChannelResponse, ChannelMutationErr>> + Send;

    /// Get or create a direct message channel.
    fn get_or_create_dm(
        &self,
        actor: MacroUserIdStr<'static>,
        req: GetOrCreateDmRequest,
    ) -> impl Future<Output = Result<GetOrCreateChannelResponse, ChannelMutationErr>> + Send;

    /// Get or create a private channel.
    fn get_or_create_private(
        &self,
        actor: MacroUserIdStr<'static>,
        req: GetOrCreatePrivateRequest,
    ) -> impl Future<Output = Result<GetOrCreateChannelResponse, ChannelMutationErr>> + Send;

    /// Patch a channel.
    fn patch_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PatchChannelRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Delete a channel.
    fn delete_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Send a message.
    fn post_message(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> impl Future<Output = Result<PostMessageResponse, ChannelMutationErr>> + Send;

    /// Patch a message.
    fn patch_message(
        &self,
        actor: MacroUserIdStr<'static>,
        actor_role: super::models::ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        req: PatchMessageRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Delete a message.
    fn delete_message(
        &self,
        actor: MacroUserIdStr<'static>,
        actor_role: super::models::ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        query: DeleteMessageQuery,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Mutate a reaction.
    fn post_reaction(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PostReactionRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Emit a typing update.
    fn post_typing(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: PostTypingRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Add participants to a channel.
    fn add_participants(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        req: AddParticipantsRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Remove participants from a channel.
    fn remove_participants(
        &self,
        channel_id: Uuid,
        req: RemoveParticipantsRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Join a channel.
    fn join_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;

    /// Leave a channel.
    fn leave_channel(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;
}

/// Errors that can occur while mutating channels.
#[derive(Debug, thiserror::Error)]
pub enum ChannelMutationErr {
    /// Bad request.
    #[error("{0}")]
    BadRequest(String),
    /// Unauthorized mutation attempt.
    #[error("{0}")]
    Unauthorized(String),
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// Repository error.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
    /// Realtime gateway error.
    #[error(transparent)]
    Gateway(anyhow::Error),
    /// Notification dispatch error.
    #[error(transparent)]
    Notification(anyhow::Error),
    /// Contacts dispatch error.
    #[error(transparent)]
    Contacts(anyhow::Error),
}
