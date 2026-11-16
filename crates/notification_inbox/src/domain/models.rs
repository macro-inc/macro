//! Notification inbox domain models: rows, entries and scopes. Keys, tokens,
//! viewers and errors are the shared feed layer's (`attention_feed`).

use attention_feed::domain::models::{
    DoneReceipt, FeedKey, FeedNotification, FeedPosition, FeedRevision,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::bulk_action::BulkActionLease;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The kinds of inbox row, which callers can narrow the inbox to. Kinds are
/// added as the inbox learns new sources; callers present a kind they do not
/// know as a generic row. A stored clear keeps the kinds it takes by their
/// serialized names, so a kind's name never changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxRowType {
    /// An agent session's or AI chat's latest response or question.
    Agent,
    /// An email thread.
    Email,
    /// A top-level channel message that mentions the viewer, with its thread.
    ChannelMention,
    /// A channel's top-level messages, a lone reaction to one, and invites.
    ChannelMessages,
    /// A channel thread's replies, mentions and reactions, with its root
    /// message and the reactions to it.
    ChannelThread,
    /// An entity's discussion comments, when one of them mentions the viewer.
    DiscussionMention,
    /// An entity's discussion comments.
    DiscussionMessages,
    /// One discussion thread's replies. No longer listed, since an entity's
    /// comments share one row; kept because row kinds only grow.
    DiscussionThread,
    /// A task assigned to the viewer.
    Task,
    /// A GitHub pull request's activity.
    PullRequest,
    /// Reminders of an upcoming calendar event.
    CalendarEvent,
    /// A request to join a calendar event the viewer shared.
    CalendarJoinRequest,
    /// A request for access to something the viewer can share.
    AccessRequested,
    /// Access the viewer requested was granted.
    AccessGranted,
    /// The viewer's access to a runtime was removed, and agents of theirs
    /// living there stopped.
    AccessRemoved,
}

impl InboxRowType {
    /// Every kind of row.
    pub const ALL: [Self; 15] = [
        Self::Agent,
        Self::Email,
        Self::ChannelMention,
        Self::ChannelMessages,
        Self::ChannelThread,
        Self::DiscussionMention,
        Self::DiscussionMessages,
        Self::DiscussionThread,
        Self::Task,
        Self::PullRequest,
        Self::CalendarEvent,
        Self::CalendarJoinRequest,
        Self::AccessRequested,
        Self::AccessGranted,
        Self::AccessRemoved,
    ];
}

/// A row's identity: the group it belongs to and its slot in the group,
/// `<group id>#<slot>`. A row's contents depend only on the viewer's
/// notifications, so one id names one row in every scope; the row type is
/// left out so a thread row keeps its id between mention and reply.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InboxRowId {
    /// The group the row belongs to.
    pub group: FeedKey,
    /// The row's slot within the group.
    pub slot: String,
}

/// A row id that does not name a row.
#[derive(Debug, thiserror::Error)]
#[error("invalid notification inbox row id")]
pub struct InvalidInboxRowId;

impl InboxRowId {
    /// The row's global id.
    pub fn id(&self) -> String {
        format!("{}#{}", self.group.id(), self.slot)
    }

    /// Parse an id produced by [`Self::id`].
    pub fn parse(id: &str) -> Result<Self, InvalidInboxRowId> {
        let (group, slot) = id.split_once('#').ok_or(InvalidInboxRowId)?;
        if slot.is_empty() {
            return Err(InvalidInboxRowId);
        }
        Ok(Self {
            group: FeedKey::parse(group).map_err(|_| InvalidInboxRowId)?,
            slot: slot.to_string(),
        })
    }
}

/// Who a row is from: a person, an agent, or Macro itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InboxActor {
    /// A Macro user.
    User(MacroUserIdStr<'static>),
    /// An agent, by the bot it runs as.
    Agent {
        /// The bot.
        bot_id: Uuid,
        /// The bot's display name.
        name: String,
    },
    /// Macro itself: reminders and AI chat responses.
    Macro,
}

