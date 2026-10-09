//! Work feed domain models.

use std::{str::FromStr, sync::Arc};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::NotifEvent;
use notification::domain::models::UserNotificationRow;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A notification row as the work feed reads it.
pub type FeedNotification = Arc<UserNotificationRow<NotifEvent>>;

/// The caller a work feed request is evaluated for.
#[derive(Debug, Clone)]
pub struct WorkFeedViewer {
    /// The authenticated user.
    pub user: MacroUserIdStr<'static>,
    /// The user's team membership, when they have one; foreign entities
    /// stored for the team are visible through it.
    pub team: Option<EntityAccessReceipt<MemberTeamRole>>,
}

/// Which reasons admit an item to the feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkFeedMode {
    /// Outstanding attention plus the viewer's recent own work: desktop Home.
    Work,
    /// Outstanding attention only: the notifications list.
    Attention,
}

/// The kinds of item a caller can narrow the feed to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkFeedItemType {
    /// Documents and tasks.
    Document,
    /// AI chats.
    Chat,
    /// Projects (folders).
    Project,
    /// Email threads.
    Email,
    /// Channel activity outside a dedicated thread item.
    Channel,
    /// One channel thread.
    ChannelThread,
    /// Calendar reminders.
    CalendarEvent,
    /// GitHub pull requests.
    PullRequest,
    /// Agent sessions.
    AgentSession,
}

impl WorkFeedItemType {
    /// Every item type, the default selection.
    pub const ALL: [WorkFeedItemType; 9] = [
        Self::Document,
        Self::Chat,
        Self::Project,
        Self::Email,
        Self::Channel,
        Self::ChannelThread,
        Self::CalendarEvent,
        Self::PullRequest,
        Self::AgentSession,
    ];

    /// The candidate entity type items of this kind are keyed on.
    pub fn entity_type(self) -> EntityType {
        match self {
            Self::Document => EntityType::Document,
            Self::Chat => EntityType::Chat,
            Self::Project => EntityType::Project,
            Self::Email => EntityType::EmailThread,
            Self::Channel => EntityType::Channel,
            Self::ChannelThread => EntityType::ChannelMessage,
            Self::CalendarEvent => EntityType::CalendarEvent,
            Self::PullRequest => EntityType::ForeignEntity,
            Self::AgentSession => EntityType::AgentSession,
        }
    }
}

/// Stable per-viewer identity of a work feed item: the entity its candidate
/// is keyed on. A channel thread is keyed on its root message, so it stays
/// one item as replies arrive and whether or not its channel is also listed.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkFeedItemKey(Entity<'static>);

/// A work feed item id that does not name an item.
#[derive(Debug, thiserror::Error)]
#[error("invalid work feed item id")]
pub struct InvalidWorkFeedItemId;

impl WorkFeedItemKey {
    /// The item keyed on `entity`.
    pub fn new(entity: Entity<'static>) -> Self {
        Self(entity)
    }

    /// The entity the item is keyed on.
    pub fn entity(&self) -> &Entity<'static> {
        &self.0
    }

    /// Consume the key, returning its entity.
    pub fn into_entity(self) -> Entity<'static> {
        self.0
    }

    /// The item's global id: `<entity type>:<entity id>`.
    pub fn id(&self) -> String {
        format!("{}:{}", self.0.entity_type, self.0.entity_id)
    }

    /// Parse an id produced by [`Self::id`].
    pub fn parse(id: &str) -> Result<Self, InvalidWorkFeedItemId> {
        let (entity_type, entity_id) = id.split_once(':').ok_or(InvalidWorkFeedItemId)?;
        if entity_id.is_empty() {
            return Err(InvalidWorkFeedItemId);
        }
        let entity_type = EntityType::from_str(entity_type).map_err(|_| InvalidWorkFeedItemId)?;
        Ok(Self(entity_type.with_entity_string(entity_id.to_string())))
    }
}

