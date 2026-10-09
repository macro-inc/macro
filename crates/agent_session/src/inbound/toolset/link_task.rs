//! Link the calling session to the Macro task it works on.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

use super::SessionToolContext;
use crate::domain::session_task::LinkedTask;

/// Link the calling session to a task.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "link_task",
    description = "Link this coding session to the Macro task it works on, replacing any earlier link. The session's pull request, now or later, is linked to the task. Returns the task's id, title, link, and the reference to put in the pull request description."
)]
pub struct LinkTask {
    /// The task to link.
    #[schemars(
        description = "Macro task id, MACRO-<id> reference, or task link, e.g. https://macro.com/app/task/<id>"
    )]
    pub task: String,
}

impl ToolAnnotated for LinkTask {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Link task").with_idempotent();
}

#[async_trait]
impl AsyncTool<SessionToolContext> for LinkTask {
    type Output = LinkedTask;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<SessionToolContext>,
        request: RequestContext,
    ) -> ToolResult<LinkedTask> {
        context
            .tasks
            .link_task(context.session, &request.user_id, &self.task)
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: error.into(),
            })
    }
}
