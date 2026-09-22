use super::models::*;
use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Message use-case failure.
#[derive(Debug, thiserror::Error)]
pub enum MessageError {
    /// Parent, message, or thread does not exist or is deleted.
    #[error("message or parent not found")]
    NotFound,
    /// Caller lacks the required capability or ownership.
    #[error("not authorized for this message operation")]
    Forbidden,
    /// Invalid thread relation or anchor.
    #[error("{0}")]
    Invalid(&'static str),
    /// Persistence or delivery failed.
    #[error("message operation failed: {0}")]
    Repository(rootcause::Report),
}

/// Cursor for a chronological parent timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageCursor {
    /// Last root creation time.
    pub created_at: DateTime<Utc>,
    /// Last root UUID, used to break timestamp ties.
    pub id: Uuid,
}

/// Direction through a parent timeline, retaining channel cursor semantics.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum MessageDirection {
    /// Most recent first, or older than the cursor.
    #[default]
    Older,
    /// Newer than the cursor.
    Newer,
}

/// Root selection shared by channel timelines and document discussions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageTimelineQuery {
    /// Stable creation-time and UUID cursor.
    pub cursor: Option<MessageCursor>,
    /// Which side of the cursor to fetch.
    #[serde(default)]
    pub direction: MessageDirection,
    /// Center on the root containing this message.
    pub around: Option<Uuid>,
    /// Restrict roots to this set, for selected source threads.
    #[serde(default)]
    pub ids: Vec<Uuid>,
    /// Select anchored or unanchored roots; absent includes both.
    pub anchored: Option<bool>,
    /// Include whole-thread tombstones when reconciling persisted document marks.
    #[serde(default)]
    pub include_deleted_threads: bool,
    /// Include roots or live replies created at or after this time.
    pub activity_after: Option<DateTime<Utc>>,
    /// Include roots or live replies created before this time.
    pub activity_before: Option<DateTime<Utc>>,
    /// Page size, clamped by the application to 1..=100.
    pub limit: Option<u16>,
}

pub use super::models::{MessageListItem, MessageThreadPreview};

/// Bidirectional, bounded timeline page, ordered newest root first.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessagePage {
    /// Root messages with bounded previews.
    pub items: Vec<MessageListItem>,
    /// Continue to older roots.
    pub next_cursor: Option<MessageCursor>,
    /// Continue to newer roots.
    pub previous_cursor: Option<MessageCursor>,
}

/// A source channel thread that mentions the requested document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ReferencedThread {
    /// Source parent used by the common message reader and mutations.
    pub parent: MessageParent,
    /// Source root identity; discovery does not copy its message content.
    pub root_id: Uuid,
    /// Source channel's current display name, returned only after access checks.
    pub channel_name: Option<String>,
    /// Whether this viewer currently has permission to reply in the source channel.
    pub can_reply: bool,
}

/// Authorized source threads, deduplicated by root.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ReferencedThreadPage {
    /// Accessible channel discussions mentioning the document.
    pub threads: Vec<ReferencedThread>,
    /// Last visible root; no private thread identifiers are exposed through cursors.
    pub next_cursor: Option<MessageCursor>,
}

/// Repository fact used to authorize a source before loading its messages.
#[derive(Debug, Clone)]
pub struct ReferencedThreadCandidate {
    /// Channel that owns the source discussion.
    pub channel_id: Uuid,
    /// Canonical thread root.
    pub root_id: Uuid,
    /// Source display name.
    pub channel_name: Option<String>,
    /// Root's stable ordering timestamp.
    pub created_at: DateTime<Utc>,
}

/// Authenticated create command; attribution fields are never client controlled.
#[derive(Debug, Clone)]
pub struct CreateMessage {
    /// Parent with verified actor access.
    pub parent: MessageParent,
    /// Verified actor.
    pub actor: ChannelSender<'static>,
    /// User who triggered a bot message, if applicable.
    pub triggered_by: Option<String>,
    /// Parsed message input.
    pub input: PostMessage,
}

/// Normalized content and reference update passed to persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EditMessage {
    /// A bot may publish its final answer by editing a silent placeholder.
    #[serde(skip)]
    #[cfg_attr(feature = "schema", schema(ignore))]
    pub notification_policy: PatchMessageNotificationPolicy,
    /// Replacement body.
    pub content: String,
    /// Complete replacement mention set.
    #[serde(default)]
    pub mentions: Vec<SimpleMention>,
    /// Replacement attachments; absent leaves attachments unchanged.
    pub attachments: Option<Vec<NewAttachment>>,
    /// Client mutation nonce.
    pub nonce: Option<String>,
}

