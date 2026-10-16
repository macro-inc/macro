use async_graphql::{Enum, ID, Object, SimpleObject, Union};
use graphql_notification::GraphqlNotification;
use graphql_soup::{GraphqlSoupEntity, SoupEntityEdges};
use soup::domain::models::SoupProjectionHydration;
use work_feed::domain::models::{
    WorkFeedChange, WorkFeedEntry, WorkFeedItemState, WorkFeedPage, WorkFeedPrimaryReason,
    WorkFeedStack, WorkFeedStackKind, counts_as_unseen,
};

/// Most notifications one stack returns when no limit is given.
const DEFAULT_STACK_NOTIFICATION_LIMIT: i32 = 20;
/// Most notifications one stack may return.
const MAX_STACK_NOTIFICATION_LIMIT: i32 = 100;

/// An item's state for its viewer.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "WorkFeedItemState")]
pub enum GraphqlWorkFeedItemState {
    /// At least one active reason is unseen.
    Unseen,
    /// Every active reason has been seen.
    Seen,
    /// Every notification the viewer observed was completed.
    Done,
}

impl From<WorkFeedItemState> for GraphqlWorkFeedItemState {
    fn from(value: WorkFeedItemState) -> Self {
        match value {
            WorkFeedItemState::Unseen => Self::Unseen,
            WorkFeedItemState::Seen => Self::Seen,
            WorkFeedItemState::Done => Self::Done,
        }
    }
}

/// How one stack groups its notifications.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "WorkFeedStackKind")]
pub enum GraphqlWorkFeedStackKind {
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

impl From<WorkFeedStackKind> for GraphqlWorkFeedStackKind {
    fn from(value: WorkFeedStackKind) -> Self {
        match value {
            WorkFeedStackKind::ChannelThread => Self::ChannelThread,
            WorkFeedStackKind::ChannelMention => Self::ChannelMention,
            WorkFeedStackKind::ChannelMessages => Self::ChannelMessages,
            WorkFeedStackKind::ChannelReactions => Self::ChannelReactions,
            WorkFeedStackKind::CommentThread => Self::CommentThread,
            WorkFeedStackKind::CommentMention => Self::CommentMention,
            WorkFeedStackKind::Comments => Self::Comments,
            WorkFeedStackKind::DocumentMentions => Self::DocumentMentions,
            WorkFeedStackKind::Discussion => Self::Discussion,
            WorkFeedStackKind::Event => Self::Event,
        }
    }
}

/// Why an entry is presented the way it is in its feed.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "WorkFeedPrimaryReason")]
pub enum GraphqlWorkFeedPrimaryReason {
    /// The viewer's own work is the newest reason: open the entity.
    OwnWork,
    /// Incoming attention is the newest reason: present and open the
    /// primary stack.
    Attention,
}

/// Notifications grouped the way they are presented.
pub struct GraphqlWorkFeedStack(WorkFeedStack);

/// Notifications grouped the way they are presented, newest first. The
/// newest notification names the stack and is its navigation target.
#[Object(name = "WorkFeedStack")]
impl GraphqlWorkFeedStack {
    /// How the stack groups its notifications.
    async fn kind(&self) -> GraphqlWorkFeedStackKind {
        self.0.kind.into()
    }

    /// The conversation thread the stack belongs to, when it is one: a
    /// channel thread root, document comment thread or discussion thread.
    async fn thread_id(&self) -> Option<&str> {
        self.0.thread_id.as_deref()
    }

    /// When the stack's newest notification was created, in RFC 3339.
    async fn latest_at(&self) -> String {
        self.0.latest().created_at.to_rfc3339()
    }

    /// Whether any notification in the stack is unseen.
    async fn unseen(&self) -> bool {
        self.0.is_unseen()
    }

    /// How many notifications the stack holds.
    async fn count(&self) -> i32 {
        i32::try_from(self.0.notifications.len()).unwrap_or(i32::MAX)
    }

