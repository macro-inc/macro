//! Harness domain models.

use bot_id::BotId;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

/// Harness owner.
///
/// Exactly one of a user or a team, mirroring the bots owner pattern. There
/// are no system harnesses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum HarnessOwner {
    /// User-owned (private) harness.
    User {
        /// Owner user id.
        user_id: String,
    },
    /// Team-owned harness, usable by every team member.
    Team {
        /// Owner team id.
        team_id: Uuid,
    },
}

/// A registered user-run harness.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Harness {
    /// Whether agents may bypass ACP permission requests on this harness.
    #[serde(default)]
    pub allow_permission_bypass: bool,
    /// Harness id.
    pub id: HarnessId,
    /// Runtime kind. Currently always `macrod`.
    pub kind: String,
    /// Display name.
    pub name: String,
    /// Owner.
    pub owner: HarnessOwner,
    /// User that registered this harness.
    pub created_by: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Whether the daemon currently holds a runtime connection.
    pub connected: bool,
    /// When the daemon last attached a runtime connection.
    pub last_connected_at: Option<DateTime<Utc>>,
    /// What the harness's machine can do, as macrod last reported it.
    #[serde(default)]
    pub capabilities: HarnessCapabilities,
    /// The Macro computer (hosted VM) this harness runs on; absent for a
    /// machine the user paired themselves.
    #[serde(default)]
    pub computer_id: Option<Uuid>,
    /// How Claude Code on this machine is paid for. Only meaningful for
    /// Macro computers.
    #[serde(default)]
    pub claude_mode: ClaudeMode,
}

/// How Claude Code on a Macro computer is paid for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ClaudeMode {
    /// Macro credits, through Macro's Anthropic gateway.
    #[default]
    MacroCredits,
    /// A Claude account signed in on the computer.
    OwnAccount,
}

impl ClaudeMode {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MacroCredits => "macro_credits",
            Self::OwnAccount => "own_account",
        }
    }
}

impl std::str::FromStr for ClaudeMode {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "macro_credits" => Ok(Self::MacroCredits),
            "own_account" => Ok(Self::OwnAccount),
            other => Err(format!("unknown claude mode: {other}")),
        }
    }
}

/// What a caller wants to do with a harness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessAccess {
    /// See it: its owner, or any member of its owning team.
    View,
    /// Change it: the same rule as deleting it.
    Manage,
}

/// What a harness's machine can do beyond running agents.
///
/// macrod reports this after it connects; every field defaults to off, so
/// harnesses that never report stay plain.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(default)]
pub struct HarnessCapabilities {
    /// A display Macro can stream (Xvnc on `127.0.0.1:5900`).
    pub screen: bool,
    /// Latest brain health, keyed by the enrolled persona's OS username.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub personas: BTreeMap<String, PersonaHealth>,
}

/// A brain observation. Consumers combine harness connection presence with
/// `checked_at` freshness when deciding whether the observation is still live.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PersonaHealth {
    /// The brain is serving health and reports no problems.
    Healthy {
        /// Time of this observation.
        checked_at: DateTime<Utc>,
        /// Most recent completed turn, retained across unavailable probes.
        last_turn_at: Option<DateTime<Utc>>,
    },
    /// The unit, its configuration or its health response has a problem.
    Unhealthy {
        /// Time of this observation.
        checked_at: DateTime<Utc>,
        /// A bounded diagnostic, never an environment file or response body.
        last_error: String,
        /// Most recent completed turn, retained across unavailable probes.
        last_turn_at: Option<DateTime<Utc>>,
    },
    /// The unit or brain health listener is absent.
    Missing {
        /// Time of this observation.
        checked_at: DateTime<Utc>,
        /// Why the brain could not be found.
        last_error: String,
        /// Most recent completed turn, retained across unavailable probes.
        last_turn_at: Option<DateTime<Utc>>,
    },
}

/// A pre-approved pairing for a Macro computer, minted by the control plane.
#[derive(Debug, Clone)]
pub struct CreateHostedPairing {
    /// Owning team.
    pub team_id: Uuid,
    /// Harness display name.
    pub name: String,
    /// The team admin who bought the computer.
    pub created_by: MacroUserIdStr<'static>,
    /// Whether agents may bypass ACP permission requests on this harness.
    pub allow_permission_bypass: bool,
    /// The computer the harness runs on.
    pub computer_id: Uuid,
}

/// The claim material a Macro computer's macrod enrolls with.
#[derive(Debug, Clone)]
pub struct HostedPairing {
    /// Pairing id the device secret claims.
    pub pairing_id: Uuid,
    /// Claim credential; returned only here and never stored raw.
    pub device_secret: String,
}

