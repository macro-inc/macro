//! Shared bot tool response types.

use crate::domain::models::{Bot, BotOwner};
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

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
}

impl From<Bot> for BotSummary {
    fn from(bot: Bot) -> Self {
        Self {
            bot_id: bot.id.as_uuid(),
            owner: bot
                .owner
                .expect("manageable owned bots always have an owner")
                .into(),
            name: bot.name,
            handle: bot.handle,
            description: bot.description,
            avatar_url: bot.avatar_url,
        }
    }
}
