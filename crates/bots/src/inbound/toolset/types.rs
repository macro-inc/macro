//! Shared bot tool response types.

use crate::domain::models::{Agent, AgentChannelScope, AgentMcpServers, Bot, BotOwner};
use ai_toolset::ToolCallError;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Preferred header used to authenticate bot webhook requests.
pub const BOT_WEBHOOK_TOKEN_HEADER: &str = "x-macro-bot-token";
/// Header selecting the authorization scope for bot webhook requests.
pub const BOT_WEBHOOK_SCOPE_HEADER: &str = "x-macro-bot-scope";
/// User scope works for both user- and team-owned bots on channel webhooks.
pub const BOT_WEBHOOK_SCOPE: &str = "user";

/// Ownership scope of a manageable bot.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum BotOwnerSummary {
    /// Bot owned by one user.
    User {
        /// Macro user id of the owner.
        user_id: String,
    },
    /// Bot owned by a team.
    Team {
        /// Team id of the owner.
        team_id: Uuid,
    },
}

impl From<BotOwner> for BotOwnerSummary {
    fn from(owner: BotOwner) -> Self {
        match owner {
            BotOwner::User { user_id } => Self::User { user_id },
            BotOwner::Team { team_id } => Self::Team { team_id },
        }
    }
}

/// High-signal bot details returned to AI agents.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BotSummary {
    /// Bot id used by the other bot-management tools.
    pub bot_id: Uuid,
    /// User or team that owns the bot.
    pub owner: BotOwnerSummary,
    /// Display name.
    pub name: String,
    /// Stable mention handle.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional profile-picture URL.
    pub avatar_url: Option<String>,
    /// Whether mentioning this bot opens a sandboxed coding-agent session.
    pub has_agent: bool,
}

impl TryFrom<Bot> for BotSummary {
    type Error = ToolCallError;

    fn try_from(bot: Bot) -> Result<Self, Self::Error> {
        let Some(owner) = bot.owner else {
            return Err(ToolCallError {
                description: "bot is missing an owner and cannot be managed".to_string(),
                internal_error: anyhow::anyhow!("owned bot missing owner"),
            });
        };

        Ok(Self {
            bot_id: bot.id.as_uuid(),
            owner: owner.into(),
            name: bot.name,
            handle: bot.handle,
            description: bot.description,
            avatar_url: bot.avatar_url,
            has_agent: bot.has_agent,
        })
    }
}

/// Where an agent can be mentioned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentChannelScopeSummary {
    /// Every channel its owner can use.
    All,
    /// Only the listed channels.
    Selected,
}

impl From<AgentChannelScope> for AgentChannelScopeSummary {
    fn from(scope: AgentChannelScope) -> Self {
        match scope {
            AgentChannelScope::All => Self::All,
            AgentChannelScope::Selected => Self::Selected,
        }
    }
}

impl From<AgentChannelScopeSummary> for AgentChannelScope {
    fn from(scope: AgentChannelScopeSummary) -> Self {
        match scope {
            AgentChannelScopeSummary::All => Self::All,
            AgentChannelScopeSummary::Selected => Self::Selected,
        }
    }
}

/// Which connected apps an agent's sessions are handed as MCP servers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentMcpScopeSummary {
    /// Whatever apps the person running the session has connected.
    OwnerConnections,
    /// Exactly the listed apps, whether or not the person has connected them.
    Selected,
}

/// One Pipedream app an agent lists under the `selected` MCP scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentMcpServerSummary {
    /// Pipedream app slug, e.g. `linear`.
    pub app_slug: String,
    /// Display name, e.g. `Linear`.
    pub server_name: String,
}

/// High-signal agent details returned to AI agents: the bot profile plus the
/// instructions and settings that decide how its sessions run.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    /// The bot the agent speaks as; `bot.botId` is the id every agent tool takes.
    pub bot: BotSummary,
    /// Instructions the agent works under, whole. New sessions snapshot them.
    pub instructions: String,
    /// Harness slug: `in-memory`, `cursor`, `claude-cloud`, or `macrod`.
    pub harness: String,
    /// Registered harness the agent runs on when `harness` is `macrod`.
    pub harness_id: Option<Uuid>,
    /// Model id the agent's sessions open with. Valid ids depend on the harness.
    pub default_model: String,
    /// Where the agent can be mentioned.
    pub channel_scope: AgentChannelScopeSummary,
    /// Selected channel ids; empty unless `channelScope` is `selected`.
    pub channel_ids: Vec<Uuid>,
    /// Which connected apps its sessions are handed.
    pub mcp_scope: AgentMcpScopeSummary,
    /// Selected apps; empty unless `mcpScope` is `selected`.
    pub mcp_servers: Vec<AgentMcpServerSummary>,
    /// Whether sessions approve tool permission requests without asking.
    /// Absent means the agent always prompts.
    pub auto_accept_permissions: Option<bool>,
    /// Whether the agent is a coding agent (works in a repository and answers
    /// mentions with a live session) or a chat agent (replies in the thread).
    pub is_coding: bool,
}

impl TryFrom<Agent> for AgentSummary {
    type Error = ToolCallError;

    fn try_from(agent: Agent) -> Result<Self, Self::Error> {
        let (mcp_scope, mcp_servers) = match agent.mcp {
            AgentMcpServers::OwnerConnections => {
                (AgentMcpScopeSummary::OwnerConnections, Vec::new())
            }
            AgentMcpServers::Selected { servers } => (
                AgentMcpScopeSummary::Selected,
                servers
                    .into_iter()
                    .map(|server| AgentMcpServerSummary {
                        app_slug: server.app_slug,
                        server_name: server.server_name,
                    })
                    .collect(),
            ),
        };
        Ok(Self {
            bot: BotSummary::try_from(agent.bot)?,
            instructions: agent.instructions,
            harness: agent.harness,
            harness_id: agent.harness_id.map(|id| id.as_uuid()),
            default_model: agent.default_model,
            channel_scope: agent.channel_scope.into(),
            channel_ids: agent.channel_ids,
            mcp_scope,
            mcp_servers,
            auto_accept_permissions: agent.auto_accept_permissions,
            is_coding: agent.is_coding,
        })
    }
}

/// One channel-specific webhook URL for a bot.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BotWebhook {
    /// Channel id the webhook posts into.
    pub channel_id: Uuid,
    /// Channel display name, when present.
    pub channel_name: Option<String>,
    /// Public URL to POST webhook content to.
    pub webhook_url: String,
}

impl BotWebhook {
    /// Build a webhook URL for a channel on the document-storage service.
    pub fn for_channel(document_storage_service_url: &str, channel_id: Uuid) -> Self {
        Self {
            channel_id,
            channel_name: None,
            webhook_url: format!("{document_storage_service_url}/channels/{channel_id}/webhook"),
        }
    }
}

/// Channel webhook and credential proposal created with a channel-scoped bot.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedBotChannelSetup {
    /// Channel the bot can now post to.
    pub channel_id: Uuid,
    /// Channel webhook the credential authenticates against.
    pub webhook: BotWebhook,
    /// Header where callers send the minted bearer token.
    pub credential_header: String,
    /// Header where callers send [`Self::credential_scope`].
    pub credential_scope_header: String,
    /// Required scope value for the bot credential.
    pub credential_scope: String,
    /// Optional label for the credential the user will mint from the chat card.
    pub credential_label: Option<String>,
    /// Optional expiration for the credential the user will mint from the chat card.
    pub credential_expires_at: Option<DateTime<Utc>>,
}
