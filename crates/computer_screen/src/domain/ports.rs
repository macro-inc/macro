//! What the screen service needs from storage and from the guest.

use std::future::Future;
use std::time::Duration;

use chrono::{DateTime, Utc};
use computer_id::ComputerId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    Access, AgentNotPaused, DriveId, EndReason, Lease, Mode, OwedThaw, PendingNotice, Person,
    RedeemedTicket, Release, ScreenGrant, SessionId, TakeOver, ThawFailed, Thawed,
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

    /// How many sockets seen within `fresh` are open on `computer`: `user`'s
    /// and everyone's.
    fn open_sockets(
        &self,
        computer: ComputerId,
        user: &MacroUserIdStr<'_>,
        fresh: Duration,
    ) -> impl Future<Output = Result<(u32, u32), Self::Err>> + Send;

    /// Claim the agent's notices not yet delivered for `claim_for`, oldest
    /// first, at most a few, none older than `kept`. Notices another request
    /// claimed are not returned until that claim runs out, so two requests
    /// never carry the same notice.
    fn claim_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
        kept: Duration,
        claim_for: Duration,
    ) -> impl Future<Output = Result<Vec<PendingNotice>, Self::Err>> + Send;

    /// Computers whose lease lapsed, at most a few hundred.
    fn lapsed_leases(&self) -> impl Future<Output = Result<Vec<ComputerId>, Self::Err>> + Send;

    /// Ended drives whose agent no thaw has been confirmed for, oldest first,
    /// at most a few hundred.
    fn owed_thaws(&self) -> impl Future<Output = Result<Vec<OwedThaw>, Self::Err>> + Send;

    /// The guest answered a thaw for this drive.
    fn mark_thawed(&self, row: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Forget notices that reached the agent.
    fn delete_notices(&self, ids: &[Uuid]) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Give claimed notices back: the request carrying them failed.
    fn unclaim_notices(&self, ids: &[Uuid]) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Who may use a harness's screen: the harness's permissions and the
/// computer rollout, and which agent its computer runs.
pub trait ScreenAccess: Send + Sync + 'static {
    /// Lookup failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Whether the computer rollout admits `user`.
    fn rollout(&self, user: &MacroUserIdStr<'static>) -> impl Future<Output = bool> + Send;

    /// Whether `user` may use `harness`'s screen in `mode`.
    fn authorize(
        &self,
        user: &MacroUserIdStr<'static>,
        harness: HarnessId,
        mode: Mode,
    ) -> impl Future<Output = Result<Access, Self::Err>> + Send;

    /// The agent teammate `computer` runs, if any.
    fn agent_of(
        &self,
        computer: ComputerId,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, Self::Err>> + Send;
}

/// What the screen needs to know about people, from the crate that owns
/// their accounts.
pub trait People: Send + Sync + 'static {
    /// Lookup failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// `user`'s name and kind; `None` when there is no such account.
    fn person(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Person>, Self::Err>> + Send;
}

/// Tells the guest who drives, through a file the agent can read. Best
/// effort and quick: a computer that can't be reached is logged, never an
/// error, and the caller never waits on the guest.
pub trait DriverSignal: Send + Sync + 'static {
    /// A person drives `lease`'s computer now: the agent on it is frozen
    /// for that drive before this returns, or [`AgentNotPaused`] says it
    /// couldn't be. A computer with no agent running has nothing to freeze.
    /// The guest thaws it on its own unless [`Self::renewed`] keeps it.
    fn driving(&self, lease: &Lease) -> impl Future<Output = Result<(), AgentNotPaused>> + Send;

    /// The drive goes on: keep the agent frozen (off the caller's path).
    fn renewed(&self, lease: &Lease) -> impl Future<Output = ()> + Send;

    /// `drive` ended: thaw the agent, off the caller's path. A thaw for a
    /// drive a newer one superseded leaves the newer freeze alone.
    fn released(&self, computer: ComputerId, drive: DriveId) -> impl Future<Output = ()> + Send;

    /// Thaw the agent for `drive` now, and say how it came out.
    fn thaw(
        &self,
        computer: ComputerId,
        drive: &DriveId,
    ) -> impl Future<Output = Result<Thawed, ThawFailed>> + Send;
}

/// Which computers' leases changed, on every replica.
pub trait LeaseChanges: Send + Sync + 'static {
    /// Every change from now on. A lagging receiver re-reads what it waits
    /// on.
    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<ComputerId>;
}
