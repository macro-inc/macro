//! Moving a computer to another host (a host's retirement, the move between
//! providers). The host agents copy the computer's ZFS dataset to each other
//! over the private host mesh (`firecracker_host_api::moves`); the
//! control plane only tells them what to do and records where a move stands.
//!
//! A move goes through stages, advanced by the operator's move pass
//! (`operator::moves`):
//!
//! - [`MoveStage::Seeding`]: rounds of copying while the computer runs, until
//!   one copies less than [`CONVERGED_BYTES`] (or [`MAX_SEED_ROUNDS`] ran).
//! - [`MoveStage::CuttingOver`]: the source shuts the guest down and stops
//!   serving it, a final round copies the rest, the target adopts it, and one
//!   transaction points `host_id` at the target and applies
//!   [`Event::Moved`](crate::domain::lifecycle::Event::Moved), which boots it
//!   there if it ran.
//! - [`MoveStage::Verifying`]: macrod connects on the new host within
//!   [`VERIFY_DEADLINE`], then the source's copy is dropped
//!   ([`MoveStage::Committed`]); otherwise the same path runs backwards
//!   ([`MoveStage::RollingBack`] then [`MoveStage::RolledBack`]), sending only
//!   what the guest wrote on the target.
//!
//! The computer's phase stays what the team sees (running, stopped): a move
//! is not a lifecycle phase. While a cutover or rollback runs, the operator
//! holds the computer's fleet effects and reconcile skips it.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::enrollment::EnrollmentGeneration;
use crate::domain::ids::{ComputerId, HostId};
use crate::domain::models::ControlPlaneId;

#[cfg(test)]
mod test;

/// A round copying at most this much counts as converged: the next one
/// (the final round, with the guest stopped) is about as small.
pub const CONVERGED_BYTES: u64 = 128 * 1024 * 1024;
/// Rounds while the computer runs before cutting over anyway: a guest
/// writing faster than the link never converges, and its final round is
/// bounded by what it writes in one round.
pub const MAX_SEED_ROUNDS: u32 = 12;
/// How long macrod has to connect on the new host before the move rolls
/// back. Longer than a cold boot plus macrod's backoff; shorter than the
/// lifecycle's own macrod grace, so the rollback runs before that timer.
pub const VERIFY_DEADLINE: Duration = Duration::minutes(2);
/// How long a target host accepts a move's ticket; the pass renews it.
pub const TICKET_LIFETIME: Duration = Duration::minutes(30);

/// A move's identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MoveId(Uuid);

impl MoveId {
    /// A new time-ordered id.
    pub fn generate() -> Self {
        Self(Uuid::now_v7())
    }

    /// From its UUID.
    pub const fn new(id: Uuid) -> Self {
        Self(id)
    }

    /// Its UUID.
    pub const fn into_inner(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for MoveId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Where a move stands.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::EnumString,
)]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "computer_move_stage", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MoveStage {
    /// Copying while the computer runs.
    Seeding,
    /// Stopping it, copying the rest, adopting and flipping its host.
    CuttingOver,
    /// Waiting for macrod on the new host.
    Verifying,
    /// Moving it back to where it was.
    RollingBack,
    /// It runs on the new host; finished.
    Committed,
    /// It is back where it was; finished.
    RolledBack,
    /// Gave up before the computer left its host (for example, it was
    /// released); finished.
    Failed,
}

impl MoveStage {
    /// Whether the move still has work to do.
    pub fn is_open(self) -> bool {
        match self {
            Self::Seeding | Self::CuttingOver | Self::Verifying | Self::RollingBack => true,
            Self::Committed | Self::RolledBack | Self::Failed => false,
        }
    }

    /// Whether the computer is between hosts: its guest is stopped and
    /// staged, so fleet effects and reconcile leave it alone.
    pub fn holds_computer(self) -> bool {
        match self {
            Self::CuttingOver | Self::RollingBack => true,
            Self::Seeding | Self::Verifying | Self::Committed | Self::RolledBack | Self::Failed => {
                false
            }
        }
    }
}

/// The secret the source host presents to the target for one move.
#[derive(Clone, PartialEq, Eq)]
pub struct MoveTicket(zeroize::Zeroizing<String>);

impl MoveTicket {
    /// Wrap a ticket the database generated.
    pub fn new(ticket: String) -> Self {
        Self(zeroize::Zeroizing::new(ticket))
    }

    /// The ticket, for the host agents.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for MoveTicket {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MoveTicket(**redacted**)")
    }
}

/// One move of one computer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerMove {
    /// The move.
    pub id: MoveId,
    /// The computer.
    pub computer_id: ComputerId,
    /// Where it was when the move started.
    pub from_host: HostId,
    /// Where it goes.
    pub to_host: HostId,
    /// Where the move stands.
    pub stage: MoveStage,
    /// Present while the move is open.
    pub ticket: Option<MoveTicket>,
    /// Copy rounds started (seed and catch-up rounds; not the final one).
    pub rounds: u32,
    /// Bytes the last finished round copied.
    pub last_round_bytes: Option<u64>,
    /// Whether the computer ran when the cutover began.
    pub was_running: Option<bool>,
    /// When `host_id` last moved (to the target, or back).
    pub flipped_at: Option<DateTime<Utc>>,
    /// Why the last pass failed, or why the move gave up.
    pub error: Option<String>,
    /// Who started it (an operator).
    pub created_by: String,
    /// When it started.
    pub created_at: DateTime<Utc>,
}

