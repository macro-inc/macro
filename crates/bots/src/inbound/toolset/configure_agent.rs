//! ConfigureAgent tool.

use super::{
    AgentChannelScopeSummary, AgentMcpScopeSummary, AgentMcpServerSummary, AgentSummary,
    BotToolContext, bot_tool_error,
};
use crate::domain::{
    models::{
        AgentChannelSelection, AgentHarnessSelection, AgentMcpServer, AgentMcpServers, BotId,
        HarnessId, PatchAgentRequest,
    },
    ports::BotService,
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The runtimes an agent can be moved onto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub enum AgentHarnessOption {
    /// Macro's built-in chat agent; needs no connected account.
    #[serde(rename = "in-memory")]
    InMemory,
    /// A Cursor cloud agent on the session owner's Cursor account.
    #[serde(rename = "cursor")]
    Cursor,
    /// Claude Code on the session owner's Claude account.
    #[serde(rename = "claude-cloud")]
    ClaudeCloud,
    /// A registered self-hosted harness; requires `harnessId`.
    #[serde(rename = "macrod")]
    Macrod,
}

impl AgentHarnessOption {
    /// The slug the agent row stores.
    fn slug(self) -> &'static str {
        match self {
            Self::InMemory => "in-memory",
            Self::Cursor => "cursor",
            Self::ClaudeCloud => "claude-cloud",
            Self::Macrod => harness_id::MACROD_HARNESS_SLUG,
        }
    }
}

/// Response from [`ConfigureAgent`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureAgentResponse {
    /// The agent as configured now.
    pub agent: AgentSummary,
    /// Human-readable result summary naming what changed.
    pub summary: String,
}

/// Change an agent's instructions or settings.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ConfigureAgent",
    description = "Update the instructions or settings of an AI agent the current user can manage. Provide only the fields that should change; everything else keeps its current value. Read the agent first with ListAgents: instructions are replaced whole, so to edit them, apply the edit to the current text and pass the complete result. Changes apply to sessions opened afterwards; running sessions keep the instructions they started with. Use ConfigureBot for the display name, handle, description, or picture, and ManageBotChannelAccess for plain webhook bots."
)]
pub struct ConfigureAgent {
    /// Agent to configure.
    #[schemars(description = "The agent's bot id: `bot.botId` from ListAgents.")]
    pub bot_id: Uuid,
    /// Replacement instructions.
    #[schemars(
        description = "The complete new instructions in markdown. Replaces the current instructions entirely; omit to keep them."
    )]
    #[serde(default)]
    pub instructions: Option<String>,
    /// Replacement runtime.
    #[schemars(
        description = "Runtime to move the agent onto. `macrod` also needs harnessId; the other runtimes must not have one. The current model may not exist on the new runtime, so usually pass defaultModel with it. Omit to keep the current runtime."
    )]
    #[serde(default)]
    pub harness: Option<AgentHarnessOption>,
    /// Registered harness for the `macrod` runtime.
    #[schemars(
        description = "Id of the registered self-hosted harness, required when harness is `macrod` and forbidden otherwise."
    )]
    #[serde(default)]
    pub harness_id: Option<Uuid>,
    /// Replacement model.
    #[schemars(
        description = "Model id the agent's new sessions should use, as the runtime names it (e.g. `claude-sonnet-4-5`). Valid ids depend on the runtime. Omit to keep the current model."
    )]
    #[serde(default)]
    pub default_model: Option<String>,
    /// Replacement channel scope.
    #[schemars(
        description = "`all` makes the agent mentionable in every channel its owner can use; `selected` limits it to channelIds. Omit to keep the current scope, or omit it and pass channelIds alone to switch to `selected`."
    )]
    #[serde(default)]
    pub channel_scope: Option<AgentChannelScopeSummary>,
    /// Replacement channel list.
    #[schemars(
        description = "The complete list of channel ids the agent is limited to; the user must be a member of each. Required with the `selected` scope and forbidden with `all`."
    )]
    #[serde(default)]
    pub channel_ids: Option<Vec<Uuid>>,
    /// Replacement MCP scope.
    #[schemars(
        description = "`owner_connections` hands sessions whatever apps the person running them has connected; `selected` hands exactly mcpServers. Omit to keep the current scope, or omit it and pass mcpServers alone to switch to `selected`."
    )]
    #[serde(default)]
    pub mcp_scope: Option<AgentMcpScopeSummary>,
    /// Replacement MCP server list.
    #[schemars(
        description = "The complete list of connected apps for the `selected` MCP scope, each as its Pipedream app slug (e.g. `linear`) and display name. Forbidden with `owner_connections`."
    )]
    #[serde(default)]
    pub mcp_servers: Option<Vec<AgentMcpServerSummary>>,
    /// Replacement permission choice.
    #[schemars(
        description = "`true` lets sessions approve tool permission requests without asking, where the runtime allows it; `false` makes them ask every time. Omit to leave unchanged."
    )]
    #[serde(default)]
    pub auto_accept_permissions: Option<bool>,
    /// Replacement coding choice.
    #[schemars(
        description = "`true` for a coding agent, which works in a repository and answers a mention with a live session; `false` for a chat agent, which replies in the thread. Omit to leave unchanged."
    )]
    #[serde(default)]
    pub is_coding: Option<bool>,
}

