//! Harness domain models.

use bot_id::BotId;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use serde::{Deserialize, Serialize};
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
}

/// Sent by a daemon reading its own harness while it holds a runtime connection,
/// so the service can log when its own answer disagrees.
pub const RUNTIME_CONNECTED_HEADER: &str = "x-macro-harness-runtime-connected";

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

/// Who a harness should belong to after a change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum RequestedHarnessOwner {
    /// Private to the caller making the change.
    User,
    /// Shared with a team the caller belongs to.
    Team {
        /// Owner team id.
        team_id: Uuid,
    },
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
    /// New owner. Refused while it would leave agents bound to this harness
    /// that their owners could no longer run on it.
    #[serde(default)]
    pub owner: Option<RequestedHarnessOwner>,
}

/// Owner of an agent bound to a harness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum HarnessAgentOwner {
    /// A private agent.
    User {
        /// Owner user id.
        user_id: String,
    },
    /// A team agent.
    Team {
        /// Owner team id.
        team_id: Uuid,
    },
}

/// An agent bound to a harness, with its owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct BoundHarnessAgent {
    /// The agent's bot id.
    pub bot_id: BotId,
    /// Display name.
    pub name: String,
    /// Stable `@` handle.
    pub handle: String,
    /// Who owns the agent.
    pub owner: HarnessAgentOwner,
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
