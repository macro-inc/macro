//! Independent outcomes for a bounded batch of task-side project clears.

use crate::domain::{
    models::{InitiativeError, MAX_TASKS_PER_ASSIGN, TaskAssignment},
    ports::InitiativeService,
};

/// Result of clearing one task's project association.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClearTaskStatus {
    /// The task is now unassigned, including an already-unassigned task.
    Cleared,
    /// The authorized document is not a task.
    NotATask,
    /// The task no longer exists.
    NotFound,
    /// The actor may not edit this task.
    SkippedNoPermission,
    /// This task failed; other tasks retain their independent outcomes.
    Failed,
}

/// A requested task and its independent clear outcome.
#[derive(Debug, PartialEq, Eq)]
pub struct ClearTaskOutcome {
    /// Requested task ID.
    pub task_id: String,
    /// Committed result or safe failure classification.
    pub status: ClearTaskStatus,
}

/// Clear authorized task associations without discarding earlier results on a later failure.
pub async fn clear_task_batch<S: InitiativeService>(
    service: &S,
    assignments: Vec<TaskAssignment>,
) -> Result<Vec<ClearTaskOutcome>, InitiativeError> {
    if assignments.len() > MAX_TASKS_PER_ASSIGN {
        return Err(InitiativeError::BadRequest(format!(
            "cannot clear more than {MAX_TASKS_PER_ASSIGN} tasks at once"
        )));
    }
    let mut results = Vec::with_capacity(assignments.len());
    for assignment in assignments {
        let task_id = assignment.task_id().to_owned();
        let status = match assignment {
            TaskAssignment::Authorized { receipt } => match service.clear_task(receipt).await {
                Ok(()) => ClearTaskStatus::Cleared,
                Err(InitiativeError::NotATask) => ClearTaskStatus::NotATask,
                Err(InitiativeError::NotFound) => ClearTaskStatus::NotFound,
                Err(InitiativeError::Unauthorized) => ClearTaskStatus::SkippedNoPermission,
                Err(error) => {
                    tracing::error!(error=?error, %task_id, "failed to clear task project association");
                    ClearTaskStatus::Failed
                }
            },
            TaskAssignment::NotFound { .. } => ClearTaskStatus::NotFound,
            TaskAssignment::SkippedNoPermission { .. } => ClearTaskStatus::SkippedNoPermission,
        };
        results.push(ClearTaskOutcome { task_id, status });
    }
    Ok(results)
}