/// What the viewer can do from a row. Kinds are added with the row types
/// that offer them; callers skip a kind they do not know.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InboxRowActionKind {
    /// Open what the row is about.
    Open,
    /// Answer the agent that is waiting for the viewer.
    Answer,
    /// Review the pull request.
    Review,
    /// Grant the access requested.
    Approve,
    /// Refuse the access requested.
    Deny,
    /// Accept the request to join the event.
    Accept,
    /// Decline the request to join the event.
    Decline,
}

/// One thing the viewer can do from a row, described as data. The caller
/// performs it through the API of the thing it acts on; the inbox only says
/// it is available.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxRowAction {
    /// What the action does.
    pub kind: InboxRowActionKind,
    /// What the action acts on when it is not the row's group: an access or
    /// join request.
    pub target_id: Option<String>,
    /// The page the action opens outside Macro, such as a pull request.
    pub url: Option<String>,
}

/// One inbox row: the notifications shown together for one slot of a group.
#[derive(Debug, Clone)]
pub struct InboxRow {
    /// The row's identity.
    pub id: InboxRowId,
    /// The row's kind.
    pub row_type: InboxRowType,
    /// For a thread row, the channel root message or discussion root comment.
    pub thread_id: Option<String>,
    /// Who the row is from, per its newest shown notification; `None` when
    /// that is no one in Macro (outside email senders, GitHub users).
    pub actor: Option<InboxActor>,
    /// What the viewer can do from the row, in presentation order.
    pub actions: Vec<InboxRowAction>,
    /// The notifications the row shows, newest first; never empty.
    pub notifications: Vec<FeedNotification>,
    /// Notifications the row stands for without showing them: those another
    /// notification about the same message speaks for, and noise. Done and
    /// seen act on them with the row.
    pub hidden: Vec<FeedNotification>,
    /// Whether the row is unread.
    pub unseen: bool,
}

impl InboxRow {
    /// The newest notification the row shows.
    pub fn latest(&self) -> &FeedNotification {
        &self.notifications[0]
    }

    /// Every notification the row stands for, shown then hidden.
    pub fn all_notifications(&self) -> impl Iterator<Item = &FeedNotification> {
        self.notifications.iter().chain(&self.hidden)
    }

    /// What marking the row done acknowledges: everything it stands for up
    /// to its newest notification, shown or hidden.
    pub fn revision(&self) -> FeedRevision {
        FeedRevision::covering(self.all_notifications())
    }

    /// Whether the row shows the notification and nothing else.
    pub fn shows_only(&self, notification: Uuid) -> bool {
        matches!(
            self.notifications.as_slice(),
            [only] if only.notification_id == notification
        )
    }
}

/// One group of the inbox: the matching rows of the notifications filed
/// under one entity.
#[derive(Debug, Clone)]
pub struct InboxEntry<E> {
    /// The entity the rows are filed under.
    pub group: FeedKey,
    /// The hydrated entity.
    pub entity: E,
    /// Where the entry sits: the group's newest pending notification.
    pub sort_at: DateTime<Utc>,
    /// The matching rows, newest first; never empty.
    pub rows: Vec<InboxRow>,
}

/// Which rows one inbox shows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InboxScope {
    /// The row kinds to include; empty means every kind.
    pub row_types: Vec<InboxRowType>,
    /// Only unread rows, by each row's own unread rule (mail by its unread
    /// messages). Pages, cursors and live changes are then over unread rows
    /// alone, so a row read elsewhere leaves and one with new activity
    /// returns.
    pub unread_only: bool,
}

impl InboxScope {
    /// Whether the scope lists `row`.
    pub fn admits(&self, row: &InboxRow) -> bool {
        (self.row_types.is_empty() || self.row_types.contains(&row.row_type))
            && (!self.unread_only || row.unseen)
    }
}

/// A request for one page of the inbox.
#[derive(Debug, Clone)]
pub struct InboxQuery {
    /// Which rows the inbox shows.
    pub scope: InboxScope,
    /// Maximum entries on the page.
    pub limit: u16,
    /// Resume after this position; `None` for the first page.
    pub after: Option<FeedPosition>,
}

/// One page of the inbox, newest first.
#[derive(Debug)]
pub struct InboxPage<E> {
    /// The page's entries.
    pub entries: Vec<InboxEntry<E>>,
    /// Where the next page starts; `None` once the inbox is exhausted.
    pub next: Option<FeedPosition>,
}

