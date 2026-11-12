//! Harness domain models.

use bot_id::BotId;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Harness owner.
///
/// Always one person: a machine is someone's computer. A team machine is a
/// person's machine with a grant to the team, never one owned by the team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum HarnessOwner {
    /// The person whose machine this is.
    User {
        /// Owner user id.
        user_id: String,
    },
}

/// What one caller may do with a machine.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum HarnessAccess {
    /// The caller owns it: they manage who else can use it.
    Owner,
    /// A user: the caller may run agents on it, through a direct or team grant.
    User,
    /// A reader: the caller may see what is on it, but not run agents on it.
    Read,
    /// No access: the caller can see it exists and ask for access.
    #[default]
    None,
}

/// An agent that lives on a machine, as opposed to a coding agent directed
/// there turn by turn. Anyone who can reach it can talk to it; it stays up only
/// while its own owner can use the machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct HarnessResident {
    /// Bot id.
    pub bot_id: BotId,
    /// Display name.
    pub name: String,
    /// The user owning the agent, when a person does.
    pub owner_user_id: Option<String>,
    /// The team owning the agent, when a team does.
    pub team_id: Option<Uuid>,
}

/// Request to open or close a machine to one of the owner's teams.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct SetHarnessTeamAccessRequest {
    /// The team, which the owner must belong to.
    pub team_id: Uuid,
    /// Whether every member of the team may use the machine.
    pub enabled: bool,
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
    /// What the caller may do with it. Reported as `none` where no caller is
    /// in question, such as to the daemon itself.
    #[serde(default)]
    pub access: HarnessAccess,
    /// Teams it is a team machine for: their every member is a user of it.
    #[serde(default)]
    pub shared_team_ids: Vec<Uuid>,
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
    /// Team to open the harness to. Omit to keep it to the approving user.
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