    /// The stack's notifications, newest first. Defaults to 20, capped at
    /// 100; `count` is the full size.
    async fn notifications(
        &self,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlNotification>> {
        let limit = graphql_common::parse_limit(
            limit,
            DEFAULT_STACK_NOTIFICATION_LIMIT,
            MAX_STACK_NOTIFICATION_LIMIT,
        )?;
        Ok(self
            .0
            .notifications
            .iter()
            .take(limit as usize)
            .cloned()
            .map(GraphqlNotification::from)
            .collect())
    }
}

/// One context the viewer can return to or acknowledge. The same item is
/// shared by every feed it appears in; per-feed placement lives on its entry.
pub struct GraphqlWorkFeedItem<E: SoupEntityEdges> {
    /// The item's global id.
    id: String,
    /// The entity the item is about.
    entity: GraphqlSoupEntity<E>,
    /// The item's aggregate state.
    state: WorkFeedItemState,
    /// The newest active notification in the item's scope.
    attention_at: Option<String>,
    /// How many of the item's active notifications are unseen.
    unseen_count: usize,
    /// The item's notifications grouped for presentation.
    stacks: Vec<GraphqlWorkFeedStack>,
}

/// One context the viewer can return to or acknowledge: an entity, a
/// channel thread, or a channel's activity outside its threads. Items are
/// shared across feeds; placement and primary reason live on each entry.
#[Object(name = "WorkFeedItem")]
impl<E: SoupEntityEdges> GraphqlWorkFeedItem<E> {
    /// Stable per-viewer item id: `<entity type>:<entity id>`.
    async fn id(&self) -> ID {
        ID(self.id.clone())
    }

    /// The entity the item is about; a channel thread's entity is its root
    /// message.
    async fn entity(&self) -> &GraphqlSoupEntity<E> {
        &self.entity
    }

    /// The item's state for the viewer.
    async fn state(&self) -> GraphqlWorkFeedItemState {
        self.state.into()
    }

    /// When the newest active notification in the item's scope was created,
    /// in RFC 3339; absent when the item has no outstanding attention.
    async fn attention_at(&self) -> Option<&str> {
        self.attention_at.as_deref()
    }

    /// How many of the item's active notifications are unseen.
    async fn unseen_count(&self) -> i32 {
        i32::try_from(self.unseen_count).unwrap_or(i32::MAX)
    }

    /// The item's active notifications grouped for presentation, newest
    /// stack first.
    async fn stacks(&self) -> &[GraphqlWorkFeedStack] {
        &self.stacks
    }
}

/// An item placed in one feed.
pub struct GraphqlWorkFeedEntry<E: SoupEntityEdges> {
    /// The item.
    item: GraphqlWorkFeedItem<E>,
    /// The entry's sort time.
    sort_at: String,
    /// The own work counted by this feed.
    touched_at: Option<String>,
    /// What done acknowledges for this entry.
    revision: String,
    /// The entry's primary reason.
    primary: WorkFeedPrimaryReason,
}

/// An item placed in one feed: where it sits, why, and what marking it done
/// acknowledges.
#[Object(name = "WorkFeedEntry")]
impl<E: SoupEntityEdges> GraphqlWorkFeedEntry<E> {
    /// The item.
    async fn item(&self) -> &GraphqlWorkFeedItem<E> {
        &self.item
    }

    /// Where the entry sits, in RFC 3339: the later of the item's attention
    /// and own-work times in this feed.
    async fn sort_at(&self) -> &str {
        &self.sort_at
    }

    /// The viewer's newest own work counted by this feed, in RFC 3339;
    /// always absent in attention mode.
    async fn touched_at(&self) -> Option<&str> {
        self.touched_at.as_deref()
    }

    /// Opaque token of the attention this entry shows; send it with done so
    /// notifications that arrive later stay active.
    async fn revision(&self) -> &str {
        &self.revision
    }

    /// Why the entry is presented the way it is.
    async fn primary_reason(&self) -> GraphqlWorkFeedPrimaryReason {
        match self.primary {
            WorkFeedPrimaryReason::OwnWork => GraphqlWorkFeedPrimaryReason::OwnWork,
            WorkFeedPrimaryReason::Attention { .. } => GraphqlWorkFeedPrimaryReason::Attention,
        }
    }

