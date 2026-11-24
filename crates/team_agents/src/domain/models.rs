//! Domain models for agent teammates.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use agent_credentials::{AgentApiKey, RepoToken};
pub use agent_git::domain::voice::VoiceModel;
pub use harness_id::HarnessId;
pub use hosted_runtimes::domain::ids::ComputerId;
pub use hosted_runtimes::domain::models::PurchaseKey;
pub use hosted_runtimes::domain::size::ComputerSize;

/// Longest agent name, in characters.
pub const MAX_NAME_CHARS: usize = 64;

/// Longest job description or personality, in characters.
pub const MAX_PROFILE_CHARS: usize = 4000;

/// Domain of the placeholder address an agent account gets. Agents have no
/// mailbox; `.invalid` never resolves, so nothing is ever delivered.
pub const AGENT_EMAIL_DOMAIN: &str = "agents.macro.invalid";

/// Where an agent teammate is, from its computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum TeamAgentStatus {
    /// Its computer is being bought, created or booted.
    Provisioning,
    /// Its computer is up, and the agent hasn't reported itself online yet.
    Starting,
    /// Its computer is up, and the agent has reported itself online.
    Running,
    /// Its computer is asleep, stopped or ending, or no fleet is attached.
    Paused,
    /// Its computer is past setup but not answering; it comes back by
    /// itself.
    Unhealthy,
    /// Its computer gave up and needs attention, or the invite died before
    /// buying one.
    Failed,
    /// Its computer is gone.
    Released,
}

/// An agent teammate: an AI member of a team with its own Macro account and
/// its own Macro computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamAgent {
    /// The agent's Macro user id (`macro|<email>`).
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'static>,
    /// Team the agent belongs to.
    pub team_id: Uuid,
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
    /// Admin who invited the agent.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub created_by: Option<MacroUserIdStr<'static>>,
    /// The agent's Macro computer, once bought.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<Uuid>))]
    pub computer_id: Option<ComputerId>,
    /// Where the agent is.
    pub status: TeamAgentStatus,
    /// When the agent was invited.
    pub created_at: DateTime<Utc>,
}

/// A team's agents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamAgents {
    /// The agents, oldest first.
    pub agents: Vec<TeamAgent>,
}

/// Input for inviting an agent teammate and buying its computer.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamAgent {
    /// One key per Invite dialog, reused when the invite is retried, so a
    /// retry never buys a second computer.
    pub purchase_key: String,
    /// Display name.
    pub name: String,
    /// What the agent is responsible for. Seeds its workspace; when this and
    /// `personality` are empty the agent asks its owner what to take on.
    #[serde(default)]
    pub job_description: String,
    /// How the agent behaves and talks. Seeds its workspace.
    #[serde(default)]
    pub personality: String,
    /// The computer to buy.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub size: ComputerSize,
    /// Profile picture URL (a static file the caller uploaded).
    pub avatar_url: Option<String>,
    /// The call voice picked in the invite; `None` keeps the starter
    /// agent's default.
    #[serde(default)]
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub voice: Option<VoiceModel>,
}

/// An agent's display name: trimmed, 1 to [`MAX_NAME_CHARS`] characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentName(String);

impl AgentName {
    /// Trim `value` and check its length.
    pub fn try_new(value: &str) -> Result<Self, TeamAgentError> {
        let name = value.trim();
        if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
            return Err(TeamAgentError::InvalidName);
        }
        Ok(Self(name.to_owned()))
    }

    /// Borrow the name.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Take the name.
    pub fn into_string(self) -> String {
        self.0
    }
}

/// A [`CreateTeamAgent`] whose fields have been checked, before anything is
/// created.
#[derive(Debug, Clone)]
pub struct TeamAgentInvite {
    /// The invite's purchase key.
    pub purchase_key: PurchaseKey,
    /// Display name.
    pub name: AgentName,
    /// What the agent is responsible for, trimmed; may be empty.
    pub job_description: String,
    /// How the agent behaves and talks, trimmed; may be empty.
    pub personality: String,
    /// The computer to buy.
    pub size: ComputerSize,
    /// Profile picture URL, `https://`.
    pub avatar_url: Option<String>,
    /// The call voice picked in the invite.
    pub voice: Option<VoiceModel>,
}

