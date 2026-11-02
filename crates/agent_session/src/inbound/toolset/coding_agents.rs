//! Agent session tools. User identity always comes from the tool request.

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::coding_agents::{
    CodingAgentError, CodingAgentService, DispatchCodingAgentRequest, DispatchedCodingAgent,
};
use crate::domain::updates::AgentUpdates;

#[cfg(test)]
mod test;

/// Shared coding-session capability used by non-coding agents.
#[derive(Clone)]
pub struct CodingAgentToolContext {
    /// Persona authorization and session creation remain in the domain service.
    pub service: Arc<dyn CodingAgentService>,
    /// Existing-session actions through the owning harness service.
    pub sessions: Arc<dyn crate::domain::tool_actions::SessionActions>,
}

/// Read the current user's coding sessions that need attention.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ListAgentUpdates",
    description = "List the current user's coding-agent sessions waiting for an answer or stalled for over 20 minutes. The user answers permissions and questions through the cards Macro renders from this tool's result. To send a coding agent instructions, use ManageAgentSession with a prompt. To recall the user's earlier decisions about these agents, search earlier agent conversations with ContentSearch (entity_types agent_sessions) and read them with ReadAgentSession."
)]
pub struct ListAgentUpdates {}

impl ToolAnnotated for ListAgentUpdates {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read agent updates");
}

#[async_trait]
impl AsyncTool<CodingAgentToolContext> for ListAgentUpdates {
    type Output = AgentUpdates;

    async fn call(
        &self,
        context: ServiceContext<CodingAgentToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .list_updates(request.user_id)
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

/// Session creation and management for agent hosts.
pub fn coding_agent_toolset() -> AsyncToolCollection<CodingAgentToolContext> {
    AsyncToolCollection::new()
        .add_tool::<super::manage_agent_session::ManageAgentSession, CodingAgentToolContext>()
        .add_tool::<CreateAgentSession, CodingAgentToolContext>()
        .add_tool::<ListAgentUpdates, CodingAgentToolContext>()
}

/// Start a new conversation with an existing agent persona.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "CreateAgentSession",
    description = "Start a new session with a coding or chat agent from ListAgents. Provide the agent botId and a self-contained initial prompt. The new session does not inherit this conversation. Returns its session ID after the first prompt is accepted, not completed work. Use ManageAgentSession to continue an existing session. Create once; do not automatically retry after an uncertain failure."
)]
pub struct CreateAgentSession {
    /// Agent persona botId from ListAgents.
    pub agent_id: Uuid,
    /// Complete initial task and relevant context.
    pub prompt: String,
}
impl ToolAnnotated for CreateAgentSession {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Create agent session").with_open_world();
}
#[async_trait]
impl AsyncTool<CodingAgentToolContext> for CreateAgentSession {
    type Output = DispatchedCodingAgent;
    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<CodingAgentToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .create(DispatchCodingAgentRequest {
                user_id: request.user_id,
                agent_id: self.agent_id,
                prompt: self.prompt.clone(),
            })
            .await
            .map_err(tool_error)
    }
}
