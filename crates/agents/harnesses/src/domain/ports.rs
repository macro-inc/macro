//! Harness ports.

use computer_id::ComputerId;
use pairing_id::PairingId;
use std::future::Future;

use bearer_token::HashedHarnessToken;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::account_logins::{
    AccountLoginChange, AccountLoginNotice, AgentProvider, ComputerAccountLogin,
    HarnessAccountLogin,
};
use super::models::{
    ApprovePairingRequest, ClaimOutcome, ClaimPairingRequest, CreateHostedPairing,
    CreatePairingRequest, CreatedPairing, Harness, HarnessAccess, HarnessAgent, HarnessOwner,
    HarnessPermission, HarnessResident, HarnessSession, HostedPairing, PairingClaimFacts,
    PairingDetails, PairingStatus, PatchHarnessRequest, SetHarnessTeamAccessRequest,
};

/// A pairing row to persist.
#[derive(Debug, Clone)]
pub struct NewPairing {
    /// Pairing id.
    pub id: PairingId,
    /// Normalized pairing code, `XXXX-XXXX`.
    pub code: String,
    /// SHA-256 of the device secret.
    pub device_secret_hash: [u8; 32],
    /// Requested harness display name.
    pub requested_name: String,
    /// Display-only machine description.
    pub host: Option<String>,
    /// When the pairing expires.
    pub expires_at: DateTime<Utc>,
}

/// Validated changes to a harness row; `None` leaves a column as it is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HarnessChanges {
    /// New display name, already trimmed and length-checked.
    pub name: Option<String>,
    /// New permission-bypass setting.
    pub allow_permission_bypass: Option<bool>,
}

/// A harness row to create at approval.
#[derive(Debug, Clone)]
pub struct NewHarness {
    /// Whether agents may bypass ACP permission requests on this harness.
    pub allow_permission_bypass: bool,
    /// Harness id.
    pub id: HarnessId,
    /// Display name.
    pub name: String,
    /// Owner.
    pub owner: HarnessOwner,
    /// A team to open the harness to as it is created.
    pub team_grant: Option<Uuid>,
    /// The approving user.
    pub created_by: MacroUserIdStr<'static>,
    /// The Macro computer this harness runs on, for hosted harnesses.
    pub computer_id: Option<ComputerId>,
}

/// A pairing row as the lookup and approval paths see it.
#[derive(Debug, Clone)]
pub struct PairingRow {
    /// The user-facing details.
    pub details: PairingDetails,
    /// Current status.
    pub status: PairingStatus,
}

/// What [`HarnessRepo::upsert_hosted_pairing`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostedPairingUpsert {
    /// Created the harness and its pairing with the given ids.
    Created,
    /// The computer already had an unclaimed pairing; its secret was rotated.
    Rotated {
        /// The existing pairing's id.
        pairing_id: PairingId,
    },
    /// Revoked the claimed harness's credentials and created a fresh approved pairing.
    Rekeyed,
}

/// Open (pending, unexpired) pairing counts used to throttle creation.
#[derive(Debug, Clone, Copy)]
pub struct OpenPairingCounts {
    /// Every open pairing.
    pub total: i64,
    /// Open pairings requesting the same name.
    pub with_same_name: i64,
}

