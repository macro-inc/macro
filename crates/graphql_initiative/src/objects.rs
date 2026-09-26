//! Normalized initiative entities and embedded value objects.

use async_graphql::{Context, Enum, ID, Object, SimpleObject};
use chrono::{DateTime, Utc};
use graphql_common::require_authenticated_user;
use graphql_permission::GraphqlEntityAccessLevel;
use graphql_soup::SoupEntityEdges;
use initiative::domain::{
    models::{
        AssignTaskStatus, AssignTasksResult, InitiativeDetail, InitiativeId, InitiativeSummary,
    },
    reads::{
        InitiativePage, InitiativePageRow, InitiativePropertySnapshot, InitiativeReference,
        InitiativeTasksPage, TaskInitiativeReference,
    },
};
use models_permissions::share_permission::SharePermissionV2;
use tokio::sync::OnceCell;

use crate::{InitiativeGraphqlContext, graphql_error, inputs::GraphqlInitiativeLinkShare};

/// One globally identified initiative, shared across collection/detail/mutation results.
pub struct GraphqlInitiative<E: SoupEntityEdges> {
    id: InitiativeId,
    name: String,
    identity: Option<InitiativeSummary>,
    access: Option<GraphqlEntityAccessLevel>,
    detail: OnceCell<InitiativeDetail>,
    summary: OnceCell<InitiativePageRow>,
    edges: E,
}

impl<E: SoupEntityEdges> GraphqlInitiative<E> {
    pub(crate) fn from_detail(detail: InitiativeDetail) -> Self {
        let identity = InitiativeSummary {
            id: detail.id,
            name: detail.name.clone(),
            description_document_id: detail.description_document_id,
            updated_at: detail.updated_at,
        };
        Self {
            id: detail.id,
            name: detail.name.clone(),
            edges: E::from_entity(
                model_entity::EntityType::Initiative.with_entity_string(detail.id.to_string()),
            ),
            access: Some(GraphqlEntityAccessLevel::new(detail.user_access_level)),
            identity: Some(identity),
            detail: OnceCell::new_with(Some(detail)),
            summary: OnceCell::new(),
        }
    }

    fn from_row(row: InitiativePageRow) -> Self {
        Self {
            id: row.initiative.id,
            name: row.initiative.name.clone(),
            identity: Some(row.initiative.clone()),
            access: Some(GraphqlEntityAccessLevel::new(row.user_access_level)),
            edges: E::from_entity(
                model_entity::EntityType::Initiative
                    .with_entity_string(row.initiative.id.to_string()),
            ),
            detail: OnceCell::new(),
            summary: OnceCell::new_with(Some(row)),
        }
    }

    fn from_reference(reference: InitiativeReference) -> Self {
        Self {
            id: reference.id,
            name: reference.name,
            identity: None,
            access: None,
            detail: OnceCell::new(),
            summary: OnceCell::new(),
            edges: E::from_entity(
                model_entity::EntityType::Initiative.with_entity_string(reference.id.to_string()),
            ),
        }
    }

    async fn load_detail(&self, ctx: &Context<'_>) -> async_graphql::Result<&InitiativeDetail> {
        self.detail
            .get_or_try_init(|| async {
                let user = require_authenticated_user(ctx)?;
                ctx.data::<InitiativeGraphqlContext>()?
                    .0
                    .get(user, self.id.as_uuid())
                    .await
                    .map_err(graphql_error)
            })
            .await
    }

    async fn load_summary(&self, ctx: &Context<'_>) -> async_graphql::Result<&InitiativePageRow> {
        self.summary
            .get_or_try_init(|| async {
                let user = require_authenticated_user(ctx)?;
                ctx.data::<InitiativeGraphqlContext>()?
                    .0
                    .summary(user, self.id.as_uuid())
                    .await
                    .map_err(graphql_error)
            })
            .await
    }
}