/// Attachment changes interpreted by the common command boundary.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum AttachmentChange {
    /// Keep current attachments.
    #[default]
    Preserve,
    /// Replace all attachments.
    Replace(Vec<NewAttachment>),
    /// Remove stored attachment identities and append new references.
    Delta {
        /// Existing attachment UUIDs to remove.
        remove: Vec<Uuid>,
        /// New attachments to append.
        add: Vec<NewAttachment>,
    },
}

/// Partial updates share the same authorship, reference, and delivery rules as edits.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessagePatch {
    /// Replacement body; absent preserves current content.
    pub content: Option<String>,
    /// Replacement authored mentions; absent preserves current mentions.
    pub mentions: Option<Vec<SimpleMention>>,
    /// Attachment change, without adapter-side message reads.
    #[serde(default)]
    pub attachments: AttachmentChange,
    /// Client mutation nonce.
    pub nonce: Option<String>,
    /// Trusted notification behavior.
    #[serde(skip)]
    #[cfg_attr(feature = "schema", schema(ignore))]
    pub notification_policy: PatchMessageNotificationPolicy,
}
/// A committed message or thread change sent to delivery adapters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageEvent {
    /// Changed parent, used for subscriptions and cache invalidation.
    pub parent: MessageParent,
    /// User or bot who initiated the operation.
    pub actor: String,
    /// Mutation nonce for optimistic reconciliation.
    pub nonce: Option<String>,
    /// Persisted change.
    pub change: MessageChange,
}

/// Kind of message change; notification policy only runs for posted messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum MessageChange {
    /// A message was posted.
    Posted {
        /// Trusted notification policy carried with the committed change.
        notification_policy: PostMessageNotificationPolicy,
        /// Persisted message.
        message: Message,
        /// Mentions included in this post.
        mentions: Vec<SimpleMention>,
    },
    /// Message content and references were edited.
    Edited {
        /// Trusted notification policy for the edited content.
        notification_policy: PatchMessageNotificationPolicy,
        /// Persisted replacement message.
        message: Message,
        /// Complete replacement mention set.
        mentions: Vec<SimpleMention>,
        /// Attachment identities before the edit, for channel change delivery.
        previous_attachments: Vec<MessageAttachment>,
    },
    /// One message was tombstoned; its thread may remain live.
    MessageDeleted {
        /// Persisted tombstone.
        message: Message,
    },
    /// The authenticated actor added or removed a reaction.
    ReactionChanged {
        /// Persisted message.
        message: Message,
    },
    /// Thread resolution, placement, or deletion changed.
    ThreadUpdated {
        /// Persisted thread state.
        state: ThreadState,
    },
    /// Transient typing indication.
    Typing {
        /// Root being replied to, or no root for the parent composer.
        thread_id: Option<Uuid>,
        /// Whether the user is currently typing.
        active: bool,
    },
}