/// How a known group changed for one inbox.
#[derive(Debug)]
pub enum InboxChange<E> {
    /// The group belongs in the inbox with these rows and this placement.
    Upserted(InboxEntry<E>),
    /// The group no longer has a matching row: done, filtered out or
    /// inaccessible. The entity itself may still exist.
    Removed(FeedKey),
}

/// A row the caller asked to mark done, with what they observed.
#[derive(Debug, Clone)]
pub struct InboxRowTarget {
    /// The row.
    pub id: InboxRowId,
    /// The row's revision the caller observed; `None` acknowledges
    /// everything current.
    pub revision: Option<FeedRevision>,
}

/// A clear of an inbox: every matching row is marked done, chunk by chunk
/// on the server.
#[derive(Debug, Clone)]
pub struct InboxClearRequest {
    /// Which rows are cleared; an unread scope clears unread rows only. The
    /// row kinds are named: a clear has no "every kind".
    pub scope: InboxScope,
    /// Clear only rows whose newest notification arrived at or after this
    /// time; older groups end the clear.
    pub since: Option<DateTime<Utc>>,
}

/// Where a clear is in its life.
pub use notification::domain::bulk_action::BulkActionStatus as ClearStatus;

/// A clear as stored: what it covers, frozen when it started, and how far
/// it has got.
#[derive(Debug, Clone, PartialEq)]
pub struct ClearAction {
    /// The clear's id, chosen by the caller.
    pub id: Uuid,
    /// Where it is in its life.
    pub status: ClearStatus,
    /// The rows it clears.
    pub scope: InboxScope,
    /// It clears only rows whose newest notification arrived at or after
    /// this time.
    pub since: Option<DateTime<Utc>>,
    /// When it started. Notifications that arrived later are not cleared.
    pub as_of: DateTime<Utc>,
    /// Rows cleared so far.
    pub rows: u32,
    /// Notifications marked done so far.
    pub notifications: u32,
    /// Notifications an undo has reopened so far.
    pub restored: u32,
    /// Bumps on every change, so a reader can drop a stale copy.
    pub revision: i64,
}

/// Which part of the inbox a clear's next chunk reads.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ClearPass {
    /// The walk through the inbox, newest group first.
    #[default]
    Walk,
    /// A second look at the groups new activity moved ahead of the walk
    /// while it ran; their older notifications are still the clear's.
    Recheck,
}

/// Where a clear's next chunk starts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ClearCursor {
    pub(crate) pass: ClearPass,
    /// The encoded feed position to read after; `None` at a pass's start.
    pub(crate) after: Option<String>,
}

/// The right to run a clear's remaining chunks, forward or as an undo.
/// Whoever holds it runs it with `run_clear`; if they stop, the clear is
/// claimed again once its lease runs out.
#[derive(Debug, Clone)]
pub struct ClearRun {
    pub(crate) lease: BulkActionLease,
    pub(crate) action: ClearAction,
    pub(crate) cursor: ClearCursor,
}

impl ClearRun {
    /// Whose inbox the clear belongs to.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.lease.user_id
    }

    /// The clear.
    pub fn action(&self) -> &ClearAction {
        &self.action
    }
}

/// A clear or undo that was asked for.
#[derive(Debug, Clone)]
pub struct StartedClear {
    /// The clear as it stands.
    pub action: ClearAction,
    /// The work to run, when this request started it. `None` when the
    /// request repeated one already made.
    pub run: Option<ClearRun>,
}

/// The outcome of marking one notification of a row done.
#[derive(Debug)]
pub struct InboxNotificationDoneOutcome<E> {
    /// The row's group in the caller's inbox, now without the notification.
    pub changes: Vec<InboxChange<E>>,
    /// What the operation changed, for undo.
    pub receipt: DoneReceipt,
}

/// The outcome of marking rows done.
#[derive(Debug)]
pub struct InboxDoneOutcome {
    /// The rows now done; requested rows that were already gone are
    /// reported done as well, so callers can drop them.
    pub rows: Vec<InboxRowId>,
    /// What the operation changed, for undo.
    pub receipt: DoneReceipt,
}
