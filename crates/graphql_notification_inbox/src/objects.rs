use async_graphql::{Enum, ID, Object, SimpleObject, Union};
use graphql_notification::GraphqlNotification;
use graphql_soup::{GraphqlSoupEntity, SoupEntityEdges};
use notification_inbox::domain::models::{
    InboxActor, InboxChange, InboxEntry, InboxPage, InboxRow, InboxRowAction, InboxRowActionKind,
};
use soup::domain::models::SoupProjectionHydration;

use crate::inputs::GraphqlNotificationInboxRowType;

/// Notifications one row returns when no limit is given.
const DEFAULT_ROW_NOTIFICATION_LIMIT: i32 = 20;
/// Most notifications one row may return.
const MAX_ROW_NOTIFICATION_LIMIT: i32 = 100;

/// The kind of principal a row is from. Values may be added; present one
/// you do not know without an author.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "NotificationInboxActorKind")]
pub enum GraphqlNotificationInboxActorKind {
    /// A Macro user.
    User,
    /// An agent.
    Agent,
    /// Macro itself.
    Macro,
}

/// Who a row is from: a person, an agent, or Macro itself.
#[derive(SimpleObject)]
#[graphql(name = "NotificationInboxActor")]
pub struct GraphqlNotificationInboxActor {
    /// The kind of principal.
    kind: GraphqlNotificationInboxActorKind,
    /// The user id for a user, the bot id for an agent; absent for Macro.
    /// Not `id`: the client cache reads an `id` field as entity identity.
    principal_id: Option<String>,
    /// The display name when the row carries it (an agent's bot name);
    /// users are looked up by id.
    name: Option<String>,
}

impl From<InboxActor> for GraphqlNotificationInboxActor {
    fn from(actor: InboxActor) -> Self {
        match actor {
            InboxActor::User(user) => Self {
                kind: GraphqlNotificationInboxActorKind::User,
                principal_id: Some(user.as_ref().to_string()),
                name: None,
            },
            InboxActor::Agent { bot_id, name } => Self {
                kind: GraphqlNotificationInboxActorKind::Agent,
                principal_id: Some(bot_id.to_string()),
                name: Some(name),
            },
            InboxActor::Macro => Self {
                kind: GraphqlNotificationInboxActorKind::Macro,
                principal_id: None,
                name: None,
            },
        }
    }
}

/// What the viewer can do from a row. Values are added with the row types
/// that offer them; skip one you do not know.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "NotificationInboxRowActionKind")]
pub enum GraphqlNotificationInboxRowActionKind {
    /// Open what the row is about.
    Open,
    /// Answer the agent that is waiting for the viewer.
    Answer,
    /// Review the pull request at `url`.
    Review,
    /// Grant the access request `targetId`.
    Approve,
    /// Refuse the access request `targetId`.
    Deny,
    /// Accept the join request `targetId`.
    Accept,
    /// Decline the join request `targetId`.
    Decline,
}

impl From<InboxRowActionKind> for GraphqlNotificationInboxRowActionKind {
    fn from(kind: InboxRowActionKind) -> Self {
        match kind {
            InboxRowActionKind::Open => Self::Open,
            InboxRowActionKind::Answer => Self::Answer,
            InboxRowActionKind::Review => Self::Review,
            InboxRowActionKind::Approve => Self::Approve,
            InboxRowActionKind::Deny => Self::Deny,
            InboxRowActionKind::Accept => Self::Accept,
            InboxRowActionKind::Decline => Self::Decline,
        }
    }
}

/// One thing the viewer can do from a row, described as data. Perform it
/// through the API of the thing it acts on; the inbox only says it is
/// available.
#[derive(SimpleObject)]
#[graphql(name = "NotificationInboxRowAction")]
pub struct GraphqlNotificationInboxRowAction {
    /// What the action does.
    kind: GraphqlNotificationInboxRowActionKind,
    /// What the action acts on when it is not the row's group: an access or
    /// join request.
    target_id: Option<ID>,
    /// The page the action opens outside Macro, such as a pull request.
    url: Option<String>,
}

