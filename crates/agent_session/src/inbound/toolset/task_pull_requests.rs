//! The pull requests linked to a Macro task.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

use super::SessionToolContext;
use crate::domain::session_task::TaskPullRequests;

/// List a task's pull requests.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "task_pull_requests",
    description = "List the GitHub pull requests linked to a Macro task, with each one's URL, title and state (open, closed or merged; null until Macro has indexed it)."
)]
pub struct TaskPullRequestsTool {
    /// The task to look up.
    #[schemars(
        description = "Macro task id, MACRO-<id> reference, or task link, e.g. https://macro.com/app/task/<id>"
    )]
    pub task: String,
}

impl ToolAnnotated for TaskPullRequestsTool {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Task pull requests");
}

#[async_trait]
impl AsyncTool<SessionToolContext> for TaskPullRequestsTool {
    type Output = TaskPullRequests;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<SessionToolContext>,
        request: RequestContext,
    ) -> ToolResult<TaskPullRequests> {
        context
            .tasks
            .task_pull_requests(&request.user_id, &self.task)
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: error.into(),
            })
    }
}
