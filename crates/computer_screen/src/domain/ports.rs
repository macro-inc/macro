//! What the screen service needs from storage and from the guest.

use std::future::Future;
use std::time::Duration;

use chrono::{DateTime, Utc};
use computer_id::ComputerId;
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{
    AgentNotice, EndReason, Lease, RedeemedTicket, Release, ScreenGrant, SessionId, TakeOver,
};

/// The SHA-256 of a ticket secret: all storage ever sees of it.
pub type TicketHash = [u8; 32];

/// Tickets, audit rows, driver leases and agent notices. Lease changes
/// notify [`LeaseChanges`] listeners when their transaction commits.
pub trait ScreenRepo: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Store a ticket for `grant` until `expires_at`.
    fn insert_ticket(
        &self,
        hash: TicketHash,
        grant: &ScreenGrant,
        traceparent: Option<&str>,
        expires_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Use up a ticket: its grant if it exists and has not expired, and it
    /// never works again either way.
    fn redeem_ticket(
        &self,
        hash: TicketHash,
    ) -> impl Future<Output = Result<Option<RedeemedTicket>, Self::Err>> + Send;

    /// Open the audit row of a socket.
    fn start_session(
        &self,
        id: SessionId,
        grant: &ScreenGrant,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Close the audit row of a socket. Closing it twice keeps the first.
    fn end_session(
        &self,
        id: SessionId,
        reason: EndReason,
        bytes_to_viewer: u64,
        bytes_from_viewer: u64,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Make `session` the driver of `grant`'s computer until `ttl` from now,
    /// unless another user holds a live lease. The same user taking over
    /// again (from another tab) moves the lease to the new socket. Records a
    /// take-over notice for the agent when the lease is new.
    fn take_over(
        &self,
        grant: &ScreenGrant,
        session: SessionId,
        driver_name: Option<String>,
        ttl: Duration,
    ) -> impl Future<Output = Result<TakeOver, Self::Err>> + Send;

    /// Push the lease's expiry to `ttl` from now, if `session` drives.
    fn renew(
        &self,
        computer: ComputerId,
        session: SessionId,
        ttl: Duration,
    ) -> impl Future<Output = Result<Option<Lease>, Self::Err>> + Send;

    /// Let the lease go as `release` says: a hand-back by the socket that
    /// drives, or a lapse once it has expired. Records the hand-back notice.
    /// `None` when there was nothing to release.
    fn release(
        &self,
        computer: ComputerId,
        release: Release,
    ) -> impl Future<Output = Result<Option<Lease>, Self::Err>> + Send;

    /// The computer's lease, expired or not.
    fn lease(
        &self,
        computer: ComputerId,
    ) -> impl Future<Output = Result<Option<Lease>, Self::Err>> + Send;

    /// The lease on the computer that runs `agent`, expired or not.
    fn agent_lease(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Lease>, Self::Err>> + Send;

    /// End `computer`'s socket rows not seen within `fresh` as
    /// [`EndReason::Lost`], at the time they were last seen.
    fn end_lost_sessions(
        &self,
        computer: ComputerId,
        fresh: Duration,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// Mark an open socket as still there.
    fn touch_session(&self, id: SessionId) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Which of `computers` someone watches (an open socket seen within
    /// `fresh`) or drives (a live lease).
    fn computers_in_use(
        &self,
        computers: &[ComputerId],
        fresh: Duration,
    ) -> impl Future<Output = Result<Vec<ComputerId>, Self::Err>> + Send;

    /// The agent's undelivered notices, oldest first, marked delivered.
    fn take_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<AgentNotice>, Self::Err>> + Send;

    /// The user's display name, if their profile has one.
    fn user_name(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// Tells the guest who drives, through a file the agent can read. Best
/// effort: a computer that can't be reached is logged, never an error.
pub trait DriverSignal: Send + Sync + 'static {
    /// A person drives `computer` now.
    fn driving(&self, lease: &Lease) -> impl Future<Output = ()> + Send;

    /// Nobody drives `computer` any more.
    fn released(&self, computer: ComputerId) -> impl Future<Output = ()> + Send;
}

/// Which computers' leases changed, on every replica.
pub trait LeaseChanges: Send + Sync + 'static {
    /// Every change from now on. A lagging receiver re-reads what it waits
    /// on.
    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<ComputerId>;
}
