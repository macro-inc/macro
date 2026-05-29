use crate::domain::events::ChannelEvent;
use crate::domain::models::{
    Activity, ActivityType, AddParticipantsRequest, AttachmentEntityReference, ChannelAttachment,
    ChannelAttachmentType, ChannelContextMessage, ChannelInfo, ChannelMessageFilters,
    ChannelMetadata, ChannelParticipant, ChannelPreview, ChannelPreviewRow, CountedReaction,
    CreateChannelRequest, CreateChannelResponse, CreateEntityMentionOptions, DeleteMessageQuery,
    EntityMention, GetOrCreateChannelResponse, GetOrCreateDmRequest, GetOrCreatePrivateRequest,
    MessageAttachment, MessagePageDirection, MutatedAttachment, MutatedMessage,
    NewChannelAttachment, PatchChannelRequest, PatchMessageRequest, PostMessageRequest,
    PostMessageResponse, PostReactionRequest, PostTypingRequest, ReferencedShareItem,
    RemoveParticipantsRequest, ResolvedChannelMessage, SimpleMention, ThreadData, ThreadReply,
    ThreadReplyRow, TopLevelMessageRow,
};
use crate::domain::side_effects::{
    ChannelDocumentMention, ChannelNotificationEffect, ChannelRealtimeEffect,
    ThreadNotificationContext,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Query};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Repository for channel persistence and query data.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait ChannelRepo: Send + Sync + 'static {
    /// Error type for repo operations.
    type Err: Into<anyhow::Error> + Send;

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

    /// Fetch messages around a target message in chronological order.
    fn get_messages_with_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
    ) -> impl Future<Output = Result<Vec<ChannelContextMessage>, Self::Err>> + Send;

    /// Fetch attachment references for an entity, scoped to channels the user belongs to.
    fn get_attachment_references(
        &self,
        entity_type: &str,
        entity_id: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<AttachmentEntityReference>, Self::Err>> + Send;

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

    /// Batch fetch channel preview rows for the requested ids, computing
    /// per-channel access for the given viewer/org.
    fn batch_get_channel_previews(
        &self,
        channel_ids: &[String],
        viewer_user_id: &str,
        org_id: Option<i64>,
    ) -> impl Future<Output = Result<Vec<ChannelPreviewRow>, Self::Err>> + Send;

    /// Resolve a channel's display name from the viewer's perspective.
    fn resolve_channel_name(
        &self,
        info: &ChannelInfo,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<String, Self::Err>> + Send;

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

    /// Create a single entity mention.
    fn create_entity_mention(
        &self,
        options: CreateEntityMentionOptions,
    ) -> impl Future<Output = Result<EntityMention, Self::Err>> + Send;

    /// Fetch an entity mention by id.
    fn get_entity_mention_by_id(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<EntityMention>, Self::Err>> + Send;

    /// Delete an entity mention by id. Returns whether a row was removed.
    fn delete_entity_mention_by_id(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Patch message attachment state.
    fn patch_message_attachments(
        &self,
        message_id: Uuid,
        attachments: Vec<MutatedAttachment>,
    ) -> impl Future<Output = Result<MutatedMessage, Self::Err>> + Send;

    /// Patch message content within a channel.
    fn patch_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        content: String,
    ) -> impl Future<Output = Result<MutatedMessage, Self::Err>> + Send;

    /// Delete a message within a channel.
    fn delete_message(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<MutatedMessage, Self::Err>> + Send;

    /// Fetch the owner of a message within a channel.
    fn get_message_owner(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

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

    /// Fetch all activities for a user across channels, most-recent first.
    fn get_activities(
        &self,
        user_id: String,
    ) -> impl Future<Output = Result<Vec<Activity>, Self::Err>> + Send;

    /// Upsert the user's activity for a channel with the given type, returning the row.
    fn set_activity(
        &self,
        user_id: String,
        channel_id: Uuid,
        activity_type: ActivityType,
    ) -> impl Future<Output = Result<Activity, Self::Err>> + Send;

    /// Add a reaction to a message within a channel.
    fn add_reaction(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Remove a reaction from a message within a channel.
    fn remove_reaction(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        emoji: String,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get grouped reactions for a message within a channel.
    fn get_message_reactions(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<CountedReaction>, Self::Err>> + Send;
}

/// Service for channel reads and mutations.
pub trait ChannelService: Send + Sync + 'static {
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

    /// Batch fetch channel previews for the requested ids.
    fn batch_get_channel_previews(
        &self,
        _viewer_user_id: MacroUserIdStr<'static>,
        _org_id: Option<i64>,
        _channel_ids: Vec<String>,
    ) -> impl Future<Output = Result<Vec<ChannelPreview>, ChannelMessagesErr>> + Send {
        async move { Ok(Vec::new()) }
    }

    /// Fetch messages around a target message in chronological order.
    fn get_message_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
    ) -> impl Future<Output = Result<Vec<ChannelContextMessage>, ChannelMessagesErr>> + Send {
        let _ = (channel_id, before, after);
        async move { Err(ChannelMessagesErr::MessageNotFound(message_id)) }
    }

    /// Fetch attachment references for an entity visible to a user.
    fn get_attachment_references(
        &self,
        entity_type: String,
        entity_id: String,
        user_id: String,
    ) -> impl Future<Output = Result<Vec<AttachmentEntityReference>, ChannelMessagesErr>> + Send;

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

    /// Fetch all activities for the user across channels.
    fn get_activities(
        &self,
        _user_id: String,
    ) -> impl Future<Output = Result<Vec<Activity>, ChannelMessagesErr>> + Send {
        async move { Ok(Vec::new()) }
    }

    // Channel mutation operations.

    /// Create a channel.
    fn create_channel(
        &self,
        _actor: MacroUserIdStr<'static>,
        _actor_org_id: Option<i64>,
        _req: CreateChannelRequest,
    ) -> impl Future<Output = Result<CreateChannelResponse, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Get or create a direct message channel.
    fn get_or_create_dm(
        &self,
        _actor: MacroUserIdStr<'static>,
        _req: GetOrCreateDmRequest,
    ) -> impl Future<Output = Result<GetOrCreateChannelResponse, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Get or create a private channel.
    fn get_or_create_private(
        &self,
        _actor: MacroUserIdStr<'static>,
        _req: GetOrCreatePrivateRequest,
    ) -> impl Future<Output = Result<GetOrCreateChannelResponse, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Patch a channel.
    fn patch_channel(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: PatchChannelRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Delete a channel.
    fn delete_channel(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Send a message.
    fn post_message(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: PostMessageRequest,
    ) -> impl Future<Output = Result<PostMessageResponse, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Patch a message.
    fn patch_message(
        &self,
        _actor: MacroUserIdStr<'static>,
        _actor_role: super::models::ParticipantRole,
        _channel_id: Uuid,
        _message_id: Uuid,
        _req: PatchMessageRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Delete a message.
    fn delete_message(
        &self,
        _actor: MacroUserIdStr<'static>,
        _actor_role: super::models::ParticipantRole,
        _channel_id: Uuid,
        _message_id: Uuid,
        _query: DeleteMessageQuery,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Mutate a reaction.
    fn post_reaction(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: PostReactionRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Emit a typing update.
    fn post_typing(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: PostTypingRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Add participants to a channel.
    fn add_participants(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
        _req: AddParticipantsRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Remove participants from a channel.
    fn remove_participants(
        &self,
        _channel_id: Uuid,
        _req: RemoveParticipantsRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Join a channel.
    fn join_channel(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Leave a channel.
    fn leave_channel(
        &self,
        _actor: MacroUserIdStr<'static>,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Create an entity mention.
    fn create_entity_mention(
        &self,
        _options: CreateEntityMentionOptions,
    ) -> impl Future<Output = Result<EntityMention, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Fetch an entity mention by id.
    fn get_entity_mention(
        &self,
        _id: Uuid,
    ) -> impl Future<Output = Result<Option<EntityMention>, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Delete an entity mention by id. Returns whether a row was removed.
    fn delete_entity_mention(
        &self,
        _id: Uuid,
    ) -> impl Future<Output = Result<bool, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Upsert the user's activity (view/interaction) for a channel.
    fn post_activity(
        &self,
        _user_id: String,
        _channel_id: Uuid,
        _activity_type: ActivityType,
    ) -> impl Future<Output = Result<Activity, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
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

/// Publisher for realtime channel side-effect commands.
pub trait ChannelRealtimePublisher: Send + Sync + 'static {
    /// Error type for publishing operations.
    type Err: Into<anyhow::Error> + Send;

    /// Publish an explicit realtime effect.
    fn publish(
        &self,
        effect: ChannelRealtimeEffect,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Sender for notification side-effect commands.
pub trait ChannelNotificationSender: Send + Sync + 'static {
    /// Error type for notification operations.
    type Err: Into<anyhow::Error> + Send;

    /// Send an explicit notification effect.
    fn send(
        &self,
        notification: ChannelNotificationEffect,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Read model for data needed while deriving side effects.
pub trait ChannelSideEffectContext: Send + Sync + 'static {
    /// Error type for context lookups.
    type Err: Into<anyhow::Error> + Send;

    /// Count persisted channel messages.
    fn get_channel_message_count(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// Return user ids that exist in the application.
    fn get_existing_user_ids(
        &self,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<HashSet<String>, Self::Err>> + Send;

    /// Load display metadata for mentioned documents.
    fn get_document_mentions(
        &self,
        document_ids: Vec<String>,
    ) -> impl Future<Output = Result<Vec<ChannelDocumentMention>, Self::Err>> + Send;

    /// Load notification context for a thread reply.
    fn get_thread_notification_context(
        &self,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<ThreadNotificationContext, Self::Err>> + Send;

    /// Load a user's profile picture URL for notification copy.
    fn get_sender_profile_picture_url(
        &self,
        sender_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Option<String>> + Send;
}

/// Handler for durable channel events.
pub trait ChannelEventHandler: Clone + Send + Sync + 'static {
    /// Handle a durable channel event.
    fn handle(&self, event: ChannelEvent) -> impl Future<Output = ()> + Send;
}

/// Dispatcher for channel side effects emitted after durable state changes.
pub trait ChannelEventDispatcher: Send + Sync + 'static {
    /// Fire-and-forget dispatch of a channel event.
    fn dispatch(&self, event: ChannelEvent);
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

/// Share-permission updater for items referenced by channel messages.
pub trait ChannelReferenceSharePermissions: Send + Sync + 'static {
    /// Error type for reference share-permission operations.
    type Err: Into<anyhow::Error> + Send;

    /// Update channel share permissions for referenced items that `actor` can view.
    ///
    /// Implementations must not grant access for an item the actor cannot already view.
    fn update_channel_share_permissions_for_referenced_items(
        &self,
        actor: MacroUserIdStr<'static>,
        channel_id: Uuid,
        items: Vec<ReferencedShareItem>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
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