impl From<InboxRowAction> for GraphqlNotificationInboxRowAction {
    fn from(action: InboxRowAction) -> Self {
        Self {
            kind: action.kind.into(),
            target_id: action.target_id.map(ID),
            url: action.url,
        }
    }
}

/// One inbox row.
pub struct GraphqlNotificationInboxRow(InboxRow);

/// One inbox row: the notifications shown together for one thread, a
/// channel's top level, an email thread, a task, a request or a review. A
/// row's contents depend only on the viewer's notifications, so one id is
/// one row in every scope.
#[Object(name = "NotificationInboxRow")]
impl GraphqlNotificationInboxRow {
    /// Stable per-viewer row id: `<groupId>#<slot>`. Opaque.
    async fn id(&self) -> ID {
        ID(self.0.id.id())
    }

    /// The row's kind.
    async fn row_type(&self) -> GraphqlNotificationInboxRowType {
        self.0.row_type.into()
    }

    /// For a thread row, the channel root message or discussion root
    /// comment it is about.
    async fn thread_id(&self) -> Option<&str> {
        self.0.thread_id.as_deref()
    }

    /// When the row's newest shown notification was created, in RFC 3339.
    async fn latest_at(&self) -> String {
        self.0.latest().created_at.to_rfc3339()
    }

    /// Who the row is from, per its newest shown notification; absent when
    /// that is no one in Macro (outside email senders, GitHub users).
    async fn actor(&self) -> Option<GraphqlNotificationInboxActor> {
        self.0.actor.clone().map(Into::into)
    }

    /// What the viewer can do from the row, in presentation order; empty
    /// when the row only opens.
    async fn actions(&self) -> Vec<GraphqlNotificationInboxRowAction> {
        self.0.actions.iter().cloned().map(Into::into).collect()
    }

    /// Whether the row is unread.
    async fn unseen(&self) -> bool {
        self.0.unseen
    }

    /// How many notifications the row shows.
    async fn count(&self) -> i32 {
        i32::try_from(self.0.notifications.len()).unwrap_or(i32::MAX)
    }

    /// Opaque token of what the row stands for; send it with done so
    /// notifications that arrive later stay active.
    async fn revision(&self) -> String {
        self.0.revision().encode()
    }

