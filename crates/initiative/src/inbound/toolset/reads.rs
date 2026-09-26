//! Semantic project reads with bounded results and explicit truncation.

use super::*;
use crate::domain::{
    history::{InitiativeActivityCursor, InitiativeActivityRecord},
    reads::{
        InitiativePageRequest, InitiativeTasksRequest, TaskInitiativeReference,
        TaskInitiativeReferencesRequest,
    },
};
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::models::ViewAccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Search projects using canonical property filters.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListInitiatives",
    description = "Find projects (initiatives), with canonical properties and progress over tasks you can view. Returns at most 100 recently updated matches per page. Pass nextCursor back as cursor with the same filters to read more. Filter by name, status, priority, assignee, or due date. Project folders use ReadProject instead."
)]
pub struct ListInitiatives {
    /// Case-insensitive project name substring.
    #[schemars(description = "Case-insensitive project name substring.")]
    pub query: Option<String>,
    /// Status option id, obtained from property definitions.
    #[schemars(description = "Status option id, obtained from property definitions.")]
    pub status: Option<Uuid>,
    /// Priority option id, obtained from property definitions.
    #[schemars(description = "Priority option id, obtained from property definitions.")]
    pub priority: Option<Uuid>,
    /// Assigned user id.
    #[schemars(description = "Assigned user id.")]
    pub assignee: Option<String>,
    /// Earliest inclusive due timestamp.
    #[schemars(description = "Earliest inclusive due timestamp.")]
    pub due_after: Option<DateTime<Utc>>,
    /// Latest inclusive due timestamp.
    #[schemars(description = "Latest inclusive due timestamp.")]
    pub due_before: Option<DateTime<Utc>>,
    /// Opaque nextCursor from the preceding page, with the same filters.
    #[schemars(description = "Opaque nextCursor from the preceding page, with the same filters.")]
    pub cursor: Option<String>,
    /// Maximum projects to return, from 1 through 100; defaults to 100.
    #[schemars(description = "Maximum projects to return, from 1 through 100; defaults to 100.")]
    pub limit: Option<u16>,
}

/// One visible project with canonical fields and permission-aware progress.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListRow {
    /// Project id.
    pub initiative_id: Uuid,
    /// Project name.
    pub name: String,
    /// Description document id.
    pub description_document_id: Uuid,
    /// Effective caller access.
    pub access: String,
    /// Canonical system properties.
    pub properties: ProjectPropertyValues,
    /// Count of associated tasks visible to the caller.
    pub task_count: u32,
    /// Visible completed tasks.
    pub completed_task_count: u32,
}

/// Bounded project search results.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResult {
    /// Matching visible projects.
    pub projects: Vec<ProjectListRow>,
    /// True when additional matches exist.
    pub truncated: bool,
    /// Opaque cursor for the next page, absent after the final page.
    pub next_cursor: Option<String>,
}

impl ToolAnnotated for ListInitiatives {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Find projects");
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for ListInitiatives
{
    type Output = ProjectListResult;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let page = context
            .service
            .page(
                &request.user_id,
                InitiativePageRequest {
                    limit: self.limit.or(Some(100)),
                    cursor: self.cursor.clone(),
                    query: self.query.clone(),
                    status: self.status,
                    priority: self.priority,
                    assignee: self.assignee.clone(),
                    due_after: self.due_after,
                    due_before: self.due_before,
                    ..Default::default()
                },
            )
            .await
            .map_err(failure)?;
        Ok(ProjectListResult {
            truncated: page.next_cursor.is_some(),
            next_cursor: page.next_cursor,
            projects: page
                .initiatives
                .into_iter()
                .map(|row| ProjectListRow {
                    initiative_id: row.initiative.id.as_uuid(),
                    name: row.initiative.name,
                    description_document_id: row.initiative.description_document_id.as_uuid(),
                    access: row.user_access_level.to_string(),
                    properties: row.properties.into(),
                    task_count: row.task_count,
                    completed_task_count: row.completed_task_count,
                })
                .collect(),
        })
    }
}

/// Read a project's metadata and visible task membership.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadInitiative",
    description = "Read a project, its sharing, canonical status/priority/assignees/due date, and a bounded page of associated task ids that you can view, with their total count. Pass nextTaskCursor back as taskCursor to read more task ids. Requires view access. The descriptionDocumentId can be read or edited with document tools. Use entityType initiative with property tools. Discussion and activity tools read the project's collaboration history."
)]
pub struct ReadInitiative {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Opaque nextTaskCursor from the preceding page for this project.
    #[schemars(description = "Opaque nextTaskCursor from the preceding page for this project.")]
    pub task_cursor: Option<String>,
    /// Maximum task ids to return, from 1 through 100; defaults to 100.
    #[schemars(description = "Maximum task ids to return, from 1 through 100; defaults to 100.")]
    pub task_limit: Option<u16>,
}

/// Project detail and canonical property values.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectReadResult {
    /// Project metadata and authorized task identifiers.
    #[schemars(description = "Project metadata and authorized task identifiers.")]
    pub project: ProjectDetails,
    /// Canonical system properties.
    #[schemars(description = "Canonical system properties.")]
    pub properties: ProjectPropertyValues,
    /// Opaque cursor for the next task page, absent after the final page.
    pub next_task_cursor: Option<String>,
}

