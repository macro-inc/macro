//! UnassignTasksFromInitiative tool for moving tasks out of an initiative.

use activity::domain::ports::EntityActivityReads;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::models::{EditAccessLevel, EntityType};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{InitiativeToolContext, failure, required_task_batch};
use crate::domain::models::InitiativeError;
use crate::domain::ports::InitiativeService;

/// Response from [`UnassignTasksFromInitiative`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnassignTasksFromInitiativeResponse {
    /// The id of the initiative the tasks were removed from.
    pub initiative_id: uuid::Uuid,
    /// Outcomes in request order after removing duplicates.
    pub results: Vec<TaskUnassignmentOutcome>,
}

/// The result of removing one task from an initiative.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskUnassignmentOutcome {
    /// The task id this outcome describes.
    pub task_id: String,
    /// What happened to the task.
    pub status: TaskUnassignmentStatus,
}

/// Tool-facing status of a task unassignment.
#[derive(Debug, Serialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskUnassignmentStatus {
    /// Removed from this initiative.
    Unassigned,
    /// The task was not assigned to this initiative.
    NotAssigned,
}

/// UnassignTasksFromInitiative tool input.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UnassignTasksFromInitiative",
    description = "Move tasks out of a specific initiative (project). Requires edit access to the initiative and each task; at most 100 unique tasks. Returns one status per task id: unassigned, or not_assigned when the task was not in this initiative. Tasks in other initiatives are left unchanged. An access or service failure stops the batch; earlier removals may have succeeded."
)]
pub struct UnassignTasksFromInitiative {
    /// The id of the initiative to remove tasks from.
    #[schemars(
        description = "The id of the initiative to remove tasks from. Requires edit access."
    )]
    pub initiative_id: uuid::Uuid,
    /// Task document ids to remove, in request order.
    #[schemars(
        description = "Task document ids to remove. Provide at least one and at most 100 unique ids; duplicates are ignored. Requires edit access to each task."
    )]
    pub task_ids: Vec<String>,
}

impl ToolAnnotated for UnassignTasksFromInitiative {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Unassign tasks from initiative").with_idempotent();
}

#[async_trait]
impl<ISvc, ESvc, R> AsyncTool<InitiativeToolContext<ISvc, ESvc, R>> for UnassignTasksFromInitiative
where
    ISvc: InitiativeService,
    ESvc: EntityAccessService,
    R: EntityActivityReads,
{
    type Output = UnassignTasksFromInitiativeResponse;

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

        let mut results = Vec::with_capacity(task_ids.len());
        for task_id in task_ids {
            let task_receipt = service_context
                .receipt::<EditAccessLevel>(&request_context, &task_id, EntityType::Document)
                .await?;
            let status = match service_context
                .service
                .unassign_task(receipt.clone(), task_receipt)
                .await
            {
                Ok(()) => TaskUnassignmentStatus::Unassigned,
                Err(InitiativeError::NotFound) => TaskUnassignmentStatus::NotAssigned,
                Err(error) => return Err(failure(error)),
            };
            results.push(TaskUnassignmentOutcome { task_id, status });
        }

        Ok(UnassignTasksFromInitiativeResponse {
            initiative_id: self.initiative_id,
            results,
        })
    }
}
