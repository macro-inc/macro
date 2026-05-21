use agent::AgentModel;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ToolServiceContext;

static SUBAGENT_MODEL: AgentModel = AgentModel::Smart;

static SUBAGENT_PROMPT: &str = include_str!("prompts/subagent.md");

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

#[async_trait]
impl AsyncTool<ToolServiceContext> for Subagent {
    type Output = SubagentResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        _service_context: ServiceContext<ToolServiceContext>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let result = agent::complete(SUBAGENT_MODEL, SUBAGENT_PROMPT, &self.task)
            .await
            .map_err(|e| ToolCallError {
                description: "subagent encountered an error".to_string(),
                internal_error: e,
            })?;

        Ok(SubagentResponse { result })
    }
}
