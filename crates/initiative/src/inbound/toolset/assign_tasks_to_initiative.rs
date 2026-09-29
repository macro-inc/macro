//! AssignTasksToInitiative tool for moving tasks into an initiative.

use activity::domain::ports::EntityActivityReads;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::models::{BotAccessScope, EditAccessLevel, EntityType};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{InitiativeToolContext, failure, required_task_batch};
use crate::domain::models::{AssignTaskStatus, TaskAssignment};
use crate::domain::ports::InitiativeService;

/// Response from [`AssignTasksToInitiative`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssignTasksToInitiativeResponse {
    /// The id of the initiative receiving the tasks.
    pub initiative_id: uuid::Uuid,
    /// Outcomes in request order after removing duplicates.
    pub results: Vec<TaskAssignmentOutcome>,
}

/// The result of assigning one task to an initiative.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskAssignmentOutcome {
    /// The task id this outcome describes.
    pub task_id: String,
    /// What happened to the task.
    pub status: TaskAssignmentStatus,
}

/// Tool-facing status of a task assignment.
#[derive(Debug, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskAssignmentStatus {
    /// Assigned to this initiative.
    Assigned,
    /// Moved from another initiative.
    Moved,
    /// The document exists but is not a task.
    NotATask,
    /// The task does not exist.
    NotFound,
    /// The caller cannot edit the task.
    SkippedNoPermission,
}

impl From<AssignTaskStatus> for TaskAssignmentStatus {
    fn from(status: AssignTaskStatus) -> Self {
        match status {
            AssignTaskStatus::Assigned => Self::Assigned,
            AssignTaskStatus::Moved => Self::Moved,
            AssignTaskStatus::NotATask => Self::NotATask,
            AssignTaskStatus::NotFound => Self::NotFound,
            AssignTaskStatus::SkippedNoPermission => Self::SkippedNoPermission,
        }
    }
}

/// AssignTasksToInitiative tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "AssignTasksToInitiative",
    description = "Move tasks into an initiative. A task already in another initiative is moved; duplicates are ignored; at most 100 unique task ids per call. Requires edit access to the initiative and to each task. Returns one status per task id: assigned, moved, not_a_task, not_found, or skipped_no_permission."
)]
pub struct AssignTasksToInitiative {
    /// The id of the initiative receiving the tasks.
    #[schemars(description = "The id of the initiative to assign tasks to. Requires edit access.")]
    pub initiative_id: uuid::Uuid,
    /// Task document ids to assign, in request order.
    #[schemars(
        description = "Task document ids to assign, at least one and at most 100 unique ids per call. Duplicates are ignored. Requires edit access to each task."
    )]
    pub task_ids: Vec<String>,
}

impl ToolAnnotated for AssignTasksToInitiative {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Assign tasks to initiative").with_idempotent();
}

#[async_trait]
impl<ISvc, ESvc, R> AsyncTool<InitiativeToolContext<ISvc, ESvc, R>> for AssignTasksToInitiative
where
    ISvc: InitiativeService,
    ESvc: EntityAccessService,
    R: EntityActivityReads,
{
    type Output = AssignTasksToInitiativeResponse;

    async fn call(
        &self,
        service_context: ServiceContext<InitiativeToolContext<ISvc, ESvc, R>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let task_ids = required_task_batch(self.task_ids.clone())?;

        let receipt = service_context
            .receipt::<EditAccessLevel>(
                &request_context,
                &self.initiative_id.to_string(),
                EntityType::Initiative,
            )
            .await?;

        let mut assignments = Vec::with_capacity(task_ids.len());
        for task_id in task_ids {
            let result = service_context
                .access
                .generate_bot_entity_access_receipt::<EditAccessLevel>(
                    service_context.actor,
                    BotAccessScope::user(request_context.user_id.clone()),
                    &task_id,
                    EntityType::Document,
                )
                .await;
            assignments.push(TaskAssignment::from_access(task_id, result).map_err(failure)?);
        }

        let response = service_context
            .service
            .assign_tasks(receipt, assignments)
            .await
            .map_err(failure)?;

        Ok(AssignTasksToInitiativeResponse {
            initiative_id: self.initiative_id,
            results: response
                .results
                .into_iter()
                .map(|result| TaskAssignmentOutcome {
                    task_id: result.task_id,
                    status: result.status.into(),
                })
                .collect(),
        })
    }
}
