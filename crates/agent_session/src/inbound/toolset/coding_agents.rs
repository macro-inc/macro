//! Coding delegation tools. User identity always comes from the tool request.

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::coding_agents::{
    CodingAgent, CodingAgentError, CodingAgentService, DispatchCodingAgentRequest,
    DispatchedCodingAgent,
};

#[cfg(test)]
mod test;

/// Shared coding-session capability used by non-coding agents.
#[derive(Clone)]
pub struct CodingAgentToolContext {
    /// Discovery, authorization, and dispatch remain in the domain service.
    pub service: Arc<dyn CodingAgentService>,
}

/// Discover the user's available coding personas before selecting one.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ListCodingAgents",
    description = "Find the coding agents available to the current user. Call this before delegating coding work. Choose an agent using its name, description, instructions, runtime, and model, preferring the user's requested agent or the persona best suited to the repository and task. Returns only available coding agents. If none are available, explain that the user needs to connect or configure a coding agent."
)]
pub struct ListCodingAgents {}

/// Available coding personas and their task-selection context.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ListCodingAgentsResponse {
    /// Personas the user can currently dispatch.
    pub agents: Vec<CodingAgent>,
}

impl ToolAnnotated for ListCodingAgents {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List coding agents");
}

#[async_trait]
impl AsyncTool<CodingAgentToolContext> for ListCodingAgents {
    type Output = ListCodingAgentsResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<CodingAgentToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(ListCodingAgentsResponse {
            agents: context
                .service
                .list(request.user_id)
                .await
                .map_err(tool_error)?,
        })
    }
}

/// Start the selected coding agent on one complete task.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "DispatchCodingAgent",
    description = "Start a new coding agent session for a task using an agent returned by ListCodingAgents. Pass a self-contained task with the relevant repository, requirements, findings, and acceptance criteria; the coding agent does not inherit this conversation. Returns a live session reference after its first prompt is accepted, not completed code. Dispatch once per task and do not retry automatically after an uncertain failure."
)]
pub struct DispatchCodingAgent {
    /// Agent chosen from the current user's discovery result.
    #[schemars(description = "The id of the best-suited coding agent from ListCodingAgents")]
    pub agent_id: Uuid,
    /// Full task handed to the new session.
    #[schemars(
        description = "Self-contained coding task, including the repository, relevant context, requirements, and desired outcome"
    )]
    pub prompt: String,
}

impl ToolAnnotated for DispatchCodingAgent {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Dispatch coding agent").with_open_world();
}

#[async_trait]
impl AsyncTool<CodingAgentToolContext> for DispatchCodingAgent {
    type Output = DispatchedCodingAgent;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<CodingAgentToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .dispatch(DispatchCodingAgentRequest {
                user_id: request.user_id,
                agent_id: self.agent_id,
                prompt: self.prompt.clone(),
            })
            .await
            .map_err(tool_error)
    }
}

fn tool_error(error: CodingAgentError) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: error.into(),
    }
}

/// Discovery and delegation for non-coding agent hosts.
pub fn coding_agent_toolset() -> AsyncToolCollection<CodingAgentToolContext> {
    AsyncToolCollection::new()
        .add_tool::<ListCodingAgents, CodingAgentToolContext>()
        .add_tool::<DispatchCodingAgent, CodingAgentToolContext>()
}
