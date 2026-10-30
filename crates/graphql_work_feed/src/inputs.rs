use async_graphql::{Enum, ID, InputObject};
use work_feed::domain::models::{
    WorkFeedDoneTarget, WorkFeedItemKey, WorkFeedItemState, WorkFeedItemType, WorkFeedMode,
    WorkFeedPosition, WorkFeedQuery, WorkFeedRevision, WorkFeedScope,
};

use crate::objects::GraphqlWorkFeedItemState;

#[cfg(test)]
mod test;

/// Items returned by one work feed page when no limit is given.
pub const DEFAULT_WORK_FEED_LIMIT: i32 = 50;
/// Most items one work feed page may return.
pub const MAX_WORK_FEED_LIMIT: i32 = 100;
/// Most items one done mutation may complete.
pub const MAX_DONE_ITEMS: usize = 200;

/// Which reasons admit items to a work feed.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[graphql(name = "WorkFeedMode")]
pub enum GraphqlWorkFeedMode {
    /// Outstanding attention plus the viewer's recent own work.
    #[default]
    Work,
    /// Outstanding attention only.
    Attention,
}

impl From<GraphqlWorkFeedMode> for WorkFeedMode {
    fn from(value: GraphqlWorkFeedMode) -> Self {
        match value {
            GraphqlWorkFeedMode::Work => Self::Work,
            GraphqlWorkFeedMode::Attention => Self::Attention,
        }
    }
}

/// The kinds of item a work feed can be narrowed to.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "WorkFeedItemType")]
pub enum GraphqlWorkFeedItemType {
    /// Documents other than tasks.
    Document,
    /// Tasks.
    Task,
    /// AI chats.
    Chat,
    /// Projects (folders).
    Project,
    /// Task projects (initiatives).
    Initiative,
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

impl From<GraphqlWorkFeedItemType> for WorkFeedItemType {
    fn from(value: GraphqlWorkFeedItemType) -> Self {
        match value {
            GraphqlWorkFeedItemType::Document => Self::Document,
            GraphqlWorkFeedItemType::Task => Self::Task,
            GraphqlWorkFeedItemType::Chat => Self::Chat,
            GraphqlWorkFeedItemType::Project => Self::Project,
            GraphqlWorkFeedItemType::Initiative => Self::Initiative,
            GraphqlWorkFeedItemType::Email => Self::Email,
            GraphqlWorkFeedItemType::Channel => Self::Channel,
            GraphqlWorkFeedItemType::ChannelThread => Self::ChannelThread,
            GraphqlWorkFeedItemType::CalendarEvent => Self::CalendarEvent,
            GraphqlWorkFeedItemType::PullRequest => Self::PullRequest,
            GraphqlWorkFeedItemType::AgentSession => Self::AgentSession,
        }
    }
}

/// Which items a work feed shows. Pages, subscriptions and undo for one feed
/// send the same scope.
#[derive(InputObject, Default, Clone)]
pub struct WorkFeedScopeInput {
    /// Which reasons admit items. Defaults to `WORK`.
    pub mode: Option<GraphqlWorkFeedMode>,
    /// Item kinds to include; omitted or empty means every kind.
    pub types: Option<Vec<GraphqlWorkFeedItemType>>,
    /// Whether snippet documents are included. Defaults to false.
    pub include_snippets: Option<bool>,
}

impl WorkFeedScopeInput {
    /// Convert into the domain scope, applying defaults.
    pub(crate) fn into_scope(self) -> WorkFeedScope {
        WorkFeedScope {
            mode: self.mode.unwrap_or_default().into(),
            types: self
                .types
                .unwrap_or_default()
                .into_iter()
                .map(Into::into)
                .collect(),
            include_snippets: self.include_snippets.unwrap_or(false),
        }
    }
}

/// Page request for the viewer's work feed.
#[derive(InputObject, Default)]
pub struct WorkFeedInput {
    /// Which items the feed shows.
    pub scope: Option<WorkFeedScopeInput>,
    /// Only items in this state: `UNSEEN` or `SEEN`. Subscriptions and undo
    /// place items in every state, so an item seen while it is shown stays
    /// until the page is fetched again.
    pub state: Option<GraphqlWorkFeedItemState>,
    /// Page size; defaults to 50, capped at 100.
    pub limit: Option<i32>,
    /// Opaque cursor from the previous page's `nextCursor`; absent for the
    /// first page. Send it with the same scope and state.
    pub cursor: Option<String>,
}

impl WorkFeedInput {
    /// Validate and convert into the domain query.
    pub(crate) fn into_query(self) -> async_graphql::Result<WorkFeedQuery> {
        let limit =
            graphql_common::parse_limit(self.limit, DEFAULT_WORK_FEED_LIMIT, MAX_WORK_FEED_LIMIT)?;
        let after = self
            .cursor
            .map(|cursor| WorkFeedPosition::decode(&cursor))
            .transpose()
            .map_err(|_| async_graphql::Error::new("invalid work feed cursor"))?;
        let state = match self.state {
            None => None,
            Some(GraphqlWorkFeedItemState::Unseen) => Some(WorkFeedItemState::Unseen),
            Some(GraphqlWorkFeedItemState::Seen) => Some(WorkFeedItemState::Seen),
            Some(GraphqlWorkFeedItemState::Done) => {
                return Err(async_graphql::Error::new(
                    "work feed pages hold only unseen and seen items",
                ));
            }
        };
        Ok(WorkFeedQuery {
            scope: self.scope.unwrap_or_default().into_scope(),
            state,
            limit: u16::try_from(limit).expect("limit is capped below u16::MAX"),
            after,
        })
    }
}

/// One item to mark done.
#[derive(InputObject)]
pub struct WorkFeedDoneItemInput {
    /// The item's id.
    pub id: ID,
    /// The entry's `revision` the caller observed. Reasons newer than it
    /// stay active. Omit to acknowledge everything current.
    pub revision: Option<String>,
}

/// Input for marking work feed items done.
#[derive(InputObject)]
pub struct MarkWorkFeedItemsDoneInput {
    /// The items to complete, at most 200.
    pub items: Vec<WorkFeedDoneItemInput>,
}

impl MarkWorkFeedItemsDoneInput {
    /// Validate and convert into domain done targets.
    pub(crate) fn into_targets(self) -> async_graphql::Result<Vec<WorkFeedDoneTarget>> {
        if self.items.len() > MAX_DONE_ITEMS {
            return Err(async_graphql::Error::new(format!(
                "at most {MAX_DONE_ITEMS} items can be marked done at once"
            )));
        }
        self.items
            .into_iter()
            .map(|item| {
                let key = WorkFeedItemKey::parse(&item.id)
                    .map_err(|_| async_graphql::Error::new("invalid work feed item id"))?;
                let revision = item
                    .revision
                    .map(|revision| WorkFeedRevision::decode(&revision))
                    .transpose()
                    .map_err(|_| async_graphql::Error::new("invalid work feed revision"))?;
                Ok(WorkFeedDoneTarget { key, revision })
            })
            .collect()
    }
}

/// Input for undoing one mark-done.
#[derive(InputObject)]
pub struct UndoWorkFeedItemsDoneInput {
    /// The `undoToken` the mark-done returned.
    pub undo_token: String,
    /// The feed the restored items are placed in.
    pub scope: Option<WorkFeedScopeInput>,
}