    /// The row's shown notifications, newest first. Defaults to 20, capped
    /// at 100; `count` is the full size.
    async fn notifications(
        &self,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlNotification>> {
        let limit = graphql_common::parse_limit(
            limit,
            DEFAULT_ROW_NOTIFICATION_LIMIT,
            MAX_ROW_NOTIFICATION_LIMIT,
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

/// One group of the inbox in one scope.
pub struct GraphqlNotificationInboxEntry<E: SoupEntityEdges> {
    /// The group's id.
    group_id: String,
    /// The entity the rows are filed under.
    entity: GraphqlSoupEntity<E>,
    /// The entry's sort time.
    sort_at: String,
    /// The matching rows.
    rows: Vec<GraphqlNotificationInboxRow>,
}

/// The matching rows of the notifications filed under one entity. Entries
/// belong to one inbox scope and have no id of their own; rows are shared.
#[Object(name = "NotificationInboxEntry")]
impl<E: SoupEntityEdges> GraphqlNotificationInboxEntry<E> {
    /// The group the rows are filed under: `<entity type>:<entity id>`.
    async fn group_id(&self) -> ID {
        ID(self.group_id.clone())
    }

    /// The entity the rows are filed under.
    async fn entity(&self) -> &GraphqlSoupEntity<E> {
        &self.entity
    }

    /// Where the entry sits, in RFC 3339: the group's newest pending
    /// notification.
    async fn sort_at(&self) -> &str {
        &self.sort_at
    }

    /// The matching rows, newest first; never empty.
    async fn rows(&self) -> &[GraphqlNotificationInboxRow] {
        &self.rows
    }
}

impl<E: SoupEntityEdges> GraphqlNotificationInboxEntry<E> {
    /// Build the GraphQL entry for a domain entry.
    pub fn new(entry: InboxEntry<SoupProjectionHydration>) -> Self {
        Self {
            group_id: entry.group.id(),
            entity: GraphqlSoupEntity::new_with_projection(entry.entity),
            sort_at: entry.sort_at.to_rfc3339(),
            rows: entry
                .rows
                .into_iter()
                .map(GraphqlNotificationInboxRow)
                .collect(),
        }
    }
}

/// One page of the viewer's notification inbox, newest group first.
#[derive(SimpleObject)]
#[graphql(name = "NotificationInboxPage")]
pub struct GraphqlNotificationInboxPage<E: SoupEntityEdges> {
    /// The page's entries.
    entries: Vec<GraphqlNotificationInboxEntry<E>>,
    /// Cursor for the next page; absent once the inbox is exhausted.
    next_cursor: Option<String>,
}

impl<E: SoupEntityEdges> GraphqlNotificationInboxPage<E> {
    /// Build the GraphQL page for a domain page.
    pub fn new(page: InboxPage<SoupProjectionHydration>) -> Self {
        Self {
            entries: page
                .entries
                .into_iter()
                .map(GraphqlNotificationInboxEntry::new)
                .collect(),
            next_cursor: page.next.map(|next| next.encode()),
        }
    }
}

/// A group that belongs in the subscribed inbox, with its current rows and
/// placement. Insert it, or move it to its new `sortAt`.
#[derive(SimpleObject)]
#[graphql(name = "NotificationInboxEntryUpserted")]
pub struct GraphqlNotificationInboxEntryUpserted<E: SoupEntityEdges> {
    /// The entry.
    entry: GraphqlNotificationInboxEntry<E>,
}

/// A group with no matching row left in the subscribed inbox: done,
/// filtered out or inaccessible. The entity itself is not necessarily
/// deleted.
#[derive(SimpleObject)]
#[graphql(name = "NotificationInboxEntryRemoved")]
pub struct GraphqlNotificationInboxEntryRemoved {
    /// The removed group's id.
    group_id: ID,
}

/// Changes may have been missed: refetch the inbox.
#[derive(SimpleObject)]
#[graphql(name = "NotificationInboxInvalidated")]
pub struct GraphqlNotificationInboxInvalidated {
    /// Always true.
    refresh: bool,
}

/// One change to an inbox's membership, placement or rows.
#[expect(
    clippy::large_enum_variant,
    reason = "upserts dominate and carry hydrated entries"
)]
#[derive(Union)]
#[graphql(name = "NotificationInboxPatch")]
pub enum GraphqlNotificationInboxPatch<E: SoupEntityEdges> {
    /// A group belongs in the inbox with these rows and this placement.
    Upserted(GraphqlNotificationInboxEntryUpserted<E>),
    /// A group no longer belongs in the inbox.
    Removed(GraphqlNotificationInboxEntryRemoved),
    /// The inbox must be refetched.
    Invalidated(GraphqlNotificationInboxInvalidated),
}

impl<E: SoupEntityEdges> GraphqlNotificationInboxPatch<E> {
    /// The patch announcing that changes may have been missed.
    pub fn invalidated() -> Self {
        Self::Invalidated(GraphqlNotificationInboxInvalidated { refresh: true })
    }
}

impl<E: SoupEntityEdges> From<InboxChange<SoupProjectionHydration>>
    for GraphqlNotificationInboxPatch<E>
{
    fn from(change: InboxChange<SoupProjectionHydration>) -> Self {
        match change {
            InboxChange::Upserted(entry) => Self::Upserted(GraphqlNotificationInboxEntryUpserted {
                entry: GraphqlNotificationInboxEntry::new(entry),
            }),
            InboxChange::Removed(group) => Self::Removed(GraphqlNotificationInboxEntryRemoved {
                group_id: ID(group.id()),
            }),
        }
    }
}
