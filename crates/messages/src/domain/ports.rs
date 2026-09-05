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

/// Page of threads on a parent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ThreadPage {
    /// Root messages and their discussions.
    pub threads: Vec<MessageThread>,
    /// Cursor for the next page.
    pub next_cursor: Option<MessageCursor>,
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

/// Message updates accepted by the shared API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EditMessage {
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

/// A committed message or thread change sent to delivery adapters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageEvent {
    /// Changed parent, used for subscriptions and cache invalidation.
    pub parent: MessageParent,
    /// Root message UUID.
    pub root_id: Uuid,
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
        /// Persisted message.
        message: Message,
        /// Mentions included in this post.
        mentions: Vec<SimpleMention>,
    },
    /// Message content and references were edited.
    Edited {
        /// Persisted replacement message.
        message: Message,
        /// Complete replacement mention set.
        mentions: Vec<SimpleMention>,
        /// Attachment identities before the edit, for channel change delivery.
        previous_attachments: Vec<MessageAttachment>,
    },
    /// Message content, attachments, reactions, or tombstone changed.
    Updated {
        /// Persisted message.
        message: Message,
    },
    /// Thread resolution or deletion changed.
    ThreadUpdated {
        /// Persisted thread state.
        state: ThreadState,
    },
    /// Transient typing indication.
    Typing {
        /// Whether the user is currently typing.
        active: bool,
    },
}

/// Persistence boundary. Implementations enforce parent/thread integrity atomically.
pub trait MessageRepository: Send + Sync + 'static {
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
    /// List roots and ordered replies. Explicitly deleted threads are excluded.
    fn list(
        &self,
        parent: &MessageParent,
        cursor: Option<MessageCursor>,
        limit: u16,
    ) -> impl Future<Output = Result<ThreadPage, MessageError>> + Send;
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
    /// Set thread resolution.
    fn resolve(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
        resolved: bool,
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