/// The non-secret inputs the brain's first run writes into its workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonaSeed {
    /// Admin the brain recognizes as its creator.
    pub creator_id: Option<MacroUserIdStr<'static>>,
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
    /// The call voice picked in the invite; seeds stored before voices have
    /// none.
    #[serde(default)]
    pub voice: Option<VoiceModel>,
}

/// An account to create for a new agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAgentAccount {
    /// The agent's Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// Its placeholder address.
    pub email: String,
    /// The team it joins.
    pub team_id: Uuid,
    /// Admin creating it.
    pub created_by: MacroUserIdStr<'static>,
    /// Display name.
    pub name: AgentName,
    /// Profile picture URL.
    pub avatar_url: Option<String>,
    /// Workspace seed.
    pub persona_seed: PersonaSeed,
    /// The invite's purchase key: one agent per key per team.
    pub purchase_key: PurchaseKey,
}

/// What [`super::ports::TeamAgentRepository::create_account`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreatedAccount {
    /// The account and its `team_agents` row were created.
    Created,
    /// The team already invited an agent with this purchase key (a double
    /// click, or a retry after a lost answer); nothing was created.
    AlreadyInvited(Box<TeamAgentRecord>),
}

/// A stored agent, before its computer is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamAgentRecord {
    /// The agent's Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// Team the agent belongs to.
    pub team_id: Uuid,
    /// Admin who invited it.
    pub created_by: Option<MacroUserIdStr<'static>>,
    /// Workspace seed, including its name and profile.
    pub persona_seed: PersonaSeed,
    /// When it was invited.
    pub created_at: DateTime<Utc>,
    /// When the agent first reported itself online, if it has.
    pub first_online_at: Option<DateTime<Utc>>,
}

/// What the agent's inviter is told when it first comes online.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentReady {
    /// The agent's computer.
    pub computer_id: ComputerId,
    /// The agent's team.
    pub team_id: Uuid,
    /// The computer's name and harness.
    pub computer: ComputerDetails,
    /// The admin who invited the agent.
    pub inviter: MacroUserIdStr<'static>,
    /// The agent.
    pub agent: MacroUserIdStr<'static>,
    /// The agent's name.
    pub agent_name: String,
}

/// What an agent's ready notice names about its computer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerDetails {
    /// Display name.
    pub name: String,
    /// The computer's harness, once macrod has connected.
    pub harness_id: Option<HarnessId>,
}

/// The agent's workspace repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRepo {
    /// Smart-HTTP clone URL, without credentials.
    pub url: String,
    /// The agent's token for clone and push.
    pub token: RepoToken,
}

/// A computer to buy for an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerPurchase {
    /// The buyer's key for this purchase.
    pub purchase_key: PurchaseKey,
    /// The team that pays.
    pub team_id: Uuid,
    /// The admin buying it.
    pub created_by: MacroUserIdStr<'static>,
    /// The agent it runs.
    pub agent: MacroUserIdStr<'static>,
    /// The computer's size.
    pub size: ComputerSize,
    /// Display name.
    pub name: AgentName,
}

/// The coarse status of an agent's computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputerState {
    /// The charge is being confirmed.
    Purchasing,
    /// Being created, booted or connected for the first time.
    SettingUp,
    /// Up.
    Ready,
    /// Up, with its first start waiting on the agent reporting online.
    AwaitingAgent,
    /// Asleep, waking, stopping, stopped, or no fleet is attached.
    Paused,
    /// Past setup, unreachable or restarting after a crash.
    Unhealthy,
    /// Gave up.
    Failed,
    /// Released and destroyed.
    Released,
}