/// Why a move cannot start.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StartMoveError {
    /// No such computer.
    #[error("computer not found")]
    NotFound,
    /// The computer already has an open move.
    #[error("this computer is already moving")]
    AlreadyMoving,
    /// It is on that host already.
    #[error("the computer is already on that host")]
    SameHost,
    /// Being created, released, or needs an operator.
    #[error("this computer cannot move now: {0}")]
    NotMovable(String),
    /// The target is not a host this control plane drives, or has no
    /// move listener.
    #[error("cannot move to that host: {0}")]
    BadTarget(String),
    /// The target has no sold capacity left for it.
    #[error("the target host has no room for this computer")]
    NoRoom,
}

/// Moves, stored with the computers.
pub trait ComputerMoves: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Record a new move of `computer_id` from its current host, unless it
    /// already has an open one; generates the ticket.
    fn create_move(
        &self,
        computer_id: ComputerId,
        from_host: HostId,
        to_host: HostId,
        created_by: &str,
    ) -> impl Future<Output = Result<Result<ComputerMove, StartMoveError>, Self::Err>> + Send;

    /// Every open move.
    fn open_moves(&self) -> impl Future<Output = Result<Vec<ComputerMove>, Self::Err>> + Send;

    /// A computer's moves, newest first.
    fn moves_of(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Vec<ComputerMove>, Self::Err>> + Send;

    /// Save the move's stage, rounds, bytes, `was_running` and error. A
    /// finished stage clears the ticket and records when it finished.
    fn update_move(
        &self,
        moved: &ComputerMove,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// In one transaction: point the computer's `host_id` at `host`, apply
    /// `Event::Moved` there, and set the move's stage to `stage` with
    /// `flipped_at` = `now`.
    fn flip(
        &self,
        moved: &ComputerMove,
        host: HostId,
        stage: MoveStage,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Computers on `host` (as source or target) that an open move holds
    /// ([`MoveStage::holds_computer`]).
    fn held_on(
        &self,
        host: HostId,
    ) -> impl Future<Output = Result<std::collections::HashSet<ComputerId>, Self::Err>> + Send;

    /// Whether an open move holds the computer.
    fn held(&self, computer_id: ComputerId)
    -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Run a leased fleet effect again at `run_after` without counting an
    /// attempt (its computer is held by a move).
    fn postpone_effect(
        &self,
        effect_id: i64,
        run_after: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// A copy round as a source host reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Round {
    /// Where it stands.
    pub state: RoundState,
    /// Whether the computer was released (stopped and staged) when it
    /// started: such a round is the final one.
    pub released: bool,
    /// Bytes copied.
    pub bytes: u64,
}

/// A round's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoundState {
    /// No round since the host's agent started.
    Idle,
    /// Copying.
    Running,
    /// Copied.
    Done,
    /// Failed; the next round resumes it.
    Failed(String),
}

/// What a host does for moves, beside running computers.
pub trait HostMoves: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Where other hosts push computers to (its mesh address and port);
    /// `None` when the host cannot receive computers.
    fn move_address(&self) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// As a target: accept the computer from a source holding `ticket`.
    fn expect_move(
        &self,
        computer_id: ComputerId,
        ticket: &MoveTicket,
        expires_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// As a source: start (or join) a round to `target`.
    fn replicate(
        &self,
        computer_id: ComputerId,
        target: &str,
        ticket: &MoveTicket,
    ) -> impl Future<Output = Result<Round, Self::Err>> + Send;

    /// As a source: the last round.
    fn replication(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Round, Self::Err>> + Send;

    /// As a source: shut the guest down and stop serving it. Safe to repeat.
    fn release(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// As a target: serve the received computer, stopped. Safe to repeat.
    fn adopt(
        &self,
        computer_id: ComputerId,
        control_plane_id: &ControlPlaneId,
        generation: EnrollmentGeneration,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Drop the host's staged copy (never a live computer). Safe to repeat.
    fn drop_staged(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// What a copy pass does next, from the source's last round.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CopyStep {
    /// A round is copying; look again next pass.
    Wait,
    /// Start a round.
    Replicate,
    /// While seeding: rounds converged; cut over.
    CutOver,
    /// While cutting over: the final round is in; adopt on the target.
    Adopt,
}

/// The next copy step. `final_round` is whether the source has released the
/// computer (cutover or rollback), `rounds` how many seed rounds started.
pub fn copy_step(round: &Round, final_round: bool, rounds: u32) -> CopyStep {
    match (&round.state, final_round) {
        (RoundState::Running, _) => CopyStep::Wait,
        (RoundState::Done, true) if round.released => CopyStep::Adopt,
        (RoundState::Done, false)
            if rounds > 0 && (round.bytes <= CONVERGED_BYTES || rounds >= MAX_SEED_ROUNDS) =>
        {
            CopyStep::CutOver
        }
        // A done round from before the release, an idle agent (restarted),
        // a failed round (the next one resumes it), or not converged yet.
        (RoundState::Done | RoundState::Idle | RoundState::Failed(_), _) => CopyStep::Replicate,
    }
}
