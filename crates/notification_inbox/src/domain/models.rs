//! Notification inbox domain models: rows, entries and scopes. Keys, tokens,
//! viewers and errors are the shared feed layer's (`attention_feed`).

use attention_feed::domain::models::{
    DoneReceipt, FeedKey, FeedNotification, FeedPosition, FeedRevision,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The kinds of inbox row, which callers can narrow the inbox to. Kinds are
/// added as the inbox learns new sources; callers present a kind they do not
/// know as a generic row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InboxRowType {
    /// An agent session's or AI chat's latest response or question.
    Agent,
    /// An email thread.
    Email,
    /// A top-level channel message that mentions the viewer, with its thread.
    ChannelMention,
    /// A channel's top-level messages, reactions to them and invites.
    ChannelMessages,
    /// A channel thread's replies, mentions and reactions.
    ChannelThread,
    /// A top-level discussion comment that mentions the viewer, with its
    /// thread.
    DiscussionMention,
    /// An entity's top-level discussion comments.
    DiscussionMessages,
    /// One discussion thread's replies.
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
}

impl InboxScope {
    /// Whether the scope lists rows of `row_type`.
    pub fn admits(&self, row_type: InboxRowType) -> bool {
        self.row_types.is_empty() || self.row_types.contains(&row_type)
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

/// The outcome of marking rows done.
#[derive(Debug)]
pub struct InboxDoneOutcome {
    /// The rows now done; requested rows that were already gone are
    /// reported done as well, so callers can drop them.
    pub rows: Vec<InboxRowId>,
    /// What the operation changed, for undo.
    pub receipt: DoneReceipt,
}