/// A project entity shared by list, detail, relationship, and mutation reads.
#[Object(name = "GraphqlInitiative")]
impl<E: SoupEntityEdges> GraphqlInitiative<E> {
    /// Stable global initiative identifier.
    async fn id(&self) -> ID {
        ID(self.id.to_string())
    }
    /// Display name.
    async fn name(&self) -> &str {
        &self.name
    }
    /// Backing Markdown document identifier.
    async fn description_document_id(&self, ctx: &Context<'_>) -> async_graphql::Result<ID> {
        let id = match &self.identity {
            Some(identity) => identity.description_document_id,
            None => self.load_detail(ctx).await?.description_document_id,
        };
        Ok(ID(id.to_string()))
    }
    /// Last initiative update.
    async fn updated_at(&self, ctx: &Context<'_>) -> async_graphql::Result<DateTime<Utc>> {
        Ok(match &self.identity {
            Some(identity) => identity.updated_at,
            None => self.load_detail(ctx).await?.updated_at,
        })
    }
    /// Effective access held by this request's viewer.
    async fn user_access_level(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlEntityAccessLevel> {
        Ok(match self.access {
            Some(access) => access,
            None => GraphqlEntityAccessLevel::new(self.load_detail(ctx).await?.user_access_level),
        })
    }
    /// Owner of the initiative.
    async fn owner_id(&self, ctx: &Context<'_>) -> async_graphql::Result<String> {
        Ok(self.load_detail(ctx).await?.owner_id.to_string())
    }
    /// Collaborators, independent of assignees.
    async fn member_ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<String>> {
        Ok(self
            .load_detail(ctx)
            .await?
            .member_ids
            .iter()
            .map(ToString::to_string)
            .collect())
    }
    /// Associated task identifiers visible to this viewer.
    async fn task_ids(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<ID>> {
        Ok(self
            .load_detail(ctx)
            .await?
            .task_ids
            .iter()
            .cloned()
            .map(ID)
            .collect())
    }
    /// Creation time.
    async fn created_at(&self, ctx: &Context<'_>) -> async_graphql::Result<DateTime<Utc>> {
        Ok(self.load_detail(ctx).await?.created_at)
    }
    /// Current sharing state.
    async fn share_permission(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlInitiativeSharePermission> {
        Ok(self.load_detail(ctx).await?.share_permission.clone().into())
    }
    /// Canonical typed property assignments, batched by the shared request loader.
    async fn properties(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<E::Property>> {
        self.edges.resolve_properties(ctx).await
    }
    /// Canonical system property snapshot used by collection filtering and progress.
    async fn property_snapshot(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlInitiativePropertySnapshot> {
        Ok(self.load_summary(ctx).await?.properties.clone().into())
    }
    /// Associated tasks this viewer can see.
    async fn task_count(&self, ctx: &Context<'_>) -> async_graphql::Result<u32> {
        Ok(self.load_summary(ctx).await?.task_count)
    }
    /// Completed associated tasks this viewer can see.
    async fn completed_task_count(&self, ctx: &Context<'_>) -> async_graphql::Result<u32> {
        Ok(self.load_summary(ctx).await?.completed_task_count)
    }
}

/// A collection page; membership and cursor belong to this request, not a cache entity.
#[derive(SimpleObject)]
#[graphql(name = "InitiativePage")]
pub struct GraphqlInitiativePage<E: SoupEntityEdges> {
    /// Initiatives in the requested order.
    pub initiatives: Vec<GraphqlInitiative<E>>,
    /// Continuation when another page exists.
    pub next_cursor: Option<String>,
}

impl<E: SoupEntityEdges> From<InitiativePage> for GraphqlInitiativePage<E> {
    fn from(value: InitiativePage) -> Self {
        Self {
            initiatives: value
                .initiatives
                .into_iter()
                .map(GraphqlInitiative::from_row)
                .collect(),
            next_cursor: value.next_cursor,
        }
    }
}

/// Snapshot of canonical system property values.
#[derive(SimpleObject)]
#[graphql(name = "InitiativePropertySnapshot")]
pub struct GraphqlInitiativePropertySnapshot {
    /// Selected status option identifier.
    status: Option<ID>,
    /// Selected priority option identifier.
    priority: Option<ID>,
    /// Assigned user identifiers.
    assignees: Vec<String>,
    /// Optional due timestamp.
    due_date: Option<DateTime<Utc>>,
    /// Whether the canonical status represents completion.
    completed: bool,
}

impl From<InitiativePropertySnapshot> for GraphqlInitiativePropertySnapshot {
    fn from(value: InitiativePropertySnapshot) -> Self {
        Self {
            status: value.status.map(|id| ID(id.to_string())),
            priority: value.priority.map(|id| ID(id.to_string())),
            assignees: value.assignees,
            due_date: value.due_date,
            completed: value.completed,
        }
    }
}

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
    initiative: Option<GraphqlInitiative<E>>,
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
                Some(GraphqlInitiative::from_reference(initiative)),
            ),
        };
        Self {
            task_id,
            state,
            initiative,
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
    async fn initiative(&self) -> Option<&GraphqlInitiative<E>> {
        self.initiative.as_ref()
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
