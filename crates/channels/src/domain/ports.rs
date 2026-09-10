#[cfg(feature = "attachment")]
use crate::domain::models::RecentChannelMessage;
use crate::domain::models::{
    Activity, ActivityType, AddParticipantsRequest, AttachmentEntityReference, BotId,
    ChannelAttachment, ChannelAttachmentType, ChannelInfo, ChannelJoinCodeResponse,
    ChannelMetadata, ChannelParticipant, ChannelPreview, ChannelPreviewRow, CreateChannelRequest,
    CreateChannelResponse, CreateEntityMentionOptions, CreatedChannel, EntityMention,
    GetOrCreateChannelResponse, GetOrCreateDmRequest, GetOrCreatePrivateRequest,
    PatchChannelRequest, ReferencedShareItem, RemoveParticipantsRequest, Sender,
};
#[cfg(feature = "list")]
use crate::domain::models::{
    ChannelWithLatest, ChannelWithParticipants, GetChannelsParams, GetChannelsRequest,
    GetThreadReplyRowsParams, GetThreadReplyRowsRequest, LatestMessage, MessageListItem, UserName,
};
use crate::domain::side_effects::{
    ChannelDocumentMention, ChannelNotificationEffect, ThreadNotificationContext,
};
use crate::domain::{
    dm::{EnsureDms, EnsureDmsSummary},
    events::ChannelEvent,
};
use channel_sender::ChannelSender;
use entity_access::domain::models::{EntityAccessReceipt, MemberParticipantRole};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Query};
#[cfg(feature = "list")]
use std::collections::HashMap;
use std::collections::HashSet;
use uuid::Uuid;

/// Repository for channel list persistence and query data.
#[cfg(feature = "list")]
pub trait ChannelListRepo: Send + Sync + 'static {
    /// Fetch channels visible to a user with their active participants.
    fn get_user_channels_with_participants(
        &self,
        req: GetChannelsParams,
    ) -> impl Future<Output = Result<Vec<ChannelWithParticipants>, rootcause::Report>> + Send;

    /// Batch-fetch latest messages for channels.
    fn get_latest_channel_messages_batch(
        &self,
        channels: &[Uuid],
    ) -> impl Future<Output = Result<HashMap<Uuid, LatestMessage>, rootcause::Report>> + Send;

    /// Fetch recent activity for a user.
    fn get_channel_list_activities(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Activity>, rootcause::Report>> + Send;

    /// Fetch top-level channel messages for Soup thread rendering.
    fn get_thread_messages(
        &self,
        req: GetThreadReplyRowsParams,
    ) -> impl Future<Output = Result<Vec<MessageListItem>, rootcause::Report>> + Send;
}

/// Repository for user display names needed by channel list rendering.
#[cfg(feature = "list")]
pub trait ChannelListUserRepo: Send + Sync + 'static {
    /// Fetch names for user ids.
    fn get_names_for_ids(
        &self,
        names: HashSet<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<Vec<UserName>, rootcause::Report>> + Send;
}

