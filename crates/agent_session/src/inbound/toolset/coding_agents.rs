//! Unified session launch tool and historical coding-tool schemas.
//! User identity always comes from the authenticated tool request.

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

/// Shared session-launch capability used by every AI host.
#[derive(Clone)]
pub struct CodingAgentToolContext {
    /// Discovery, authorization, and dispatch remain in the domain service.
    pub service: Arc<dyn CodingAgentService>,
}

/// Discover the user's available coding personas before selecting one.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ListCodingAgents",
    description = "Find the coding agents available to the current user. Call this before delegating coding work. Choose an agent using its name, description, instructions, runtime, and model, preferring the user's requested agent or the persona best suited to the repository and task. Returns only available coding agents. If none are available, explain that the user needs to connect or configure a coding agent."
)]
pub struct ListCodingAgents {}

/// Available coding personas and their task-selection context.
#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct ListCodingAgentsResponse {
    /// Personas the user can currently dispatch.
    pub agents: Vec<CodingAgent>,
}

/// Start the selected coding agent on one complete task.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
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

/// Start a real agent session using the same choices as the agent picker.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "StartAgentSession",
    description = "Start an agent session with a self-contained task. Select a saved agent by its exact name, mention handle, or bot id (use ListAgents for configuration), or use cursor for the Cursor integration. Omit agent to start an in-memory session with an optional model. Saved agents retain their instructions and connected apps. Returns a live session reference once the first prompt is accepted, not the completed task. Do not automatically retry an uncertain launch."
)]
pub struct StartAgentSession {
    /// Exact agent name, mention handle, or bot UUID. Omit for an in-memory model session.
    pub agent: Option<String>,
    /// Complete task and context; the child does not inherit the conversation.
    pub prompt: String,
    /// Optional model override; otherwise use the persona's configured model.
    pub model: Option<String>,
    /// Explicit GitHub repository URL for Cursor; task text does not select a repository.
    pub repo_url: Option<String>,
    /// Starting branch; requires repo_url and a runtime that supports branch selection.
    pub repo_branch: Option<String>,
}

impl ToolAnnotated for StartAgentSession {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Start agent session").with_open_world();
}

#[async_trait]
impl AsyncTool<CodingAgentToolContext> for StartAgentSession {
    type Output = DispatchedCodingAgent;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<CodingAgentToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let agent_id = self
            .agent
            .as_deref()
            .and_then(|agent| Uuid::parse_str(agent.trim()).ok());
        context
            .service
            .dispatch(DispatchCodingAgentRequest {
                user_id: request.user_id,
                agent_id,
                agent_name: self.agent.clone().filter(|_| agent_id.is_none()),
                prompt: self.prompt.clone(),
                model: self.model.clone(),
                repo_url: self.repo_url.clone(),
                repo_branch: self.repo_branch.clone(),
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

/// The single session-launch tool exposed to AI hosts.
pub fn coding_agent_toolset() -> AsyncToolCollection<CodingAgentToolContext> {
    AsyncToolCollection::new().add_tool::<StartAgentSession, CodingAgentToolContext>()
}