/// An item's state for its viewer, aggregated over its active reasons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkFeedItemState {
    /// At least one active reason is unseen.
    Unseen,
    /// Every active reason has been seen.
    Seen,
    /// Every notification the viewer observed was completed.
    Done,
}

/// How one stack groups its notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkFeedStackKind {
    /// Replies, thread mentions and the absorbed root of one channel thread.
    ChannelThread,
    /// One root mention in a channel whose thread has no replies yet.
    ChannelMention,
    /// New root messages in a channel.
    ChannelMessages,
    /// Reactions to the viewer's channel messages.
    ChannelReactions,
    /// Several comments, replies or mentions in one document comment thread.
    CommentThread,
    /// A standalone mention in a document comment.
    CommentMention,
    /// Standalone root comments on a document.
    Comments,
    /// Mentions of a document in channels.
    DocumentMentions,
    /// One discussion thread on a project, company or contact.
    Discussion,
    /// Any other single event.
    Event,
}

/// Notifications grouped the way they are presented: newest first, with the
/// newest notification naming the stack.
#[derive(Debug, Clone)]
pub struct WorkFeedStack {
    /// How the stack groups its notifications.
    pub kind: WorkFeedStackKind,
    /// The conversation thread the stack belongs to, when it is one.
    pub thread_id: Option<String>,
    /// The stack's notifications, newest first.
    pub notifications: Vec<FeedNotification>,
}

impl WorkFeedStack {
    /// The newest notification in the stack.
    pub fn latest(&self) -> &FeedNotification {
        &self.notifications[0]
    }

    /// Whether any notification in the stack is unseen.
    pub fn is_unseen(&self) -> bool {
        self.notifications
            .iter()
            .any(|notification| counts_as_unseen(notification))
    }
}

/// Whether a notification makes its item unseen. Channel events other than
/// messages, mentions and reactions (invites, calls) never do.
pub fn counts_as_unseen(notification: &UserNotificationRow<NotifEvent>) -> bool {
    use notification::domain::models::NotificationState;
    if notification.state != NotificationState::Unseen {
        return false;
    }
    if notification.entity.entity_type != EntityType::Channel {
        return true;
    }
    matches!(
        notification.notification_metadata,
        NotifEvent::ChannelMention(_)
            | NotifEvent::ChannelMessageSend(_)
            | NotifEvent::ChannelMessageReaction(_)
            | NotifEvent::ChannelMessageReply(_)
            | NotifEvent::DocumentMention(_)
    )
}

/// Why an item is presented the way it is, chosen with its click target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkFeedPrimaryReason {
    /// The viewer's own work is the newest reason: open the entity.
    OwnWork,
    /// Incoming attention is the newest reason: present and open the stack
    /// at this index of the item's stacks.
    Attention {
        /// Index into the item's stacks.
        stack: usize,
    },
}

/// The attention a viewer observed on an item. Done acknowledges only what
/// was observed, so a notification arriving later keeps the item active.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct WorkFeedRevision {
    /// The newest active notification observed.
    #[serde(rename = "a", default, skip_serializing_if = "Option::is_none")]
    pub attention_through: Option<DateTime<Utc>>,
}

/// A revision token that does not decode.
#[derive(Debug, thiserror::Error)]
#[error("invalid work feed revision")]
pub struct InvalidWorkFeedRevision;

impl WorkFeedRevision {
    /// The opaque token clients echo back.
    pub fn encode(&self) -> String {
        encode_token(self)
    }

    /// Decode a token produced by [`Self::encode`].
    pub fn decode(token: &str) -> Result<Self, InvalidWorkFeedRevision> {
        decode_token(token).ok_or(InvalidWorkFeedRevision)
    }
}

