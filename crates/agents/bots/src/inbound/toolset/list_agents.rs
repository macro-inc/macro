//! ListAgents tool.

use super::{AgentSummary, BotToolContext, bot_tool_error};
use crate::domain::ports::BotService;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Response from [`ListAgents`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentsResponse {
    /// Agents the caller can manage, with their current instructions and settings.
    pub agents: Vec<AgentSummary>,
    /// Human-readable result summary.
    pub summary: String,
}

/// List the agents the user can manage, with their full configuration.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[schemars(
    title = "ListAgents",
    description = "List every AI agent the current user can manage - their own, their teams', and channel agents they can mention - with each agent's current instructions and settings: harness, model, channel availability, connected apps, permission behavior, and whether it is a coding or chat agent. Use this to find an agent's botId and read its current configuration before changing it with ConfigureAgent. ListBots covers plain webhook bots instead."
)]
pub struct ListAgents {}

impl ToolAnnotated for ListAgents {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List agents");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for ListAgents
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = ListAgentsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let agents: Vec<AgentSummary> = service_context
            .service
            .list_agents(request_context.user_id)
            .await
            .map_err(|error| bot_tool_error("list agents", error))?
            .into_iter()
            .map(AgentSummary::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        let summary = match agents.len() {
            0 => "No manageable agents found.".to_string(),
            1 => "Found 1 manageable agent.".to_string(),
            count => format!("Found {count} manageable agents."),
        };

        Ok(ListAgentsResponse { agents, summary })
    }
}