/// Service for legacy channel list APIs.
#[cfg(feature = "list")]
pub trait ChannelListService: Send + Sync + 'static {
    /// Fetch channels visible to a user, enriched for list display.
    fn get_channels(
        &self,
        req: GetChannelsRequest,
    ) -> impl Future<Output = Result<Vec<ChannelWithLatest>, rootcause::Report>> + Send;

    /// Fetch recent activity for a user.
    fn get_activities(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Activity>, rootcause::Report>> + Send;

    /// Fetch top-level channel messages for Soup thread rendering.
    fn get_thread_messages(
        &self,
        req: GetThreadReplyRowsRequest,
    ) -> impl Future<Output = Result<Vec<MessageListItem>, rootcause::Report>> + Send;

    /// Fetch names for user ids.
    fn get_names(
        &self,
        names: HashSet<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<Vec<UserName>, rootcause::Report>> + Send;
}

/// Repository methods needed to render channels as AI attachments.
#[cfg(feature = "attachment")]
pub trait ChannelAttachmentRepo: Send + Sync + 'static {
    /// Error type for repo operations.
    type Err: Into<anyhow::Error> + Send;

    /// Fetch the stored channel name, if one exists.
    fn get_channel_name_for_attachment(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Fetch recent non-deleted channel messages, newest-first.
    fn get_recent_messages_for_attachment(
        &self,
        channel_id: Uuid,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<RecentChannelMessage>, Self::Err>> + Send;
}

/// Repository for channel persistence and query data.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait ChannelRepo: Send + Sync + 'static {
    /// Error type for repo operations.
    type Err: Into<anyhow::Error> + Send;

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

    /// Fetch attachment references for an entity, scoped to channels the user belongs to.
    fn get_attachment_references(
        &self,
        entity_type: &str,
        entity_id: &str,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<AttachmentEntityReference>, Self::Err>> + Send;

    /// Fetch channel metadata.
    fn get_channel_info(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<ChannelInfo, Self::Err>> + Send;

    /// Atomically assign a channel join code if absent and return the persisted code.
    fn get_or_create_channel_join_code(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Uuid, Self::Err>> + Send;

    /// Resolve channel metadata by its join code.
    fn get_channel_info_by_join_code(
        &self,
        join_code: Uuid,
    ) -> impl Future<Output = Result<Option<ChannelInfo>, Self::Err>> + Send;

    /// Resolve channel metadata from a user's perspective.
    fn get_channel_metadata(
        &self,
        channel_id: Uuid,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ChannelMetadata, Self::Err>> + Send;

    /// Batch fetch channel preview rows for the requested ids, computing
    /// per-channel access for the given viewer.
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

    /// Fetch the team a user belongs to, if any.
    fn get_user_team_id<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Create a channel and return its complete active participant set.
    fn create_channel<'a>(
        &self,
        owner_id: MacroUserIdStr<'a>,
        org_id: Option<i64>,
        req: CreateChannelRequest,
    ) -> impl Future<Output = Result<CreatedChannel, Self::Err>> + Send;

    /// Add or reactivate a user in every auto-join channel for a team.
    fn auto_join_by_team_id<'a>(
        &self,
        team_id: &Uuid,
        user_id: &MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Soft-leave a user from every active channel membership for a team.
    ///
    /// Returns the channel ids whose memberships changed.
    fn leave_by_team_id<'a>(
        &self,
        team_id: &Uuid,
        user_id: &MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;

    /// Roll back a team leave by restoring a user's memberships in the exact channels provided.
    fn restore_by_channel_ids<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
        channel_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Fetch an existing direct message channel.
    fn maybe_get_dm<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
        recipient_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Fetch an existing private channel.
    fn maybe_get_private_channel<'a>(
        &self,
        participants: HashSet<MacroUserIdStr<'a>>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Patch a channel.
    ///
    /// `team_id` is the channel's effective team after any requested conversion.
    fn patch_channel(
        &self,
        channel_id: Uuid,
        user_id: String,
        team_id: Option<Uuid>,
        req: PatchChannelRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete a channel.
    fn delete_channel(
        &self,
        channel_id: Uuid,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically add or reactivate a participant, returning whether membership changed.
    fn add_participant<'a>(
        &self,
        channel_id: Uuid,
        user_id: MacroUserIdStr<'a>,
        role: super::models::ParticipantRole,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Remove a participant.
    fn remove_participant(
        &self,
        channel_id: Uuid,
        user_id: String,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Update the channel activity timestamp.
    fn touch_channel_updated_at(
        &self,
        channel_id: Uuid,
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

    /// Delete an entity mention by id. Returns the deleted row, if one existed.
    fn delete_entity_mention_by_id(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<EntityMention>, Self::Err>> + Send;

    /// Fetch active participants.
    fn get_participants(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, Self::Err>> + Send;

    /// Upsert activity for the user in the channel.
    fn upsert_activity<'a>(
        &self,
        user_id: ChannelSender<'a>,
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
}

/// Service for channel reads and mutations.
pub trait ChannelService: Send + Sync + 'static {
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

    /// Fetch channel metadata (type + resolved display name) from the viewer's perspective.
    fn get_channel_metadata(
        &self,
        channel_id: Uuid,
        viewer_user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ChannelMetadata, ChannelMessagesErr>> + Send {
        let _ = (channel_id, viewer_user_id);
        async move {
            Err(ChannelMessagesErr::Repo(anyhow::anyhow!(
                "get_channel_metadata is not configured"
            )))
        }
    }

    /// Batch fetch channel previews for the requested ids.
    fn batch_get_channel_previews(
        &self,
        _viewer_user_id: MacroUserIdStr<'static>,
        _org_id: Option<i64>,
        _channel_ids: Vec<String>,
    ) -> impl Future<Output = Result<Vec<ChannelPreview>, ChannelMessagesErr>> + Send {
        async move { Ok(Vec::new()) }
    }

    /// Fetch attachment references for an entity visible to a user.
    fn get_attachment_references(
        &self,
        entity_type: String,
        entity_id: String,
        user_id: String,
    ) -> impl Future<Output = Result<Vec<AttachmentEntityReference>, ChannelMessagesErr>> + Send;

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
        _actor: Sender,
        _actor_org_id: Option<i64>,
        _req: CreateChannelRequest,
    ) -> impl Future<Output = Result<CreateChannelResponse, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Create a channel owned by `owner` on the platform's initiative (e.g.
    /// signup). The activity is attributed to the system bot acting for
    /// `owner`; ownership and permissions are unchanged.
    fn create_system_channel(
        &self,
        owner: MacroUserIdStr<'static>,
        req: CreateChannelRequest,
    ) -> impl Future<Output = Result<CreateChannelResponse, ChannelMutationErr>> + Send {
        self.create_channel_on_behalf(owner, bot_id::MACRO_SYSTEM_BOT_ID, req)
    }

    /// Create a channel owned by `owner` with Created attributed to `actor`
    /// acting for that owner. Ownership and permissions stay with `owner`.
    fn create_channel_on_behalf(
        &self,
        _owner: MacroUserIdStr<'static>,
        _actor: BotId,
        _req: CreateChannelRequest,
    ) -> impl Future<Output = Result<CreateChannelResponse, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Add or reactivate a user in every auto-join channel for a team.
    fn auto_join_by_team_id(
        &self,
        _team_id: &Uuid,
        _user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "team channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Soft-leave a user from every active channel membership for a team.
    ///
    /// Returns the channel ids whose memberships changed.
    fn leave_by_team_id(
        &self,
        _team_id: &Uuid,
        _user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Uuid>, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "team channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Roll back a team leave by restoring a user's memberships in the exact channels provided.
    fn restore_by_channel_ids(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _channel_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "team channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Ensure all direct-message pairs in a batch.
    fn ensure_dms(
        &self,
        _command: EnsureDms,
    ) -> impl Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Get or create a direct message channel.
    fn get_or_create_dm(
        &self,
        _actor: Sender,
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
        _actor: Sender,
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
        _actor: Sender,
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
        _actor: Sender,
        _channel_id: Uuid,
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
        _actor: Sender,
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
        _actor: Sender,
        _channel_id: Uuid,
        _req: RemoveParticipantsRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Get or create the reusable join code for a private channel.
    fn get_channel_join_code(
        &self,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<ChannelJoinCodeResponse, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Join a channel.
    fn join_channel(
        &self,
        _actor: Sender,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }

    /// Join a private channel using its reusable join code.
    fn join_channel_by_code(
        &self,
        _actor: Sender,
        _join_code: Uuid,
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
        _actor: Sender,
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
        _access: EntityAccessReceipt<MemberParticipantRole>,
        _activity_type: ActivityType,
    ) -> impl Future<Output = Result<Activity, ChannelMutationErr>> + Send {
        async move {
            Err(ChannelMutationErr::NotFound(
                "channel mutations are not configured".to_string(),
            ))
        }
    }
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

/// Allows a boxed dispatcher to be used wherever a `ChannelEventDispatcher` is
/// expected, so callers (e.g. the AI toolset) can inject a side-effect-wired
/// dispatcher behind a uniform type.
impl ChannelEventDispatcher for std::sync::Arc<dyn ChannelEventDispatcher> {
    fn dispatch(&self, event: ChannelEvent) {
        (**self).dispatch(event);
    }
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
    /// Authenticated caller is forbidden from performing the mutation.
    #[error("{0}")]
    Forbidden(String),
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
