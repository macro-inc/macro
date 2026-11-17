//! What the supervisor needs from the outside: account locks, the account
//! directory, and a runner per leased account.

use std::future::Future;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// Errors from taking, holding or announcing account locks.
#[derive(Debug, thiserror::Error)]
pub enum LeaseError {
    /// The lock connection is gone, so every lock it held may already be free.
    #[error("the account lock connection was lost")]
    Lost,
    /// Any other storage failure.
    #[error("account lease storage failed: {0}")]
    Internal(rootcause::Report),
}

/// Session-level advisory locks, one per account, held by this replica.
pub trait AccountLocks: Send + Sync + 'static {
    /// Takes the account's lock without waiting. `false` when another replica
    /// holds it.
    fn try_lock(&self, account: Uuid) -> impl Future<Output = Result<bool, LeaseError>> + Send;

    /// Releases a lock this replica holds.
    fn unlock(&self, account: Uuid) -> impl Future<Output = Result<(), LeaseError>> + Send;

    /// Cancelled as soon as the locks may be gone. Accounts must stop at once.
    fn lost(&self) -> CancellationToken;
}

/// Finds accounts that need a replica and tells other replicas about releases.
pub trait AccountDirectory: Send + Sync + 'static {
    /// Accounts that need a session and that no replica holds, oldest first.
    fn candidates(&self, limit: u32) -> impl Future<Output = Result<Vec<Uuid>, LeaseError>> + Send;

    /// The account a [`crate::supervisor::FleetSignal::Keyed`] key belongs to
    /// (WhatsApp: a pairing transaction's).
    fn resolve(&self, key: Uuid) -> impl Future<Output = Result<Option<Uuid>, LeaseError>> + Send;

    /// `NOTIFY <service>_account_released`: the account still needs a session
    /// and is free to take.
    fn announce_released(
        &self,
        account: Uuid,
    ) -> impl Future<Output = Result<(), LeaseError>> + Send;

    /// Fleet-wide facts for the periodic health report.
    fn health(&self) -> impl Future<Output = Result<FleetHealth, LeaseError>> + Send;
}

/// Fleet-wide facts every replica reports once a minute.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FleetHealth {
    /// Accounts that need a session but whose lock no replica holds.
    pub accounts_unowned: u64,
    /// Age of the oldest inbound event still waiting to be applied.
    pub oldest_unprocessed_inbound_seconds: u64,
}

/// A signal and the span of the notification it came from, so the work it
/// causes continues the sender's trace. Signals without one (rescans,
/// resyncs) carry [`tracing::Span::none`].
#[derive(Debug, Clone)]
pub struct Traced<SignalKind> {
    /// The signal.
    pub signal: SignalKind,
    /// `session_fleet.signal.receive` of the notification, or none.
    pub span: tracing::Span,
}

impl<SignalKind> From<SignalKind> for Traced<SignalKind> {
    fn from(signal: SignalKind) -> Self {
        Traced {
            signal,
            span: tracing::Span::none(),
        }
    }
}

/// What a runner receives for its account.
pub struct AccountControl<Signal> {
    /// Signals for this account, coalesced when the runner is busy.
    pub signals: mpsc::Receiver<Traced<Signal>>,
    /// The span that started the runner (a notification, a rescan); the
    /// account's connect span links to it.
    pub cause: tracing::Span,
    /// Graceful release (drain): stop taking sends, wait for in-flight
    /// acknowledgements, disconnect, then return [`AccountExit::Released`].
    pub release: CancellationToken,
    /// Hard stop: the lock is gone. Return without another write.
    pub stop: CancellationToken,
}

/// Why a runner returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountExit {
    /// Nothing to run: the account needs no session. Not announced.
    Idle,
    /// Released on request while the account still needs a session.
    Released,
    /// Another replica took the account over.
    Fenced,
    /// Stopped by `stop`.
    Stopped,
    /// Gave up after an error. Not announced, so a failing account doesn't
    /// bounce between replicas; the next rescan retries it.
    Failed,
}

/// Runs one account for as long as this replica holds its lock.
pub trait AccountRunner: Send + Sync + 'static {
    /// What the runner is told about its account.
    type Signal: Send + 'static;

    /// Runs `account` until it is idle, released, fenced or stopped.
    fn run(
        &self,
        account: Uuid,
        control: AccountControl<Self::Signal>,
    ) -> impl Future<Output = AccountExit> + Send;
}
