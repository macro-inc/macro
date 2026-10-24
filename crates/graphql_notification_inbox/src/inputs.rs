use async_graphql::{Enum, ID, InputObject};
use attention_feed::domain::models::{FeedPosition, FeedRevision};
use notification_inbox::domain::models::{
    InboxQuery, InboxRowId, InboxRowTarget, InboxRowType, InboxScope,
};

#[cfg(test)]
mod test;

/// Entries returned by one inbox page when no limit is given.
pub const DEFAULT_INBOX_LIMIT: i32 = 50;
/// Most entries one inbox page may return.
pub const MAX_INBOX_LIMIT: i32 = 100;
/// Most rows one done or seen mutation may name.
pub const MAX_INBOX_ROWS: usize = 200;

/// The kinds of notification inbox row. Values are added as the inbox
/// learns new sources; present a value you do not know as a generic row.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "NotificationInboxRowType")]
pub enum GraphqlNotificationInboxRowType {
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

impl From<GraphqlNotificationInboxRowType> for InboxRowType {
    fn from(value: GraphqlNotificationInboxRowType) -> Self {
        use GraphqlNotificationInboxRowType as G;
        match value {
            G::Agent => Self::Agent,
            G::Email => Self::Email,
            G::ChannelMention => Self::ChannelMention,
            G::ChannelMessages => Self::ChannelMessages,
            G::ChannelThread => Self::ChannelThread,
            G::DiscussionMention => Self::DiscussionMention,
            G::DiscussionMessages => Self::DiscussionMessages,
            G::DiscussionThread => Self::DiscussionThread,
            G::Task => Self::Task,
            G::PullRequest => Self::PullRequest,
            G::CalendarEvent => Self::CalendarEvent,
            G::CalendarJoinRequest => Self::CalendarJoinRequest,
            G::AccessRequested => Self::AccessRequested,
            G::AccessGranted => Self::AccessGranted,
        }
    }
}

impl From<InboxRowType> for GraphqlNotificationInboxRowType {
    fn from(value: InboxRowType) -> Self {
        use InboxRowType as D;
        match value {
            D::Agent => Self::Agent,
            D::Email => Self::Email,
            D::ChannelMention => Self::ChannelMention,
            D::ChannelMessages => Self::ChannelMessages,
            D::ChannelThread => Self::ChannelThread,
            D::DiscussionMention => Self::DiscussionMention,
            D::DiscussionMessages => Self::DiscussionMessages,
            D::DiscussionThread => Self::DiscussionThread,
            D::Task => Self::Task,
            D::PullRequest => Self::PullRequest,
            D::CalendarEvent => Self::CalendarEvent,
            D::CalendarJoinRequest => Self::CalendarJoinRequest,
            D::AccessRequested => Self::AccessRequested,
            D::AccessGranted => Self::AccessGranted,
        }
    }
}

/// Which rows a notification inbox shows. Pages, subscriptions, seen and
/// undo for one inbox send the same scope.
#[derive(InputObject, Default, Clone)]
pub struct NotificationInboxScopeInput {
    /// Row kinds to include; omitted or empty means every kind.
    pub row_types: Option<Vec<GraphqlNotificationInboxRowType>>,
}

impl NotificationInboxScopeInput {
    /// Convert into the domain scope.
    pub(crate) fn into_scope(self) -> InboxScope {
        InboxScope {
            row_types: self
                .row_types
                .unwrap_or_default()
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}

/// Page request for the viewer's notification inbox.
#[derive(InputObject, Default)]
pub struct NotificationInboxInput {
    /// Which rows the inbox shows.
    pub scope: Option<NotificationInboxScopeInput>,
    /// Entries per page; defaults to 50, capped at 100.
    pub limit: Option<i32>,
    /// Opaque cursor from the previous page's `nextCursor`; absent for the
    /// first page. Send it with the same scope.
    pub cursor: Option<String>,
}

impl NotificationInboxInput {
    /// Validate and convert into the domain query.
    pub(crate) fn into_query(self) -> async_graphql::Result<InboxQuery> {
        let limit = graphql_common::parse_limit(self.limit, DEFAULT_INBOX_LIMIT, MAX_INBOX_LIMIT)?;
        let after = self
            .cursor
            .map(|cursor| FeedPosition::decode(&cursor))
            .transpose()
            .map_err(|_| async_graphql::Error::new("invalid notification inbox cursor"))?;
        Ok(InboxQuery {
            scope: self.scope.unwrap_or_default().into_scope(),
            limit: u16::try_from(limit).expect("limit is capped below u16::MAX"),
            after,
        })
    }
}

/// Parse a row id, rejecting ids that name no row.
fn parse_row_id(id: &ID) -> async_graphql::Result<InboxRowId> {
    InboxRowId::parse(id)
        .map_err(|_| async_graphql::Error::new("invalid notification inbox row id"))
}

/// Reject a mutation naming more than [`MAX_INBOX_ROWS`] rows.
fn check_row_count(count: usize) -> async_graphql::Result<()> {
    if count > MAX_INBOX_ROWS {
        return Err(async_graphql::Error::new(format!(
            "at most {MAX_INBOX_ROWS} rows can be changed at once"
        )));
    }
    Ok(())
}

/// One row to mark done.
#[derive(InputObject)]
pub struct NotificationInboxRowTargetInput {
    /// The row's id.
    pub id: ID,
    /// The row's `revision` the caller observed. Notifications newer than it
    /// stay active. Omit to acknowledge everything current.
    pub revision: Option<String>,
}

/// Input for marking inbox rows done.
#[derive(InputObject)]
pub struct MarkNotificationInboxRowsDoneInput {
    /// The rows to complete, at most 200.
    pub rows: Vec<NotificationInboxRowTargetInput>,
}

impl MarkNotificationInboxRowsDoneInput {
    /// Validate and convert into domain row targets.
    pub(crate) fn into_targets(self) -> async_graphql::Result<Vec<InboxRowTarget>> {
        check_row_count(self.rows.len())?;
        self.rows
            .into_iter()
            .map(|row| {
                let revision = row
                    .revision
                    .map(|revision| FeedRevision::decode(&revision))
                    .transpose()
                    .map_err(|_| {
                        async_graphql::Error::new("invalid notification inbox revision")
                    })?;
                Ok(InboxRowTarget {
                    id: parse_row_id(&row.id)?,
                    revision,
                })
            })
            .collect()
    }
}

/// Input for undoing one mark-done.
#[derive(InputObject)]
pub struct UndoNotificationInboxRowsDoneInput {
    /// The `undoToken` the mark-done returned.
    pub undo_token: String,
    /// The inbox the restored groups are placed in.
    pub scope: Option<NotificationInboxScopeInput>,
}

/// Input for marking inbox rows seen.
#[derive(InputObject)]
pub struct MarkNotificationInboxRowsSeenInput {
    /// The rows to mark seen, at most 200.
    pub row_ids: Vec<ID>,
    /// The inbox the updated groups are placed in.
    pub scope: Option<NotificationInboxScopeInput>,
}

impl MarkNotificationInboxRowsSeenInput {
    /// Validate and convert into domain row ids.
    pub(crate) fn into_rows(self) -> async_graphql::Result<Vec<InboxRowId>> {
        check_row_count(self.row_ids.len())?;
        self.row_ids.iter().map(parse_row_id).collect()
    }
}