/// Persistence boundary. Implementations enforce parent/thread integrity atomically.
pub trait MessageRepository: Send + Sync + 'static {
    /// Discover source identities without treating a mention as a grant of access.
    fn referenced_threads(
        &self,
        document_id: &str,
        cursor: Option<MessageCursor>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<ReferencedThreadCandidate>, MessageError>> + Send;
    /// Whether the parent still exists and permits messaging lifecycle-wise.
    fn parent_exists(
        &self,
        parent: &MessageParent,
    ) -> impl Future<Output = Result<bool, MessageError>> + Send;
    /// Read a message belonging to the specified parent, including root tombstones.
    fn get(
        &self,
        parent: &MessageParent,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Message>, MessageError>> + Send;
    /// Read thread state; returns deleted state so callers can reject writes.
    fn thread(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> impl Future<Output = Result<Option<ThreadState>, MessageError>> + Send;
    /// Ordered live replies for a root within its parent.
    fn replies(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Message>, MessageError>> + Send;
    /// Live messages before a prompt, in chronological order. Document context
    /// stays within the prompt's thread; channel context includes the timeline.
    fn preceding(
        &self,
        parent: &MessageParent,
        message_id: Uuid,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<Message>, MessageError>> + Send;
    /// Read a bounded root page with reply previews under indexable parent predicates.
    fn timeline(
        &self,
        parent: &MessageParent,
        query: MessageTimelineQuery,
    ) -> impl Future<Output = Result<MessagePage, MessageError>> + Send;

    /// Atomically create a message, its initial references, and any new thread state.
    fn create(
        &self,
        command: CreateMessage,
    ) -> impl Future<Output = Result<Message, MessageError>> + Send;
    /// Replace content and references atomically.
    fn edit(
        &self,
        parent: &MessageParent,
        id: Uuid,
        command: EditMessage,
    ) -> impl Future<Output = Result<Message, MessageError>> + Send;
    /// Tombstone a single message, preserving its replies and anchor.
    fn delete(
        &self,
        parent: &MessageParent,
        id: Uuid,
    ) -> impl Future<Output = Result<Message, MessageError>> + Send;
    /// Add or remove the caller's reaction and return the current message.
    fn react(
        &self,
        parent: &MessageParent,
        id: Uuid,
        user_id: &str,
        emoji: &str,
        add: bool,
    ) -> impl Future<Output = Result<Message, MessageError>> + Send;
    /// Apply authorized thread resolution or Markdown anchor detachment.
    fn patch_thread(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
        patch: ThreadPatch,
    ) -> impl Future<Output = Result<ThreadState, MessageError>> + Send;
    /// Delete a discussion and clean up comment-only anchors, preserving standalone highlights.
    fn delete_thread(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> impl Future<Output = Result<ThreadState, MessageError>> + Send;
    /// Resolve an immutable old comment or thread id within its authorized parent.
    fn resolve_legacy(
        &self,
        parent: &MessageParent,
        id: i64,
        is_thread: bool,
    ) -> impl Future<Output = Result<Option<Uuid>, MessageError>> + Send;
}

/// Publish committed changes, deriving delivery policy from the persisted parent.
pub trait MessageEventPublisher: Send + Sync + 'static {
    /// Deliver a change through realtime and contextual notification adapters.
    fn publish(
        &self,
        event: MessageEvent,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// Resolves access to referenced entities before a message transaction begins.
/// Implementations must never grant access as a side effect of this check.
pub trait MessageReferenceAccess: Send + Sync + 'static {
    /// Whether this principal currently has write access to a referenced conversation.
    fn can_write<'a>(
        &'a self,
        _auth: &'a entity_access::domain::models::EntityAccessAuth,
        _entity_type: entity_access::domain::models::EntityType,
        _entity_id: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<bool, MessageError>> + Send + 'a>> {
        Box::pin(async { Ok(false) })
    }
    /// Whether this principal can view the referenced entity now.
    fn can_view<'a>(
        &'a self,
        auth: &'a entity_access::domain::models::EntityAccessAuth,
        entity_type: entity_access::domain::models::EntityType,
        entity_id: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<bool, MessageError>> + Send + 'a>>;
}

/// Safe default for compositions that do not provide an entity access adapter.
pub struct DenyMessageReferences;
impl MessageReferenceAccess for DenyMessageReferences {
    fn can_view<'a>(
        &'a self,
        _: &'a entity_access::domain::models::EntityAccessAuth,
        _: entity_access::domain::models::EntityType,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<bool, MessageError>> + Send + 'a>> {
        Box::pin(async { Ok(false) })
    }
}

/// Parses the tracked references in raw bot-authored Markdown.
pub trait MessageMentionExtractor: Send + Sync + 'static {
    /// Extract canonical entity and user/bot mentions from a message body.
    fn extract<'a>(
        &'a self,
        content: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Vec<SimpleMention>, MessageError>> + Send + 'a>>;
}
/// Message compositions that do not create raw bot Markdown.
pub struct NoMessageMentionExtractor;
impl MessageMentionExtractor for NoMessageMentionExtractor {
    fn extract<'a>(
        &'a self,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Vec<SimpleMention>, MessageError>> + Send + 'a>>
    {
        Box::pin(async { Ok(vec![]) })
    }
}

/// Delivery disabled explicitly for tests and isolated callers.
#[derive(Clone, Copy)]
pub struct NoMessageEventPublisher;
impl MessageEventPublisher for NoMessageEventPublisher {
    async fn publish(&self, _event: MessageEvent) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

/// Current human membership used to resolve authored channel group mentions.
#[async_trait::async_trait]
pub trait MessageGroupRecipients: Send + Sync + 'static {
    /// Read active human members; callers have already verified the posting capability.
    async fn channel_members(
        &self,
        channel: Uuid,
    ) -> Result<Vec<macro_user_id::user_id::MacroUserIdStr<'static>>, MessageError>;
}
/// Reject group mentions in contexts that do not supply channel membership.
pub struct NoMessageGroups;
#[async_trait::async_trait]
impl MessageGroupRecipients for NoMessageGroups {
    async fn channel_members(
        &self,
        _: Uuid,
    ) -> Result<Vec<macro_user_id::user_id::MacroUserIdStr<'static>>, MessageError> {
        Err(MessageError::Invalid(
            "channel group mentions are unavailable",
        ))
    }
}