impl ToolAnnotated for ReadInitiative {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read project");
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for ReadInitiative
{
    type Output = ProjectReadResult;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let id = self.initiative_id.to_string();
        let receipt = context
            .receipt::<ViewAccessLevel>(&request, &id, EntityType::Initiative)
            .await?;
        let properties = context
            .resources
            .properties(vec![receipt.clone()])
            .await
            .map_err(failure)?
            .remove(&id)
            .unwrap_or_default();
        let mut project: ProjectDetails = context
            .service
            .get(receipt.clone())
            .await
            .map_err(failure)?
            .into();
        let tasks = context
            .service
            .tasks_page(
                receipt,
                InitiativeTasksRequest {
                    limit: self.task_limit.or(Some(100)),
                    cursor: self.task_cursor.clone(),
                },
            )
            .await
            .map_err(failure)?;
        project.task_ids = tasks.task_ids;
        project.task_count = tasks.total as usize;
        project.tasks_truncated = tasks.next_cursor.is_some();
        Ok(ProjectReadResult {
            project,
            properties: properties.into(),
            next_task_cursor: tasks.next_cursor,
        })
    }
}

/// Resolve projects for a batch of tasks without exposing inaccessible projects.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadTaskInitiatives",
    description = "Find the project associated with each requested task. Returns project id/name only when both task and project are visible. Distinguishes no project from unavailable. Accepts up to 100 unique task ids."
)]
pub struct ReadTaskInitiatives {
    /// Task ids to look up, deduplicated in input order.
    #[schemars(description = "Task ids to look up, deduplicated in input order.")]
    pub task_ids: Vec<String>,
}

/// Privacy-preserving task project reference.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TaskProjectReference {
    /// Visible task with no project association.
    None {
        /// Requested task id.
        task_id: String,
    },
    /// Task or project is inaccessible.
    Unavailable {
        /// Requested task id.
        task_id: String,
    },
    /// Task and project are visible.
    Visible {
        /// Requested task id.
        task_id: String,
        /// Associated project id.
        initiative_id: Uuid,
        /// Associated project name.
        name: String,
    },
}

/// Visibility-aware project references for the requested tasks.
#[derive(Debug, Serialize, JsonSchema)]
pub struct TaskProjectReferences {
    /// References in deduplicated request order.
    pub references: Vec<TaskProjectReference>,
}

impl ToolAnnotated for ReadTaskInitiatives {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read task projects");
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for ReadTaskInitiatives
{
    type Output = TaskProjectReferences;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let result = context
            .service
            .task_references(
                &request.user_id,
                TaskInitiativeReferencesRequest {
                    task_ids: self.task_ids.clone(),
                },
            )
            .await
            .map_err(failure)?;
        Ok(TaskProjectReferences {
            references: result
                .references
                .into_iter()
                .map(|reference| match reference {
                    TaskInitiativeReference::None { task_id } => {
                        TaskProjectReference::None { task_id }
                    }
                    TaskInitiativeReference::Unavailable { task_id } => {
                        TaskProjectReference::Unavailable { task_id }
                    }
                    TaskInitiativeReference::Visible {
                        task_id,
                        initiative,
                    } => TaskProjectReference::Visible {
                        task_id,
                        initiative_id: initiative.id.as_uuid(),
                        name: initiative.name,
                    },
                })
                .collect(),
        })
    }
}

/// Read project history with current task permissions applied.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadInitiativeActivity",
    description = "Read project creation, edits, property changes, and task membership changes, newest first. Task references require current task view access. Each page scans at most 100 events and may contain fewer visible records. Pass nextCursor back as cursor with the same time filters to continue, including after an empty page. Discussions are read separately with ReadInitiativeDiscussions."
)]
pub struct ReadInitiativeActivity {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Only changes at or after this timestamp.
    #[schemars(description = "Only changes at or after this timestamp.")]
    pub after: Option<DateTime<Utc>>,
    /// Only changes before this timestamp.
    #[schemars(description = "Only changes before this timestamp.")]
    pub before: Option<DateTime<Utc>>,
    /// Opaque nextCursor from the preceding activity page.
    #[schemars(description = "Opaque nextCursor from the preceding activity page.")]
    pub cursor: Option<InitiativeActivityCursor>,
    /// Maximum events to scan, from 1 through 100; defaults to 100.
    #[schemars(description = "Maximum events to scan, from 1 through 100; defaults to 100.")]
    pub limit: Option<u16>,
}

/// Bounded visible project activity.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActivityResult {
    /// Visible events ordered newest first.
    pub records: Vec<InitiativeActivityRecord>,
    /// More events may match; follow nextCursor.
    pub truncated: bool,
    /// Stable continuation, absent after the final matching page.
    pub next_cursor: Option<InitiativeActivityCursor>,
}

impl ToolAnnotated for ReadInitiativeActivity {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read project activity");
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for ReadInitiativeActivity
{
    type Output = ProjectActivityResult;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<ViewAccessLevel>(
                &request,
                &self.initiative_id.to_string(),
                EntityType::Initiative,
            )
            .await?;
        if self
            .after
            .zip(self.before)
            .is_some_and(|(after, before)| after >= before)
        {
            return Err(failure(InitiativeError::BadRequest(
                "after must precede before".into(),
            )));
        }
        let cursor = self.cursor.clone().or_else(|| {
            self.before.map(|occurred_at| InitiativeActivityCursor {
                occurred_at,
                id: Uuid::nil(),
            })
        });
        let page = context
            .history
            .read(receipt, cursor, u32::from(self.limit.unwrap_or(100)))
            .await
            .map_err(failure)?;
        let next_cursor = page
            .next_cursor
            .filter(|cursor| self.after.is_none_or(|after| cursor.occurred_at >= after));
        let records = page
            .records
            .into_iter()
            .filter(|record| {
                self.after.is_none_or(|after| record.occurred_at >= after)
                    && self.before.is_none_or(|before| record.occurred_at < before)
            })
            .collect();
        Ok(ProjectActivityResult {
            records,
            truncated: next_cursor.is_some(),
            next_cursor,
        })
    }
}