/// One item of the feed for its viewer.
#[derive(Debug, Clone)]
pub struct WorkFeedItem<E> {
    /// The item's identity.
    pub key: WorkFeedItemKey,
    /// The hydrated entity the item is about.
    pub entity: E,
    /// The item's aggregate state.
    pub state: WorkFeedItemState,
    /// The newest active notification in the item's scope.
    pub attention_at: Option<DateTime<Utc>>,
    /// The viewer's newest own work on the item.
    pub touched_at: Option<DateTime<Utc>>,
    /// Every active notification in the item's scope, newest first —
    /// including those a stack shadows, which done also acknowledges.
    pub notifications: Vec<FeedNotification>,
    /// The item's notifications grouped for presentation, newest first.
    pub stacks: Vec<WorkFeedStack>,
    /// The reason the item is presented by and opens to.
    pub primary: WorkFeedPrimaryReason,
}

impl<E> WorkFeedItem<E> {
    /// The attention this item currently carries.
    pub fn revision(&self) -> WorkFeedRevision {
        WorkFeedRevision {
            attention_through: self.attention_at,
        }
    }
}

/// An item placed in one feed.
#[derive(Debug, Clone)]
pub struct WorkFeedEntry<E> {
    /// The item.
    pub item: WorkFeedItem<E>,
    /// Where the item sits: the later of its attention and own-work times.
    pub sort_at: DateTime<Utc>,
}

/// Where the next page of a feed starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkFeedPosition {
    /// The last walked candidate's sort time.
    #[serde(rename = "s")]
    pub sort_at: DateTime<Utc>,
    /// The last walked candidate's entity id.
    #[serde(rename = "i")]
    pub entity_id: String,
}

/// A cursor that does not decode.
#[derive(Debug, thiserror::Error)]
#[error("invalid work feed cursor")]
pub struct InvalidWorkFeedCursor;

impl WorkFeedPosition {
    /// The opaque cursor clients send back for the next page.
    pub fn encode(&self) -> String {
        encode_token(self)
    }

    /// Decode a cursor produced by [`Self::encode`].
    pub fn decode(cursor: &str) -> Result<Self, InvalidWorkFeedCursor> {
        decode_token(cursor).ok_or(InvalidWorkFeedCursor)
    }
}

/// Which items one feed shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkFeedScope {
    /// Which reasons admit items.
    pub mode: WorkFeedMode,
    /// The item kinds to include; empty means every kind.
    pub types: Vec<WorkFeedItemType>,
    /// Whether snippet documents are included.
    pub include_snippets: bool,
}

impl WorkFeedScope {
    /// Every item with any reason, regardless of the caller's filters: the
    /// scope done and undo evaluate an item in.
    pub fn everything() -> Self {
        Self {
            mode: WorkFeedMode::Work,
            types: Vec::new(),
            include_snippets: true,
        }
    }
}

/// A request for one page of the feed.
#[derive(Debug, Clone)]
pub struct WorkFeedQuery {
    /// Which items the feed shows.
    pub scope: WorkFeedScope,
    /// Maximum items on the page.
    pub limit: u16,
    /// Resume after this position; `None` for the first page.
    pub after: Option<WorkFeedPosition>,
}

/// One page of the feed, newest first.
#[derive(Debug)]
pub struct WorkFeedPage<E> {
    /// The page's entries.
    pub entries: Vec<WorkFeedEntry<E>>,
    /// Where the next page starts; `None` once the feed is exhausted.
    pub next: Option<WorkFeedPosition>,
}

/// How a known item changed for one feed.
#[derive(Debug)]
pub enum WorkFeedChange<E> {
    /// The item belongs in the feed with this content and placement.
    Upserted(WorkFeedEntry<E>),
    /// The item no longer belongs in the feed. The entity itself may still
    /// exist: done, filtered out and inaccessible items all leave this way.
    Removed(WorkFeedItemKey),
}