/// Request to open a pairing: the daemon asks for a code the user approves.
///
/// The daemon serializes this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreatePairingRequest {
    /// Requested harness display name (typically the machine's hostname).
    pub name: String,
    /// Display-only description of the machine, e.g. `eric@macbook / darwin`.
    pub host: Option<String>,
}

/// A pairing the daemon created, including its claim credential.
///
/// `device_secret` is returned exactly once and never stored raw; the daemon
/// keeps it to claim the harness credential after approval.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreatedPairing {
    /// Pairing id used to poll for the claim.
    pub pairing_id: Uuid,
    /// Human-readable code the user confirms in the web app, `XXXX-XXXX`.
    pub code: String,
    /// Claim credential the daemon must present. Shown only here.
    pub device_secret: String,
    /// When the pairing expires.
    pub expires_at: DateTime<Utc>,
    /// Suggested delay between claim polls.
    pub poll_interval_seconds: u64,
}

/// A pending pairing, as shown to the approving user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PairingDetails {
    /// The pairing code, normalized to `XXXX-XXXX`.
    pub code: String,
    /// Harness display name the daemon asked for.
    pub requested_name: String,
    /// Display-only description of the machine.
    pub host: Option<String>,
    /// When the pairing was created.
    pub created_at: DateTime<Utc>,
    /// When the pairing expires.
    pub expires_at: DateTime<Utc>,
}

/// Request to approve a pairing and register the harness.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ApprovePairingRequest {
    /// Whether agents may bypass ACP permission requests on this harness.
    #[serde(default)]
    pub allow_permission_bypass: bool,
    /// Display name override. Defaults to the daemon's requested name.
    pub name: Option<String>,
    /// Owning team. Omit for a private, user-owned harness.
    pub team_id: Option<Uuid>,
}

/// Request to change a registered harness. Omitted fields stay as they are.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchHarnessRequest {
    /// New display name.
    #[serde(default)]
    pub name: Option<String>,
    /// Whether agents may bypass ACP permission requests on this harness.
    /// Live sessions pick the change up at their next turn.
    #[serde(default)]
    pub allow_permission_bypass: Option<bool>,
}

/// Request to claim an approved pairing's credential.
///
/// The daemon serializes this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ClaimPairingRequest {
    /// The claim credential returned when the pairing was created.
    pub device_secret: String,
}

/// Outcome of a claim poll.
#[derive(Debug, Clone)]
pub enum ClaimOutcome {
    /// The user has not approved the pairing yet; poll again.
    Pending,
    /// The pairing was approved; the credential is released exactly once.
    Claimed(ClaimedPairing),
}

/// The credential released to the daemon when a pairing is claimed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ClaimedPairing {
    /// The registered harness.
    pub harness: Harness,
    /// The raw harness bearer token. Shown only here; only its hash is stored.
    pub token: String,
}

/// An agent bound to a harness, as listed for the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct HarnessAgent {
    /// The agent's bot id.
    pub bot_id: BotId,
    /// Display name.
    pub name: String,
    /// Stable `@` handle.
    pub handle: String,
}

/// An agent session running on a harness, as listed for the daemon's UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct HarnessSession {
    /// The session id.
    pub session_id: Uuid,
    /// The agent the session runs for.
    pub bot_id: BotId,
    /// The agent's display name.
    pub bot_name: String,
    /// The agent's `@` handle.
    pub bot_handle: String,
    /// The session's display name.
    pub name: String,
    /// Session lifecycle status, e.g. `no_messages`, `active`.
    pub status: String,
    /// Model the session was opened with.
    pub model: String,
    /// The user the session belongs to.
    pub owner_id: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-activity timestamp.
    pub modified_at: DateTime<Utc>,
}

/// Persisted pairing state consumed by the domain service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairingStatus {
    /// Waiting for user approval.
    Pending,
    /// Approved; the credential has not been claimed yet.
    Approved,
    /// The credential was released.
    Claimed,
}

/// A pairing row as the claim path sees it.
#[derive(Debug, Clone)]
pub struct PairingClaimFacts {
    /// SHA-256 of the device secret.
    pub device_secret_hash: [u8; 32],
    /// Current status.
    pub status: PairingStatus,
    /// When the pairing expires.
    pub expires_at: DateTime<Utc>,
    /// The harness created at approval, when approved or claimed.
    pub harness_id: Option<HarnessId>,
}
