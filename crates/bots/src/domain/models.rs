//! Bot domain models.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
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

/// Channel type for a channel containing a bot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BotChannelType {
    /// Public channel.
    Public,
    /// Private channel.
    Private,
    /// Direct message channel.
    DirectMessage,
    /// Team channel.
    Team,
}

impl BotChannelType {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Private => "private",
            Self::DirectMessage => "direct_message",
            Self::Team => "team",
        }
    }
}

impl std::str::FromStr for BotChannelType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "public" => Ok(Self::Public),
            "private" => Ok(Self::Private),
            "direct_message" => Ok(Self::DirectMessage),
            "team" => Ok(Self::Team),
            other => Err(format!("unknown bot channel type: {other}")),
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
///
/// Clients deserialize this, so both derives are used.
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
    /// Whether mentioning this bot opens a sandboxed coding-agent session.
    pub has_agent: bool,
}

/// Channel containing a bot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct BotChannel {
    /// Channel id.
    pub channel_id: Uuid,
    /// Channel display name.
    pub name: Option<String>,
    /// Channel type.
    pub channel_type: BotChannelType,
    /// Timestamp when the bot joined the channel.
    pub joined_at: DateTime<Utc>,
}

/// Authenticated principal asking to list a bot's channels.
#[derive(Debug, Clone)]
pub enum BotChannelListCaller {
    /// A directly authenticated Macro user.
    User(MacroUserIdStr<'static>),
    /// An authenticated bot.
    Bot(BotId),
    /// An authenticated internal service, with or without an acting user.
    Internal,
}

/// Bot token metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct BotToken {
    /// Token id.
    pub id: Uuid,
    /// Owning bot id.
    pub bot_id: BotId,
    /// Display prefix of the bearer token. The raw secret is never stored here.
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
    /// Authenticated bot principal associated with the token.
    pub bot: AuthenticatedBot,
}

/// Request to create a bot.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateBotRequest {
    /// Team owner. The caller must be a team administrator or owner. Omit for a user-owned bot.
    pub team_id: Option<Uuid>,
    /// Display name.
    pub name: String,
    /// Stable handle.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// Whether mentioning this bot opens a sandboxed coding-agent session. Defaults to false.
    pub has_agent: Option<bool>,
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
    /// Whether mentioning this bot opens a sandboxed coding-agent session. Omit to leave unchanged.
    pub has_agent: Option<bool>,
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
    /// Team owner. The caller must be a team administrator or owner. Omit for a user-owned bot.
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
    /// Whether mentioning this bot opens a sandboxed coding-agent session. Defaults to false.
    pub has_agent: Option<bool>,
}

/// Response containing a newly minted token.
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

/// Harness a persona's sessions run under.
///
/// A closed set: this is what we launch inside the sandbox, not something an
/// external system reports back. Contrast `agent_session.model`, which records
/// whatever model the running agent tells us it used and is therefore a plain
/// string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum Harness {
    /// The `opencode` ACP harness.
    #[default]
    OpenCode,
}

impl Harness {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OpenCode => "opencode",
        }
    }
}

impl std::fmt::Display for Harness {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for Harness {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "opencode" => Ok(Self::OpenCode),
            other => Err(format!("unknown harness: {other}")),
        }
    }
}

/// Model a persona's sessions are launched with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum AgentModel {
    /// Claude Sonnet. The slug is `claude`, matching the sessions already
    /// stamped with it before personas existed.
    #[default]
    Claude,
}

impl AgentModel {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
        }
    }
}

impl std::fmt::Display for AgentModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for AgentModel {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "claude" => Ok(Self::Claude),
            other => Err(format!("unknown model: {other}")),
        }
    }
}

/// What an agent-backed bot runs: the `bot_agent_config` row.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct AgentConfig {
    /// Harness the session runs under.
    pub harness: Harness,
    /// Model the session is launched with.
    pub model: AgentModel,
    /// Markdown instructions prepended to every session, if any.
    pub system_prompt: Option<String>,
    /// Repository cloned into the workspace. `None` means no checkout: the
    /// session gets an empty workspace, and there is no deployment-wide
    /// default standing behind it.
    pub repo_url: Option<String>,
}

/// A persona: an agent-backed system bot a team owns and edits.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Persona {
    /// The bot identity: name, handle, avatar, ownership.
    #[serde(flatten)]
    pub bot: Bot,
    /// What it runs.
    pub agent: AgentConfig,
}

/// Request to create a persona.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreatePersonaRequest {
    /// Team the persona belongs to. The caller must administer it.
    pub team_id: Uuid,
    /// Display name.
    pub name: String,
    /// Stable handle, used for `@` mentions.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// What it runs.
    pub agent: AgentConfig,
}

/// Request to patch a persona. Absent fields are left unchanged.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchPersonaRequest {
    /// Display name.
    pub name: Option<String>,
    /// Stable handle.
    pub handle: Option<String>,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// Replacement agent configuration, applied wholesale when present.
    pub agent: Option<AgentConfig>,
}

/// A bot the caller may `@`-mention, projected down to what a typeahead needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct MentionableBot {
    /// Bot id. Mentions carry this as `bot|{id}`.
    pub id: BotId,
    /// Display name.
    pub name: String,
    /// Handle typed after the `@`.
    pub handle: String,
    /// Avatar, when it has one.
    pub avatar_url: Option<String>,
}