/// An item the caller asked to mark done, with the reasons they observed.
#[derive(Debug, Clone)]
pub struct WorkFeedDoneTarget {
    /// The item.
    pub key: WorkFeedItemKey,
    /// What the caller observed; `None` acknowledges everything current.
    pub revision: Option<WorkFeedRevision>,
}

/// Everything one mark-done operation changed, so undo can reverse exactly
/// those effects and nothing that happened since.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkFeedDoneReceipt {
    /// The items the operation completed.
    #[serde(rename = "k")]
    pub items: Vec<String>,
    /// Notifications this operation moved to done.
    #[serde(rename = "n", default)]
    pub notification_ids: Vec<Uuid>,
    /// Email threads this operation archived.
    #[serde(rename = "e", default)]
    pub archived_threads: Vec<Uuid>,
}

/// An undo token that does not decode.
#[derive(Debug, thiserror::Error)]
#[error("invalid work feed undo token")]
pub struct InvalidWorkFeedUndoToken;

impl WorkFeedDoneReceipt {
    /// The opaque undo token returned to the caller.
    pub fn encode(&self) -> String {
        encode_token(self)
    }

    /// Decode a token produced by [`Self::encode`].
    pub fn decode(token: &str) -> Result<Self, InvalidWorkFeedUndoToken> {
        decode_token(token).ok_or(InvalidWorkFeedUndoToken)
    }

    /// The keys of the items this receipt completed.
    pub fn item_keys(&self) -> Vec<WorkFeedItemKey> {
        self.items
            .iter()
            .filter_map(|id| WorkFeedItemKey::parse(id).ok())
            .collect()
    }
}

/// The outcome of marking items done.
#[derive(Debug)]
pub struct WorkFeedDoneOutcome {
    /// The items now done; requested items that were already gone are
    /// reported done as well, so callers can drop them.
    pub items: Vec<WorkFeedItemKey>,
    /// What the operation changed, for undo.
    pub receipt: WorkFeedDoneReceipt,
}

/// A change that may affect one viewer's items, from any realtime source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkFeedTrigger {
    /// These candidate keys may have changed.
    Changed(Vec<Entity<'static>>),
    /// Changes may have been missed; mounted feeds must refetch.
    Invalidated,
}

/// Errors returned by the work feed service.
#[derive(Debug, thiserror::Error)]
pub enum WorkFeedError {
    /// The caller sent an invalid cursor, revision, item id or undo token.
    #[error("{0}")]
    InvalidInput(&'static str),
    /// A dependency failed.
    #[error("the work feed is unavailable: {0}")]
    Unavailable(rootcause::Report),
}

impl From<rootcause::Report> for WorkFeedError {
    fn from(report: rootcause::Report) -> Self {
        Self::Unavailable(report)
    }
}

impl From<InvalidWorkFeedCursor> for WorkFeedError {
    fn from(_: InvalidWorkFeedCursor) -> Self {
        Self::InvalidInput("invalid work feed cursor")
    }
}

impl From<InvalidWorkFeedRevision> for WorkFeedError {
    fn from(_: InvalidWorkFeedRevision) -> Self {
        Self::InvalidInput("invalid work feed revision")
    }
}

impl From<InvalidWorkFeedItemId> for WorkFeedError {
    fn from(_: InvalidWorkFeedItemId) -> Self {
        Self::InvalidInput("invalid work feed item id")
    }
}

impl From<InvalidWorkFeedUndoToken> for WorkFeedError {
    fn from(_: InvalidWorkFeedUndoToken) -> Self {
        Self::InvalidInput("invalid work feed undo token")
    }
}

fn encode_token<T: Serialize>(value: &T) -> String {
    let json = serde_json::to_vec(value).expect("work feed tokens serialize");
    URL_SAFE_NO_PAD.encode(json)
}

fn decode_token<T: for<'de> Deserialize<'de>>(token: &str) -> Option<T> {
    let json = URL_SAFE_NO_PAD.decode(token).ok()?;
    serde_json::from_slice(&json).ok()
}