impl TeamAgentStatus {
    /// The agent's status from its computer's, and whether the agent has
    /// ever reported itself online: a computer waiting on its agent runs it
    /// only once it has. A computer that waits on nothing (bought before
    /// agents reported) runs its agent once it is up.
    pub fn of(state: ComputerState, came_online: bool) -> Self {
        match state {
            ComputerState::Purchasing | ComputerState::SettingUp => Self::Provisioning,
            ComputerState::AwaitingAgent if !came_online => Self::Starting,
            ComputerState::AwaitingAgent | ComputerState::Ready => Self::Running,
            ComputerState::Paused => Self::Paused,
            ComputerState::Unhealthy => Self::Unhealthy,
            ComputerState::Failed => Self::Failed,
            ComputerState::Released => Self::Released,
        }
    }

    /// An agent whose invite made its account at `created_at` but has no
    /// computer yet: still provisioning within [`ORPHANED_INVITE_AFTER`],
    /// then failed, since the invite that should have bought it died.
    pub fn without_computer(created_at: DateTime<Utc>, now: DateTime<Utc>) -> Self {
        if now - created_at < ORPHANED_INVITE_AFTER {
            Self::Provisioning
        } else {
            Self::Failed
        }
    }
}

/// How long an invited agent may have no computer before its invite counts
/// as dead. The invite reserves the computer in the request that made the
/// account, and the slowest step it waits on, the charge, hands over to a
/// worker after `hosted_runtimes::domain::lifecycle::CHARGE_TAKEOVER` (two
/// minutes); this leaves ample room past that.
pub const ORPHANED_INVITE_AFTER: chrono::Duration = chrono::Duration::minutes(10);

/// Why an invite was refused or failed.
#[derive(Debug, thiserror::Error)]
pub enum TeamAgentError {
    /// The name is empty or too long.
    #[error("the name must be 1 to {MAX_NAME_CHARS} characters")]
    InvalidName,
    /// The job description or personality is empty or too long.
    #[error("the job description and personality must be at most {MAX_PROFILE_CHARS} characters")]
    InvalidProfile,
    /// The purchase key is empty, too long or not printable ASCII.
    #[error("the purchase key must be 1 to 128 printable ASCII characters")]
    InvalidPurchaseKey,
    /// The avatar is not an HTTPS URL.
    #[error("the avatar must be an https URL")]
    InvalidAvatar,
    /// The path is not a Macro user id.
    #[error("that is not a user id")]
    InvalidAgentId,
    /// No agent with that id on the caller's team.
    #[error("no such agent on this team")]
    NotFound,
    /// The caller may not do this.
    #[error("{0}")]
    Forbidden(&'static str),
    /// The caller is not on a team that can have agent teammates.
    #[error("agent teammates aren't available for this account yet")]
    NotEnabled,
    /// The computer can't be bought (sold out, no subscription, no fleet,
    /// billing refused). The message is safe for clients.
    #[error("the computer can't be bought: {0}")]
    ComputerUnavailable(String),
    /// No host has room for the size, checked before any charge; nothing was
    /// created or charged.
    #[error("there's no room for a {} computer right now", .0.label())]
    NoRoom(ComputerSize),
    /// The card was declined; nothing was created or charged.
    #[error("the card was declined")]
    PaymentDeclined,
    /// The workspace repository could not be created; nothing was charged.
    #[error("the workspace repository could not be created; nothing was charged")]
    RepoUnavailable(rootcause::Report),
    /// The agent's computer purchase is still confirming; try again once it
    /// settles.
    #[error("the agent's computer purchase is still confirming; try again in a minute")]
    PurchaseConfirming,
    /// An earlier request with this purchase key is still setting up the
    /// agent and hasn't bought its computer yet.
    #[error("this invite is still being set up; try again in a moment")]
    InviteInProgress,
    /// The agent's repository has no valid `config/voice.json`.
    #[error("the agent has no voice set")]
    NoVoice,
    /// The model is not in the provider's catalog.
    #[error("that voice isn't available")]
    UnknownVoice,
    /// The workspace repository or the speech provider did not answer a
    /// voice request.
    #[error("voices are unavailable right now")]
    VoiceUnavailable(rootcause::Report),
    /// Anything else.
    #[error("internal error: {0}")]
    Internal(rootcause::Report),
}

impl TeamAgentError {
    /// Wrap an adapter error as internal.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}

#[cfg(test)]
mod test;
