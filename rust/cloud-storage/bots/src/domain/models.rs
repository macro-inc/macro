//! Bot domain models.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Shared bot id used by bot principals.
pub use bot_id::BotId;

/// Bot kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BotKind {
    /// User- or team-owned bot.
    Owned,
    /// First-party system bot.
    System,
}

impl BotKind {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Owned => "owned",
            Self::System => "system",
        }
    }
}

impl std::str::FromStr for BotKind {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "owned" => Ok(Self::Owned),
            "system" => Ok(Self::System),
            other => Err(format!("unknown bot kind: {other}")),
        }
    }
}

/// Bot owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum BotOwner {
    /// User-owned bot.
    User {
        /// Owner user id.
        user_id: String,
    },
    /// Team-owned bot.
    Team {
        /// Owner team id.
        team_id: Uuid,
    },
}

/// Bot row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Bot {
    /// Bot id.
    pub id: BotId,
    /// Bot kind.
    pub kind: BotKind,
    /// Owner for owned bots.
    pub owner: Option<BotOwner>,
    /// Display name.
    pub name: String,
    /// Stable handle.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// User that created this bot.
    pub created_by: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Soft-delete timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Bot token metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct BotToken {
    /// Token id.
    pub id: Uuid,
    /// Owning bot id.
    pub bot_id: BotId,
    /// Token lookup prefix.
    pub token_prefix: String,
    /// Optional token label.
    pub label: Option<String>,
    /// Last successful use.
    pub last_used_at: Option<DateTime<Utc>>,
    /// Expiration timestamp.
    pub expires_at: Option<DateTime<Utc>>,
    /// Revocation timestamp.
    pub revoked_at: Option<DateTime<Utc>>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Authenticated bot principal.
#[derive(Debug, Clone)]
pub struct AuthenticatedBot {
    /// Bot id.
    pub bot_id: BotId,
    /// Bot kind.
    pub kind: BotKind,
}

/// Candidate token row used during bearer-token authentication.
#[derive(Debug, Clone)]
pub struct BotTokenCandidate {
    /// Token metadata.
    pub token: BotToken,
    /// Stored token hash.
    pub token_hash: Vec<u8>,
    /// Authenticated bot principal associated with the token.
    pub bot: AuthenticatedBot,
}

/// Request to create a bot.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateBotRequest {
    /// Team owner. Omit for a user-owned bot.
    pub team_id: Option<Uuid>,
    /// Display name.
    pub name: String,
    /// Stable handle.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
}

/// Request to patch a bot.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchBotRequest {
    /// Display name.
    pub name: Option<String>,
    /// Stable handle.
    pub handle: Option<String>,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
}

/// Request to create a bot token.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateBotTokenRequest {
    /// Token label.
    pub label: Option<String>,
    /// Optional expiration timestamp.
    pub expires_at: Option<DateTime<Utc>>,
}

/// Request to add a bot to a channel.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct AddChannelBotRequest {
    /// Bot id.
    pub bot_id: BotId,
}

/// Request to create a bot scoped to a channel.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateChannelScopedBotRequest {
    /// Team owner. Omit for a user-owned bot.
    pub team_id: Option<Uuid>,
    /// Display name.
    pub name: String,
    /// Stable handle.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// Optional token label.
    pub token_label: Option<String>,
    /// Optional token expiration timestamp.
    pub token_expires_at: Option<DateTime<Utc>>,
}

/// Response containing a newly minted token. The raw token is shown once.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateBotTokenResponse {
    /// Token metadata.
    pub token: BotToken,
    /// Raw bearer token.
    pub bearer_token: String,
}

/// Response containing a newly created channel-scoped bot and token.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateChannelScopedBotResponse {
    /// Created bot.
    pub bot: Bot,
    /// Token metadata.
    pub token: BotToken,
    /// Raw bot token.
    pub bot_token: String,
}

/// Request to post a channel webhook message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelWebhookRequest {
    /// Message body.
    pub content: String,
}

/// Response returned after posting a channel webhook message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelWebhookResponse {
    /// Created message id.
    pub message_id: String,
}
