//! Shared bot tool response types.

use crate::domain::models::{Bot, BotOwner};
use ai_toolset::ToolCallError;
use schemars::JsonSchema;
use serde::Serialize;
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

/// One-time credential and webhook created with a channel-scoped bot.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedBotChannelSetup {
    /// Channel the bot can now post to.
    pub channel_id: Uuid,
    /// Token metadata id, used to revoke this credential through the bot API.
    pub token_id: Uuid,
    /// Raw bearer token. It is returned only when minted and must be stored securely.
    pub bearer_token: String,
    /// Channel webhook the credential authenticates against.
    pub webhook: BotWebhook,
    /// Header where callers send [`Self::bearer_token`].
    pub credential_header: String,
    /// Header where callers send [`Self::credential_scope`].
    pub credential_scope_header: String,
    /// Required scope value for the bot credential.
    pub credential_scope: String,
}
