//! Task assignment with shared actor capabilities and bounded partial outcomes.

use super::*;
use crate::domain::models::{AssignTaskStatus, TaskAssignment, TaskAssignmentBatch};
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::{BotAccessScope, EditAccessLevel};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Set or clear the project associated with a bounded set of tasks.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "SetTaskInitiative",
    description = "Set the project associated with tasks, moving them from their previous project if needed. Requires edit access to each task and the destination project; access to the previous project is unnecessary. Omit initiativeId to clear the association using task edit access alone. Reports each task's outcome independently; at most 100 unique tasks."
)]
pub struct SetTaskInitiative {
    /// Task ids to assign or clear, deduplicated in request order.
    #[schemars(description = "Task ids to assign or clear, deduplicated in request order.")]
    pub task_ids: Vec<String>,
    /// Destination project; omit to clear each task's current project.
    #[schemars(description = "Destination project; omit to clear each task's current project.")]
    pub initiative_id: Option<Uuid>,
}

/// One task mutation outcome.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskProjectOutcome {
    /// Requested task identifier.
    pub task_id: String,
    /// assigned, moved, cleared, notATask, notFound, or skippedNoPermission.
    pub status: String,
}

/// Results in deduplicated input order.
#[derive(Debug, Serialize, JsonSchema)]
pub struct TaskProjectOutcomes {
    /// Outcome for every submitted task.
    pub results: Vec<TaskProjectOutcome>,
}

impl ToolAnnotated for SetTaskInitiative {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Set task project").with_idempotent();
}

#[async_trait]
impl<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>
    AsyncTool<InitiativeToolContext<S, A, R>> for SetTaskInitiative
{
    type Output = TaskProjectOutcomes;
    async fn call(
        &self,
        context: ServiceContext<InitiativeToolContext<S, A, R>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let ids = TaskAssignmentBatch::try_new(self.task_ids.clone())
            .map_err(failure)?
            .into_task_ids();
        let destination = if let Some(id) = self.initiative_id {
            Some(
                context
                    .receipt::<EditAccessLevel>(&request, &id.to_string(), EntityType::Initiative)
                    .await?,
            )
        } else {
            None
        };
        let mut assignments = Vec::with_capacity(ids.len());
        for id in ids {
            let access = context
                .access
                .generate_bot_entity_access_receipt::<EditAccessLevel>(
                    context.actor,
                    BotAccessScope::user(request.user_id.clone()),
                    &id,
                    EntityType::Document,
                )
                .await;
            assignments.push(TaskAssignment::from_access(id, access).map_err(failure)?);
        }
        let results = if let Some(destination) = destination {
            context
                .service
                .assign_tasks(destination, assignments)
                .await
                .map_err(failure)?
                .results
                .into_iter()
                .map(|outcome| TaskProjectOutcome {
                    task_id: outcome.task_id,
                    status: match outcome.status {
                        AssignTaskStatus::Assigned => "assigned",
                        AssignTaskStatus::Moved => "moved",
                        AssignTaskStatus::NotATask => "notATask",
                        AssignTaskStatus::NotFound => "notFound",
                        AssignTaskStatus::SkippedNoPermission => "skippedNoPermission",
                    }
                    .into(),
                })
                .collect()
        } else {
            let mut results = Vec::with_capacity(assignments.len());
            for assignment in assignments {
                let task_id = assignment.task_id().to_owned();
                let status = match assignment {
                    TaskAssignment::Authorized { receipt } => {
                        context.service.clear_task(receipt).await.map_err(failure)?;
                        "cleared"
                    }
                    TaskAssignment::NotFound { .. } => "notFound",
                    TaskAssignment::SkippedNoPermission { .. } => "skippedNoPermission",
                };
                results.push(TaskProjectOutcome {
                    task_id,
                    status: status.into(),
                });
            }
            results
        };
        Ok(TaskProjectOutcomes { results })
    }
}