    /// Index into the item's stacks of the stack the entry presents and
    /// opens, when its primary reason is attention.
    async fn primary_stack_index(&self) -> Option<i32> {
        match self.primary {
            WorkFeedPrimaryReason::OwnWork => None,
            WorkFeedPrimaryReason::Attention { stack } => i32::try_from(stack).ok(),
        }
    }
}

impl<E: SoupEntityEdges> GraphqlWorkFeedEntry<E> {
    /// Build the GraphQL entry for a domain entry.
    pub fn new(entry: WorkFeedEntry<SoupProjectionHydration>) -> Self {
        let item = entry.item;
        let revision = item.revision().encode();
        let unseen_count = item
            .notifications
            .iter()
            .filter(|notification| counts_as_unseen(notification))
            .count();
        Self {
            sort_at: entry.sort_at.to_rfc3339(),
            touched_at: item.touched_at.map(|touched| touched.to_rfc3339()),
            revision,
            primary: item.primary,
            item: GraphqlWorkFeedItem {
                id: item.key.id(),
                entity: GraphqlSoupEntity::new_with_projection(item.entity),
                state: item.state,
                attention_at: item.attention_at.map(|attention| attention.to_rfc3339()),
                unseen_count,
                stacks: item.stacks.into_iter().map(GraphqlWorkFeedStack).collect(),
            },
        }
    }
}

/// One page of the viewer's work feed, newest first.
#[derive(SimpleObject)]
#[graphql(name = "WorkFeedPage")]
pub struct GraphqlWorkFeedPage<E: SoupEntityEdges> {
    /// The page's entries.
    entries: Vec<GraphqlWorkFeedEntry<E>>,
    /// Cursor for the next page; absent once the feed is exhausted.
    next_cursor: Option<String>,
}

impl<E: SoupEntityEdges> GraphqlWorkFeedPage<E> {
    /// Build the GraphQL page for a domain page.
    pub fn new(page: WorkFeedPage<SoupProjectionHydration>) -> Self {
        Self {
            entries: page
                .entries
                .into_iter()
                .map(GraphqlWorkFeedEntry::new)
                .collect(),
            next_cursor: page.next.map(|next| next.encode()),
        }
    }
}

/// An item that belongs in the subscribed feed, with its current content and
/// placement. Insert it, or move it to its new `sortAt`.
#[derive(SimpleObject)]
#[graphql(name = "WorkFeedEntryUpserted")]
pub struct GraphqlWorkFeedEntryUpserted<E: SoupEntityEdges> {
    /// The entry.
    entry: GraphqlWorkFeedEntry<E>,
}

/// An item that no longer belongs in the subscribed feed: done, filtered out
/// or inaccessible. The entity itself is not necessarily deleted.
#[derive(SimpleObject)]
#[graphql(name = "WorkFeedEntryRemoved")]
pub struct GraphqlWorkFeedEntryRemoved {
    /// The removed item's id.
    item_id: ID,
}

/// Changes may have been missed: refetch the feed.
#[derive(SimpleObject)]
#[graphql(name = "WorkFeedInvalidated")]
pub struct GraphqlWorkFeedInvalidated {
    /// Always true.
    refresh: bool,
}

/// One change to a work feed's membership, placement or items.
#[expect(
    clippy::large_enum_variant,
    reason = "upserts dominate and carry hydrated entries"
)]
#[derive(Union)]
#[graphql(name = "WorkFeedPatch")]
pub enum GraphqlWorkFeedPatch<E: SoupEntityEdges> {
    /// An item belongs in the feed with this content and placement.
    Upserted(GraphqlWorkFeedEntryUpserted<E>),
    /// An item no longer belongs in the feed.
    Removed(GraphqlWorkFeedEntryRemoved),
    /// The feed must be refetched.
    Invalidated(GraphqlWorkFeedInvalidated),
}

impl<E: SoupEntityEdges> GraphqlWorkFeedPatch<E> {
    /// The patch announcing that changes may have been missed.
    pub fn invalidated() -> Self {
        Self::Invalidated(GraphqlWorkFeedInvalidated { refresh: true })
    }
}

impl<E: SoupEntityEdges> From<WorkFeedChange<SoupProjectionHydration>> for GraphqlWorkFeedPatch<E> {
    fn from(change: WorkFeedChange<SoupProjectionHydration>) -> Self {
        match change {
            WorkFeedChange::Upserted(entry) => Self::Upserted(GraphqlWorkFeedEntryUpserted {
                entry: GraphqlWorkFeedEntry::new(entry),
            }),
            WorkFeedChange::Removed(key) => Self::Removed(GraphqlWorkFeedEntryRemoved {
                item_id: ID(key.id()),
            }),
        }
    }
}
