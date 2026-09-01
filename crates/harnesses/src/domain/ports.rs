//! Harness ports.

use std::future::Future;

use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use harness_token::HashedHarnessToken;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    ApprovePairingRequest, ClaimOutcome, ClaimPairingRequest, CreatePairingRequest, CreatedPairing,
    Harness, HarnessAgent, HarnessOwner, HarnessSession, PairingClaimFacts, PairingDetails,
    PairingStatus, RequestedHarnessScope,
};

/// A pairing row to persist.
#[derive(Debug, Clone)]
pub struct NewPairing {
    /// Pairing id.
    pub id: Uuid,
    /// Normalized pairing code, `XXXX-XXXX`.
    pub code: String,
    /// SHA-256 of the device secret.
    pub device_secret_hash: [u8; 32],
    /// Requested harness display name.
    pub requested_name: String,
    /// Display-only machine description.
    pub host: Option<String>,
    /// The scope the daemon's config asked for.
    pub requested_scope: Option<RequestedHarnessScope>,
    /// When the pairing expires.
    pub expires_at: DateTime<Utc>,
}

/// A harness row to create at approval.
#[derive(Debug, Clone)]
pub struct NewHarness {
    /// Harness id.
    pub id: HarnessId,
    /// Display name.
    pub name: String,
    /// Owner.
    pub owner: HarnessOwner,
    /// The approving user.
    pub created_by: MacroUserIdStr<'static>,
}

/// A pairing row as the lookup and approval paths see it.
#[derive(Debug, Clone)]
pub struct PairingRow {
    /// The user-facing details.
    pub details: PairingDetails,
    /// Current status.
    pub status: PairingStatus,
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

    /// Get the facts the claim path verifies.
    fn pairing_claim_facts(
        &self,
        pairing_id: Uuid,
    ) -> impl Future<Output = Result<Option<PairingClaimFacts>, Self::Err>> + Send;

    /// Release an approved pairing's credential atomically.
    ///
    /// Flips the pairing to claimed and persists the hashed token in one
    /// transaction; returns `None` when the pairing is not claimable (raced,
    /// expired, or already claimed).
    fn claim_pairing(
        &self,
        pairing_id: Uuid,
        token_id: Uuid,
        token: HashedHarnessToken,
    ) -> impl Future<Output = Result<Option<Harness>, Self::Err>> + Send;

    /// List active harnesses owned by the caller or any of their teams.
    fn list_visible_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Harness>, Self::Err>> + Send;

    /// Get an active harness by id.
    fn get_harness(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Option<Harness>, Self::Err>> + Send;

    /// Soft-delete a harness and revoke its tokens.
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

    /// List active agents bound to a harness.
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

    /// Approve a pairing, registering the harness for the caller or a team.
    fn approve_pairing(
        &self,
        caller: MacroUserIdStr<'static>,
        code: &str,
        req: ApprovePairingRequest,
    ) -> impl Future<Output = Result<Harness, HarnessError>> + Send;

    /// Poll an approved pairing's credential with the device secret.
    fn claim_pairing(
        &self,
        pairing_id: Uuid,
        req: ClaimPairingRequest,
    ) -> impl Future<Output = Result<ClaimOutcome, HarnessError>> + Send;

    /// List harnesses visible to the caller.
    fn list_harnesses(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Harness>, HarnessError>> + Send;

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
    /// Repository error.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
}
