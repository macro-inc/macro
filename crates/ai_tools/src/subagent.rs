use crate::{ToolServiceContext, ai_operations::complete_subagent};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

fn subagent_error(error: anyhow::Error) -> ToolCallError {
    let description = match error.downcast_ref::<ai_billing::domain::AiAdmissionError>() {
        Some(admission) => admission.to_string(),
        None => "subagent encountered an error".to_owned(),
    };
    ToolCallError {
        description,
        internal_error: error,
    }
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct SubagentResponse {
    pub result: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "Subagent",
    description = "Delegate a task to a subagent that can independently use tools to research and complete it. The subagent has access to search, documents, properties, calls, and channel tools. Use this for tasks that require multiple tool calls or independent research."
)]
pub struct Subagent {
    #[schemars(
        description = "A detailed description of the task for the subagent to complete. Be specific about what information to find or what action to take."
    )]
    pub task: String,
}

impl ToolAnnotated for Subagent {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delegate to subagent").with_open_world();
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for Subagent {
    type Output = SubagentResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<ToolServiceContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        complete_subagent(
            service_context.admission.as_ref(),
            service_context.recorder.as_ref(),
            &service_context.usage_context,
            request_context.user_id,
            &self.task,
            &request_context.cancel,
        )
        .await
        .map(|result| SubagentResponse { result })
        .map_err(subagent_error)
    }
}