/// Harness repository.
#[cfg_attr(feature = "test-utils", mockall::automock(type Err = anyhow::Error;))]
pub trait HarnessRepo: Send + Sync + 'static {
    /// Repository error.
    type Err: Into<anyhow::Error> + Send;

    /// Persist a pairing. Returns `false` when the code is already taken.
    fn insert_pairing(
        &self,
        pairing: NewPairing,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Drop expired pairing rows.
    fn delete_expired_pairings(&self) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Count open pairings for creation throttling.
    fn count_open_pairings(
        &self,
        requested_name: &str,
    ) -> impl Future<Output = Result<OpenPairingCounts, Self::Err>> + Send;

    /// Get a pairing by normalized code, whatever its status.
    fn get_pairing(
        &self,
        code: &str,
    ) -> impl Future<Output = Result<Option<PairingRow>, Self::Err>> + Send;

    /// Create the harness and approve its pairing atomically.
    ///
    /// Applies only to a pending, unexpired pairing; returns `None` when the
    /// pairing raced to another state.
    fn approve_pairing(
        &self,
        code: &str,
        harness: NewHarness,
    ) -> impl Future<Output = Result<Option<Harness>, Self::Err>> + Send;

    /// Create a computer's harness with an already-approved pairing, or
    /// rotate the device secret of the one that exists, atomically.
    ///
    /// Keyed by `harness.computer_id`. The pairing is never pending, so no
    /// user sees or approves its code. An existing pairing keeps its id and
    /// takes `pairing.device_secret_hash`; a claimed harness keeps its id, revokes
    /// its tokens and receives a fresh approved pairing.
    fn upsert_hosted_pairing(
        &self,
        pairing: NewPairing,
        harness: NewHarness,
    ) -> impl Future<Output = Result<HostedPairingUpsert, Self::Err>> + Send;

    /// The live harness running on a computer.
    fn computer_harness(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<HarnessId>, Self::Err>> + Send;

    /// Every harness a computer has had, deleted ones included, so cleanup
    /// after its release can still find the agents bound to them.
    fn computer_harness_ids(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Vec<HarnessId>, Self::Err>> + Send;

    /// The computer a live harness runs on; `None` for unknown harnesses and
    /// machines users paired themselves.
    fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Option<ComputerId>, Self::Err>> + Send;

    /// Record what the machine reported about its login at a provider, in
    /// one transaction: a sign-in on the active login's account moves its
    /// expiry; any other sign-in upserts the provider account, signs out the
    /// provider's active login and inserts a new one; a sign-out signs the
    /// active login out. Returns `false` when the harness is unknown or
    /// deleted.
    fn record_account_login(
        &self,
        harness_id: HarnessId,
        change: AccountLoginChange,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The harness's active login at `provider`, if any.
    fn active_account_login(
        &self,
        harness_id: HarnessId,
        provider: AgentProvider,
    ) -> impl Future<Output = Result<Option<HarnessAccountLogin>, Self::Err>> + Send;

    /// Every active login at `provider` on a live Macro computer's harness.
    fn computer_account_logins(
        &self,
        provider: AgentProvider,
    ) -> impl Future<Output = Result<Vec<ComputerAccountLogin>, Self::Err>> + Send;

    /// Record the expiry notice sent for a login.
    fn record_login_notice(
        &self,
        login_id: Uuid,
        notice: AccountLoginNotice,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get the facts the claim path verifies.
    fn pairing_claim_facts(
        &self,
        pairing_id: PairingId,
    ) -> impl Future<Output = Result<Option<PairingClaimFacts>, Self::Err>> + Send;

    /// Release an approved pairing's credential atomically.
    ///
    /// Flips the pairing to claimed and persists the hashed token in one
    /// transaction; returns `None` when the pairing is not claimable (raced,
    /// expired, or already claimed).
    fn claim_pairing(
        &self,
        pairing_id: PairingId,
        device_secret_hash: [u8; 32],
        token_id: Uuid,
        token: HashedHarnessToken,
    ) -> impl Future<Output = Result<Option<Harness>, Self::Err>> + Send;

    /// List active harnesses the caller may run agents on.
    fn list_usable_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Harness>, Self::Err>> + Send;

    /// List active harnesses of everyone who shares a team with the caller,
    /// the caller included, whether or not the caller may use them.
    fn list_directory_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Harness>, Self::Err>> + Send;

    /// What the caller may do with an active harness.
    fn harness_access(
        &self,
        harness_id: HarnessId,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<HarnessAccess, Self::Err>> + Send;

    /// Add or remove a team's grant on a harness.
    fn set_team_access(
        &self,
        harness_id: HarnessId,
        team_id: Uuid,
        enabled: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// List the agents living on a harness: bound agents not marked as coding.
    fn list_residents(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Vec<HarnessResident>, Self::Err>> + Send;

    /// Get an active harness by id.
    fn get_harness(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Option<Harness>, Self::Err>> + Send;

    /// Apply a validated change to an active harness.
    fn update_harness(
        &self,
        harness_id: HarnessId,
        changes: HarnessChanges,
    ) -> impl Future<Output = Result<Option<Harness>, Self::Err>> + Send;

    /// Soft-delete a harness, revoke its tokens and drop its grants.
    fn delete_harness(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Check team membership.
    fn user_has_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Check whether a user owns a team.
    fn user_owns_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// List active agents bound to a harness that may run there now: coding
    /// agents, and residents whose owner still has User access.
    fn list_bound_agents(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Vec<HarnessAgent>, Self::Err>> + Send;

    /// List recent sessions of agents bound to a harness, newest first.
    fn list_sessions(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Vec<HarnessSession>, Self::Err>> + Send;
}

/// Harness service.
#[cfg_attr(feature = "test-utils", mockall::automock)]
pub trait HarnessService: Send + Sync + 'static {
    /// Open a pairing for an unauthenticated daemon.
    fn create_pairing(
        &self,
        req: CreatePairingRequest,
    ) -> impl Future<Output = Result<CreatedPairing, HarnessError>> + Send;

    /// Show a pending pairing to the approving user.
    fn get_pairing(
        &self,
        code: &str,
    ) -> impl Future<Output = Result<PairingDetails, HarnessError>> + Send;

    /// Approve a pairing, registering the harness to the caller, optionally
    /// open to a team of theirs.
    fn approve_pairing(
        &self,
        caller: MacroUserIdStr<'static>,
        code: &str,
        req: ApprovePairingRequest,
    ) -> impl Future<Output = Result<Harness, HarnessError>> + Send;

    /// Poll an approved pairing's credential with the device secret.
    fn claim_pairing(
        &self,
        pairing_id: PairingId,
        req: ClaimPairingRequest,
    ) -> impl Future<Output = Result<ClaimOutcome, HarnessError>> + Send;

    /// List harnesses the caller may run agents on.
    fn list_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Harness>, HarnessError>> + Send;

    /// Change a harness the caller may manage.
    fn patch_harness(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
        req: PatchHarnessRequest,
    ) -> impl Future<Output = Result<Harness, HarnessError>> + Send;
    /// List every harness of the caller's teammates, marking what the caller
    /// may do with each.
    fn list_directory(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Harness>, HarnessError>> + Send;

    /// Open a harness the caller owns to a team of theirs, or close it again.
    fn set_team_access(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
        req: SetHarnessTeamAccessRequest,
    ) -> impl Future<Output = Result<(), HarnessError>> + Send;

    /// List the agents living on a harness the caller may at least read.
    fn list_residents(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Vec<HarnessResident>, HarnessError>> + Send;

    /// Revoke a harness the caller may manage.
    fn delete_harness(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<(), HarnessError>> + Send;

    /// List agents bound to the authenticated harness.
    fn list_bound_agents(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Vec<HarnessAgent>, HarnessError>> + Send;

    /// The authenticated harness's own registration.
    fn get_self(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Harness, HarnessError>> + Send;

    /// Retire the authenticated harness: soft-delete it and revoke its tokens.
    ///
    /// Holding a valid credential is the whole authorization - the daemon may
    /// always retire itself.
    fn delete_self(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<(), HarnessError>> + Send;

    /// List recent sessions of agents bound to the authenticated harness.
    fn list_sessions(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Vec<HarnessSession>, HarnessError>> + Send;

    /// Register a Macro computer's team harness, already approved, and return
    /// the claim material its macrod enrolls with.
    ///
    /// Trusted in-process callers only (the hosted runtime control plane,
    /// after it authorized the team admin): this takes no caller to check and
    /// skips the open-pairing throttle. Idempotent per computer: a retry
    /// before the claim rotates the secret and returns the same pairing id;
    /// after the claim it revokes the old tokens and creates a fresh approved
    /// pairing for the same harness id.
    fn create_hosted_pairing(
        &self,
        req: CreateHostedPairing,
    ) -> impl Future<Output = Result<HostedPairing, HarnessError>> + Send;

    /// Trusted control-plane lookup of the exact hosted pairing claim. Presence
    /// is insufficient: a claim may commit before the daemon connects.
    fn hosted_pairing_claimed(
        &self,
        pairing_id: PairingId,
    ) -> impl Future<Output = Result<bool, HarnessError>> + Send;

    /// Soft-delete a computer's harness and revoke its tokens. Succeeds when
    /// the computer has no live harness.
    ///
    /// Trusted in-process callers only, like [`Self::create_hosted_pairing`].
    fn revoke_hosted_harness(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), HarnessError>> + Send;

    /// Every harness a Macro computer has had, deleted ones included.
    /// Trusted in-process callers only, like [`Self::create_hosted_pairing`].
    fn computer_harnesses(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Vec<HarnessId>, HarnessError>> + Send;

    /// The computer a live harness runs on, if it is a Macro computer's.
    fn harness_computer(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Option<ComputerId>, HarnessError>> + Send;

    /// The harness, when `caller` may access it as asked.
    ///
    /// View is its owner or any member of its team; manage is the delete
    /// rule (the owner, or a team harness's registrant or team owner).
    fn authorize_harness(
        &self,
        caller: MacroUserIdStr<'static>,
        harness_id: HarnessId,
        access: HarnessPermission,
    ) -> impl Future<Output = Result<Harness, HarnessError>> + Send;

    /// Record a sign-in or sign-out at a provider on a harness once its
    /// runtime confirmed it. Trusted in-process callers only.
    fn record_account_login(
        &self,
        harness_id: HarnessId,
        change: AccountLoginChange,
    ) -> impl Future<Output = Result<(), HarnessError>> + Send;

    /// The harness's active login at `provider`, if any. Trusted in-process
    /// callers only; they authorize the harness first.
    fn active_account_login(
        &self,
        harness_id: HarnessId,
        provider: AgentProvider,
    ) -> impl Future<Output = Result<Option<HarnessAccountLogin>, HarnessError>> + Send;
}

/// Harness service error.
#[derive(Debug, thiserror::Error)]
pub enum HarnessError {
    /// Bad request.
    #[error("{0}")]
    BadRequest(String),
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// The pairing can no longer be used (expired, denied, or already claimed).
    #[error("{0}")]
    Gone(String),
    /// Unauthorized.
    #[error("unauthorized")]
    Unauthorized,
    /// Pairing creation is throttled.
    #[error("too many open pairing requests")]
    Throttled,
    /// The harness belongs to a Macro computer, which belongs to its team:
    /// only releasing the computer deletes it, and it is never shared with
    /// another team.
    #[error(
        "This machine is a Macro computer, which belongs to its team. Manage it from Macro computers instead."
    )]
    ComputerHarness,
    /// Repository error.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
}