impl ToolAnnotated for ConfigureAgent {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Configure agent");
}

fn invalid_arguments(description: &str) -> ToolCallError {
    ToolCallError {
        description: description.to_string(),
        internal_error: anyhow::anyhow!("invalid ConfigureAgent arguments: {description}"),
    }
}

impl ConfigureAgent {
    /// The names of the settings this call changes, for the summary.
    fn changed_fields(&self) -> Vec<&'static str> {
        [
            ("instructions", self.instructions.is_some()),
            ("runtime", self.harness.is_some()),
            ("model", self.default_model.is_some()),
            (
                "channels",
                self.channel_scope.is_some() || self.channel_ids.is_some(),
            ),
            (
                "connected apps",
                self.mcp_scope.is_some() || self.mcp_servers.is_some(),
            ),
            ("permissions", self.auto_accept_permissions.is_some()),
            ("coding mode", self.is_coding.is_some()),
        ]
        .into_iter()
        .filter_map(|(name, changed)| changed.then_some(name))
        .collect()
    }

    /// Translate the flat tool arguments into the domain patch, refusing
    /// combinations that name no coherent change.
    fn patch(&self) -> Result<PatchAgentRequest, ToolCallError> {
        let harness = match (self.harness, self.harness_id) {
            (Some(harness), harness_id) => Some(AgentHarnessSelection {
                harness: harness.slug().to_string(),
                harness_id: harness_id.map(HarnessId::new_from_uuid),
            }),
            (None, Some(_)) => {
                return Err(invalid_arguments(
                    "harnessId only applies together with harness `macrod`; pass harness too",
                ));
            }
            (None, None) => None,
        };

        let channels = match (self.channel_scope, &self.channel_ids) {
            (None, None) => None,
            (Some(AgentChannelScopeSummary::All), Some(ids)) if !ids.is_empty() => {
                return Err(invalid_arguments(
                    "channelIds only apply to the `selected` channel scope; omit them for `all`",
                ));
            }
            (Some(AgentChannelScopeSummary::All), _) => Some(AgentChannelSelection {
                channel_scope: AgentChannelScopeSummary::All.into(),
                channel_ids: Vec::new(),
            }),
            (Some(AgentChannelScopeSummary::Selected) | None, ids) => Some(AgentChannelSelection {
                channel_scope: AgentChannelScopeSummary::Selected.into(),
                channel_ids: ids.clone().unwrap_or_default(),
            }),
        };

        let mcp = match (self.mcp_scope, &self.mcp_servers) {
            (None, None) => None,
            (Some(AgentMcpScopeSummary::OwnerConnections), Some(servers))
                if !servers.is_empty() =>
            {
                return Err(invalid_arguments(
                    "mcpServers only apply to the `selected` MCP scope; omit them for `owner_connections`",
                ));
            }
            (Some(AgentMcpScopeSummary::OwnerConnections), _) => {
                Some(AgentMcpServers::OwnerConnections)
            }
            (Some(AgentMcpScopeSummary::Selected) | None, servers) => {
                Some(AgentMcpServers::Selected {
                    servers: servers
                        .clone()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|server| AgentMcpServer {
                            app_slug: server.app_slug,
                            server_name: server.server_name,
                        })
                        .collect(),
                })
            }
        };

        let patch = PatchAgentRequest {
            instructions: self.instructions.clone(),
            harness,
            default_model: self.default_model.clone(),
            channels,
            mcp,
            auto_accept_permissions: self.auto_accept_permissions,
            is_coding: self.is_coding,
        };
        if patch == PatchAgentRequest::default() {
            return Err(invalid_arguments(
                "nothing to change: provide at least one field besides botId",
            ));
        }
        Ok(patch)
    }
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for ConfigureAgent
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = ConfigureAgentResponse;

    #[tracing::instrument(
        skip_all,
        fields(user_id=?request_context.user_id, bot_id=%self.bot_id),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let patch = self.patch()?;
        let agent = AgentSummary::try_from(
            service_context
                .service
                .patch_agent(
                    request_context.user_id,
                    BotId::new_from_uuid(self.bot_id),
                    patch,
                )
                .await
                .map_err(|error| bot_tool_error("configure agent", error))?,
        )?;
        let summary = format!(
            "Updated @{}: {}. New sessions use the new configuration; running ones keep theirs.",
            agent.bot.handle,
            self.changed_fields().join(", ")
        );

        Ok(ConfigureAgentResponse { agent, summary })
    }
}
