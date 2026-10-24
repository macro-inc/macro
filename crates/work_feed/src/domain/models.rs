//! Work feed domain models: Home's items, stacks and scopes. Keys, tokens,
//! viewers and errors are the shared feed layer's (`attention_feed`).

use attention_feed::domain::models::{
    DoneReceipt, FeedKey, FeedNotification, FeedPosition, FeedRevision, counts_as_unseen,
};
use chrono::{DateTime, Utc};
use model_entity::EntityType;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Which reasons admit an item to the feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkFeedMode {
    /// Outstanding attention plus the viewer's recent own work: desktop Home.
    Work,
    /// Outstanding attention only: the notifications list.
    Attention,
}

impl WorkFeedMode {
    /// Whether the viewer's own work admits items.
    pub fn own_work(self) -> bool {
        self == Self::Work
    }
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

/// One item of the feed for its viewer. A channel thread is keyed on its
/// root message, so it stays one item as replies arrive and whether or not
/// its channel is also listed.
#[derive(Debug, Clone)]
pub struct WorkFeedItem<E> {
    /// The item's identity.
    pub key: FeedKey,
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
    pub fn revision(&self) -> FeedRevision {
        FeedRevision {
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
    pub after: Option<FeedPosition>,
}

/// One page of the feed, newest first.
#[derive(Debug)]
pub struct WorkFeedPage<E> {
    /// The page's entries.
    pub entries: Vec<WorkFeedEntry<E>>,
    /// Where the next page starts; `None` once the feed is exhausted.
    pub next: Option<FeedPosition>,
}

/// How a known item changed for one feed.
#[derive(Debug)]
pub enum WorkFeedChange<E> {
    /// The item belongs in the feed with this content and placement.
    Upserted(WorkFeedEntry<E>),
    /// The item no longer belongs in the feed. The entity itself may still
    /// exist: done, filtered out and inaccessible items all leave this way.
    Removed(FeedKey),
}

/// An item the caller asked to mark done, with the reasons they observed.
#[derive(Debug, Clone)]
pub struct WorkFeedDoneTarget {
    /// The item.
    pub key: FeedKey,
    /// What the caller observed; `None` acknowledges everything current.
    pub revision: Option<FeedRevision>,
}

/// The outcome of marking items done.
#[derive(Debug)]
pub struct WorkFeedDoneOutcome {
    /// The items now done; requested items that were already gone are
    /// reported done as well, so callers can drop them.
    pub items: Vec<FeedKey>,
    /// What the operation changed, for undo.
    pub receipt: DoneReceipt,
}
