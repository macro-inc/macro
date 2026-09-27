//! Initiative sharing values and task relationships.

use std::marker::PhantomData;

use async_graphql::{Context, Enum, ID, Object, SimpleObject};
use graphql_permission::GraphqlEntityAccessLevel;
use graphql_soup::{GraphqlSoupInitiative, SoupEntityEdges};
use initiative::domain::{
    models::{AssignTaskStatus, AssignTasksResult, InitiativeId},
    reads::{InitiativeTasksPage, TaskInitiativeReference},
};
use models_permissions::share_permission::SharePermissionV2;

use crate::{inputs::GraphqlInitiativeLinkShare, query::load_initiative};

/// Typed sharing state for an initiative.
#[derive(SimpleObject)]
#[graphql(name = "InitiativeSharePermission")]
pub struct GraphqlInitiativeSharePermission {
    /// Stable identifier of the sharing policy.
    id: ID,
    /// Audience permitted through the link, when enabled.
    link_share: Option<GraphqlInitiativeLinkShare>,
    /// Permission granted to the link audience.
    link_share_access_level: Option<GraphqlEntityAccessLevel>,
    /// Explicit permission granted to the owner's team.
    team_share_access_level: Option<GraphqlEntityAccessLevel>,
    /// Owner of the shared initiative.
    owner: String,
    /// Explicit channel sharing grants.
    channel_share_permissions: Vec<GraphqlInitiativeChannelShare>,
}

/// Grant to a shared channel.
#[derive(SimpleObject)]
#[graphql(name = "InitiativeChannelShare")]
pub struct GraphqlInitiativeChannelShare {
    /// Channel receiving access.
    channel_id: ID,
    /// Access granted to the channel.
    access_level: GraphqlEntityAccessLevel,
}

impl From<SharePermissionV2> for GraphqlInitiativeSharePermission {
    fn from(value: SharePermissionV2) -> Self {
        Self {
            id: ID(value.id),
            owner: value.owner,
            link_share: value.link_share.map(Into::into),
            link_share_access_level: value
                .link_share_access_level
                .map(GraphqlEntityAccessLevel::new),
            team_share_access_level: value
                .team_share_access_level
                .map(GraphqlEntityAccessLevel::new),
            channel_share_permissions: value
                .channel_share_permissions
                .unwrap_or_default()
                .into_iter()
                .map(|grant| GraphqlInitiativeChannelShare {
                    channel_id: ID(grant.channel_id),
                    access_level: GraphqlEntityAccessLevel::new(grant.access_level),
                })
                .collect(),
        }
    }
}

/// A page of visible task references.
#[derive(SimpleObject)]
#[graphql(name = "InitiativeTasksPage")]
pub struct GraphqlInitiativeTasksPage {
    /// Visible task identifiers in the current page.
    task_ids: Vec<ID>,
    /// Continuation when another visible page exists.
    next_cursor: Option<String>,
    /// Total tasks visible to this viewer.
    total: u32,
}

impl From<InitiativeTasksPage> for GraphqlInitiativeTasksPage {
    fn from(value: InitiativeTasksPage) -> Self {
        Self {
            task_ids: value.task_ids.into_iter().map(ID).collect(),
            next_cursor: value.next_cursor,
            total: value.total,
        }
    }
}

/// Visibility state of a task's initiative.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
#[graphql(name = "TaskInitiativeReferenceState")]
pub enum GraphqlTaskInitiativeReferenceState {
    /// Visible task without an initiative.
    None,
    /// Task or initiative cannot be viewed.
    Unavailable,
    /// Both task and initiative can be viewed.
    Visible,
}

/// Permission-filtered task-to-initiative relationship.
pub struct GraphqlTaskInitiativeReference<E: SoupEntityEdges> {
    task_id: String,
    state: GraphqlTaskInitiativeReferenceState,
    initiative_id: Option<InitiativeId>,
    _edges: PhantomData<E>,
}

impl<E: SoupEntityEdges> From<TaskInitiativeReference> for GraphqlTaskInitiativeReference<E> {
    fn from(value: TaskInitiativeReference) -> Self {
        let (task_id, state, initiative) = match value {
            TaskInitiativeReference::None { task_id } => {
                (task_id, GraphqlTaskInitiativeReferenceState::None, None)
            }
            TaskInitiativeReference::Unavailable { task_id } => (
                task_id,
                GraphqlTaskInitiativeReferenceState::Unavailable,
                None,
            ),
            TaskInitiativeReference::Visible {
                task_id,
                initiative,
            } => (
                task_id,
                GraphqlTaskInitiativeReferenceState::Visible,
                Some(initiative.id),
            ),
        };
        Self {
            task_id,
            state,
            initiative_id: initiative,
            _edges: PhantomData,
        }
    }
}

/// Permission-filtered relationship between a task and its project.
#[Object(name = "TaskInitiativeReference")]
impl<E: SoupEntityEdges> GraphqlTaskInitiativeReference<E> {
    /// Task whose relationship is described, never this object's identity.
    async fn task_id(&self) -> ID {
        ID(self.task_id.clone())
    }
    /// Permission-filtered relationship state.
    async fn state(&self) -> GraphqlTaskInitiativeReferenceState {
        self.state
    }
    /// The same initiative entity used by collection/detail queries.
    async fn initiative(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupInitiative<E>>> {
        let Some(id) = self.initiative_id else {
            return Ok(None);
        };
        load_initiative(ctx, id.as_uuid()).await
    }
}

/// Per-task result of an assignment request.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
#[graphql(name = "InitiativeTaskAssignmentStatus")]
pub enum GraphqlInitiativeTaskAssignmentStatus {
    /// Newly assigned or already assigned here.
    Assigned,
    /// Moved from another initiative.
    Moved,
    /// Document exists but is not a task.
    NotATask,
    /// Task could not be found.
    NotFound,
    /// Viewer cannot edit this task.
    SkippedNoPermission,
}

/// One result in the deduplicated request order.
#[derive(SimpleObject)]
#[graphql(name = "InitiativeTaskAssignment")]
pub struct GraphqlInitiativeTaskAssignment {
    /// Task whose assignment was attempted.
    task_id: ID,
    /// Domain result of this assignment.
    status: GraphqlInitiativeTaskAssignmentStatus,
}

impl From<AssignTasksResult> for GraphqlInitiativeTaskAssignment {
    fn from(value: AssignTasksResult) -> Self {
        Self {
            task_id: ID(value.task_id),
            status: match value.status {
                AssignTaskStatus::Assigned => GraphqlInitiativeTaskAssignmentStatus::Assigned,
                AssignTaskStatus::Moved => GraphqlInitiativeTaskAssignmentStatus::Moved,
                AssignTaskStatus::NotATask => GraphqlInitiativeTaskAssignmentStatus::NotATask,
                AssignTaskStatus::NotFound => GraphqlInitiativeTaskAssignmentStatus::NotFound,
                AssignTaskStatus::SkippedNoPermission => {
                    GraphqlInitiativeTaskAssignmentStatus::SkippedNoPermission
                }
            },
        }
    }
}
