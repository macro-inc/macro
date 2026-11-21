//! Tickets, the driver lease and the agent hold.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use computer_id::ComputerId;
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest as _, Sha256};
use tokio::sync::broadcast;

use uuid::Uuid;

use super::models::{
    Access, Caller, EndReason, IssuedTicket, Lease, Mode, PendingNotice, RedeemedTicket, Release,
    ScreenGrant, SessionId, TakeOver, TicketRequest, TicketSecret,
};
use super::ports::{DriverSignal, LeaseChanges, People, ScreenAccess, ScreenRepo, TicketHash};

#[cfg(test)]
mod test;

/// How long a ticket works.
pub const TICKET_TTL: Duration = Duration::from_secs(60);
/// How long a lease holds without input, and how long it outlives its
/// closed socket.
pub const LEASE_TTL: Duration = Duration::from_secs(120);
/// How often a held agent re-reads its lease even without a change, in case
/// a notification was lost.
pub const HOLD_RECHECK: Duration = Duration::from_secs(30);
/// How often an open socket says it is still there.
pub const SESSION_TOUCH_EVERY: Duration = Duration::from_secs(30);
/// How long a socket counts as open without saying so: a few missed
/// touches, after which a row a crashed process left open stops counting.
pub const SESSION_FRESH_FOR: Duration = Duration::from_secs(120);
/// How long an undelivered notice is kept for its agent: an agent that
/// makes no brain request for a day (its computer released, say) never
/// hears it.
pub const NOTICE_KEPT_FOR: Duration = Duration::from_secs(24 * 60 * 60);
/// How often each replica runs [`ScreenService::reap`].
pub const REAP_EVERY: Duration = Duration::from_secs(60);
/// How long after a drive ended its agent is thawed again by
/// [`ScreenService::reap`].
pub const THAW_CHECKED_FOR: Duration = Duration::from_secs(10 * 60);
/// How long a brain request holds the notices it carries: past a long
/// streamed turn, so only a crash leaves them for the next one.
pub const NOTICE_CLAIMED_FOR: Duration = Duration::from_secs(15 * 60);
/// Sockets one person may hold open on one computer (a few tabs).
pub const MAX_SOCKETS_PER_VIEWER: u32 = 4;
/// Sockets open on one computer: each costs the guest an RFB client.
pub const MAX_SOCKETS_PER_COMPUTER: u32 = 16;
/// Tickets one person may get per [`TICKET_WINDOW`], on each replica.
pub const MAX_TICKETS_PER_WINDOW: u32 = 30;
/// The window [`MAX_TICKETS_PER_WINDOW`] counts in.
pub const TICKET_WINDOW: Duration = Duration::from_secs(60);

/// Why a screen operation failed.
#[derive(Debug, thiserror::Error)]
pub enum ScreenError {
    /// A take-over on a view-only ticket.
    #[error("this ticket may only watch")]
    DriveNotAllowed,
    /// A program asked: only a person watches or drives a computer.
    #[error("a program cannot watch or drive a computer's screen")]
    ProgramRefused,
    /// An agent teammate's account asked.
    #[error("an agent cannot watch or drive a computer's screen")]
    AgentRefused,
    /// The computer rollout doesn't admit the caller.
    #[error("Macro computers are not enabled for this user")]
    RolloutDisabled,
    /// The caller may not use this harness's screen.
    #[error("you cannot do that on this computer")]
    NoAccess,
    /// No such harness.
    #[error("no such runtime")]
    NotFound,
    /// The harness is not a Macro computer's.
    #[error("this runtime is not a Macro computer")]
    NotAComputer,
    /// Too many tickets in a short time.
    #[error("too many screen tickets; try again in a minute")]
    TooManyTickets,
    /// Too many sockets open on the computer, or by this person on it.
    #[error("too many screens are open on this computer")]
    TooManySockets,
    /// The agent on the computer couldn't be paused, so nobody may take it
    /// over now: it would fight the person for the pointer.
    #[error("the agent on this computer couldn't be paused, so it can't be taken over right now")]
    AgentNotPausable,
    /// Storage or a lookup failed.
    #[error("screen storage failed")]
    Internal(rootcause::Report),
}

impl ScreenError {
    fn internal(error: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}

/// How a held brain request came out of the hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hold {
    /// Nobody drove the agent's computer; it went straight through.
    Free,
    /// It waited for a hand-back.
    Released {
        /// How long it waited.
        waited: Duration,
    },
    /// Someone still drives after the bound.
    TimedOut,
}

/// The screen service over its storage, the guest signal, lease changes,
/// who may use a screen, and who people are.
pub struct ScreenService<Repo, Signal, Changes, Gate, Directory> {
    repo: Repo,
    signal: Signal,
    changes: Changes,
    gate: Gate,
    directory: Directory,
    tickets: TicketLimiter,
}

impl<Repo, Signal, Changes, Gate, Directory> ScreenService<Repo, Signal, Changes, Gate, Directory>
where
    Repo: ScreenRepo,
    Signal: DriverSignal,
    Changes: LeaseChanges,
    Gate: ScreenAccess,
    Directory: People,
{
    /// Build the service.
    pub fn new(
        repo: Repo,
        signal: Signal,
        changes: Changes,
        gate: Gate,
        directory: Directory,
    ) -> Self {
        Self {
            repo,
            signal,
            changes,
            gate,
            directory,
            tickets: TicketLimiter::default(),
        }
    }

    /// Issue a single-use ticket, if the person who asks may watch (or
    /// drive) the harness's computer. Programs and agent accounts never
    /// may: a screen is a person's view of an agent's computer.
    #[tracing::instrument(skip_all, fields(harness.id = %request.harness_id, computer.id = tracing::field::Empty, screen.mode = %request.mode), err)]
    pub async fn issue_ticket(
        &self,
        request: TicketRequest,
        traceparent: Option<&str>,
    ) -> Result<IssuedTicket, ScreenError> {
        if request.caller == Caller::Program {
            return Err(ScreenError::ProgramRefused);
        }
        if !self.gate.rollout(&request.user_id).await {
            return Err(ScreenError::RolloutDisabled);
        }
        let person = self
            .directory
            .person(&request.user_id)
            .await
            .map_err(ScreenError::internal)?;
        match person {
            None => return Err(ScreenError::NoAccess),
            Some(person) if person.is_agent => return Err(ScreenError::AgentRefused),
            Some(_) => {}
        }
        let computer_id = self
            .access(&request.user_id, request.harness_id, request.mode)
            .await?;
        tracing::Span::current().record("computer.id", tracing::field::display(computer_id));
        if !self
            .tickets
            .admit(&request.user_id, tokio::time::Instant::now())
        {
            return Err(ScreenError::TooManyTickets);
        }
        let agent_user_id = self
            .gate
            .agent_of(computer_id)
            .await
            .map_err(ScreenError::internal)?;
        let grant = ScreenGrant {
            harness_id: request.harness_id,
            computer_id,
            agent_user_id,
            user_id: request.user_id,
            transport: request.transport,
            surface: request.surface,
            mode: request.mode,
        };

        let secret = TicketSecret::new(URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>()));
        let expires_at = Utc::now() + TICKET_TTL;
        self.repo
            .insert_ticket(ticket_hash(&secret), &grant, traceparent, expires_at)
            .await
            .map_err(ScreenError::internal)?;
        Ok(IssuedTicket { secret, expires_at })
    }

    /// Whether `grant`'s holder may still use the screen as their ticket
    /// allowed: the rollout and the harness's permissions, again.
    pub async fn reauthorize(&self, grant: &ScreenGrant) -> Result<bool, ScreenError> {
        if !self.gate.rollout(&grant.user_id).await {
            return Ok(false);
        }
        match self
            .access(&grant.user_id, grant.harness_id, grant.mode)
            .await
        {
            Ok(computer) => Ok(computer == grant.computer_id),
            Err(ScreenError::Internal(report)) => Err(ScreenError::Internal(report)),
            Err(_) => Ok(false),
        }
    }

    async fn access(
        &self,
        user: &MacroUserIdStr<'static>,
        harness: harness_id::HarnessId,
        mode: Mode,
    ) -> Result<ComputerId, ScreenError> {
        match self
            .gate
            .authorize(user, harness, mode)
            .await
            .map_err(ScreenError::internal)?
        {
            Access::Granted(computer) => Ok(computer),
            Access::Denied => Err(ScreenError::NoAccess),
            Access::NotFound => Err(ScreenError::NotFound),
            Access::NotAComputer => Err(ScreenError::NotAComputer),
        }
    }

    /// The grant behind a presented ticket, used up; `None` when it is
    /// unknown, used or expired.
    pub async fn redeem(
        &self,
        secret: &TicketSecret,
    ) -> Result<Option<RedeemedTicket>, ScreenError> {
        self.repo
            .redeem_ticket(ticket_hash(secret))
            .await
            .map_err(ScreenError::internal)
    }

    /// Open the audit row of a new socket, unless this person already has
    /// [`MAX_SOCKETS_PER_VIEWER`] open on the computer, or (for a watching
    /// socket) the computer [`MAX_SOCKETS_PER_COMPUTER`]: viewers never lock
    /// a driver out.
    pub async fn open_session(&self, grant: &ScreenGrant) -> Result<SessionId, ScreenError> {
        let id = SessionId::new();
        // Rows a crashed or redeployed process left open end here, on the
        // computer's next socket.
        let lost = self
            .repo
            .end_lost_sessions(grant.computer_id, SESSION_FRESH_FOR)
            .await
            .map_err(ScreenError::internal)?;
        if lost > 0 {
            tracing::info!(lost, "ended screen sockets a gone process left open");
        }
        let (theirs, everyone) = self
            .repo
            .open_sockets(grant.computer_id, &grant.user_id, SESSION_FRESH_FOR)
            .await
            .map_err(ScreenError::internal)?;
        let computer_full = grant.mode == Mode::View && everyone >= MAX_SOCKETS_PER_COMPUTER;
        if theirs >= MAX_SOCKETS_PER_VIEWER || computer_full {
            return Err(ScreenError::TooManySockets);
        }
        self.repo
            .start_session(id, grant)
            .await
            .map_err(ScreenError::internal)?;
        Ok(id)
    }

    /// Close the audit row of a socket. Its lease, if it drives, stays until
    /// it lapses: a reconnect within [`LEASE_TTL`] can take it back.
    pub async fn close_session(
        &self,
        id: SessionId,
        reason: EndReason,
        bytes_to_viewer: u64,
        bytes_from_viewer: u64,
    ) -> Result<(), ScreenError> {
        self.repo
            .end_session(id, reason, bytes_to_viewer, bytes_from_viewer)
            .await
            .map_err(ScreenError::internal)
    }

    /// Take over the computer for `session`.
    #[tracing::instrument(skip_all, fields(computer.id = %grant.computer_id, screen.session.id = %session, screen.take_over = tracing::field::Empty), err)]
    pub async fn take_over(
        &self,
        grant: &ScreenGrant,
        session: SessionId,
    ) -> Result<TakeOver, ScreenError> {
        if grant.mode != Mode::Drive {
            return Err(ScreenError::DriveNotAllowed);
        }

        // A lapsed lease is released first, so its driver's hand-back is
        // recorded before the next one starts.
        self.lease(grant.computer_id).await?;
        let name = self
            .directory
            .person(&grant.user_id)
            .await
            .map_err(ScreenError::internal)?
            .and_then(|person| person.name);
        let outcome = self
            .repo
            .take_over(grant, session, name, LEASE_TTL)
            .await
            .map_err(ScreenError::internal)?;

        let span = tracing::Span::current();
        match &outcome {
            TakeOver::Taken(lease) => {
                if self.signal.driving(lease).await.is_err() {
                    span.record("screen.take_over", "refused");
                    self.repo
                        .release(
                            grant.computer_id,
                            Release::Refused {
                                session_id: session,
                            },
                        )
                        .await
                        .map_err(ScreenError::internal)?;
                    // Thaw whatever part of the freeze took.
                    self.signal.released(grant.computer_id).await;
                    return Err(ScreenError::AgentNotPausable);
                }
                span.record("screen.take_over", "taken");
            }
            TakeOver::Busy(_) => {
                span.record("screen.take_over", "busy");
            }
        }
        Ok(outcome)
    }

    /// Keep `session`'s lease alive after input. `None` when it no longer
    /// drives.
    pub async fn renew(
        &self,
        computer: ComputerId,
        session: SessionId,
    ) -> Result<Option<Lease>, ScreenError> {
        self.repo
            .renew(computer, session, LEASE_TTL)
            .await
            .map_err(ScreenError::internal)
    }

    /// Hand the computer back to the agent, if `user` drives it, from
    /// whichever of their sockets.
    #[tracing::instrument(skip_all, fields(computer.id = %computer, screen.handed_back = tracing::field::Empty), err)]
    pub async fn hand_back(
        &self,
        computer: ComputerId,
        user: MacroUserIdStr<'static>,
        note: Option<String>,
    ) -> Result<Option<Lease>, ScreenError> {
        let released = self
            .repo
            .release(
                computer,
                Release::HandBack {
                    user_id: user,
                    note,
                },
            )
            .await
            .map_err(ScreenError::internal)?;
        tracing::Span::current().record("screen.handed_back", released.is_some());
        if released.is_some() {
            self.signal.released(computer).await;
        }
        Ok(released)
    }

    /// The computer's live lease. A lapsed one is released here.
    pub async fn lease(&self, computer: ComputerId) -> Result<Option<Lease>, ScreenError> {
        let lease = self
            .repo
            .lease(computer)
            .await
            .map_err(ScreenError::internal)?;
        self.live(lease).await
    }

    /// Every lease change from now on, on every replica.
    pub fn changes(&self) -> broadcast::Receiver<ComputerId> {
        self.changes.subscribe()
    }

    /// Wait while a person drives `agent`'s computer, for at most `bound`.
    #[tracing::instrument(skip_all, fields(screen.hold = tracing::field::Empty, computer.id = tracing::field::Empty), err)]
    pub async fn hold_agent(
        &self,
        agent: &MacroUserIdStr<'_>,
        bound: Duration,
    ) -> Result<Hold, ScreenError> {
        let span = tracing::Span::current();

        // Subscribe before reading, so a hand-back between the read and the
        // wait still wakes it.
        let mut changes = self.changes.subscribe();
        let started = tokio::time::Instant::now();
        let deadline = started + bound;
        let mut waited = false;
        loop {
            let lease = self
                .repo
                .agent_lease(agent)
                .await
                .map_err(ScreenError::internal)?;
            let Some(lease) = self.live(lease).await? else {
                let hold = if waited {
                    Hold::Released {
                        waited: started.elapsed(),
                    }
                } else {
                    Hold::Free
                };
                span.record("screen.hold", if waited { "released" } else { "free" });
                return Ok(hold);
            };
            if !waited {
                span.record("computer.id", tracing::field::display(lease.computer_id));
                waited = true;
            }

            // Wake on a change to this computer's lease, when it would
            // lapse, at the bound, or at the safety re-check.
            let until_lapse = (lease.expires_at - Utc::now())
                .to_std()
                .unwrap_or(Duration::ZERO);
            tokio::select! {
                () = tokio::time::sleep_until(deadline) => {
                    span.record("screen.hold", "timed_out");
                    return Ok(Hold::TimedOut);
                }
                () = changed(&mut changes, lease.computer_id) => {}
                () = tokio::time::sleep(until_lapse) => {}
                () = tokio::time::sleep(HOLD_RECHECK) => {}
            }
        }
    }

    /// One round of keeping agents right after a crash or a lost
    /// notification: lapsed leases are released (which thaws their agents),
    /// and agents on computers a drive ended on within [`THAW_CHECKED_FOR`]
    /// are thawed again, in case the process that released them died first.
    /// Due every [`REAP_EVERY`] on each replica.
    #[tracing::instrument(skip_all, fields(screen.lapsed = tracing::field::Empty, screen.thawed = tracing::field::Empty), err)]
    pub async fn reap(&self) -> Result<(), ScreenError> {
        let lapsed = self
            .repo
            .lapsed_leases()
            .await
            .map_err(ScreenError::internal)?;
        tracing::Span::current().record("screen.lapsed", lapsed.len());
        for computer in lapsed {
            self.lease(computer).await?;
        }
        let released = self
            .repo
            .released_within(THAW_CHECKED_FOR)
            .await
            .map_err(ScreenError::internal)?;
        tracing::Span::current().record("screen.thawed", released.len());
        for computer in released {
            self.signal.released(computer).await;
        }
        Ok(())
    }

    /// Mark an open socket as still there; due every [`SESSION_TOUCH_EVERY`].
    pub async fn touch_session(&self, id: SessionId) -> Result<(), ScreenError> {
        self.repo
            .touch_session(id)
            .await
            .map_err(ScreenError::internal)
    }

    /// The agent's notices not yet delivered, claimed for one request: no
    /// other request gets them until [`Self::notices_returned`] gives them
    /// back, or the claim runs out. [`Self::notices_delivered`] says the
    /// request carrying them succeeded.
    pub async fn claim_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Vec<PendingNotice>, ScreenError> {
        self.repo
            .claim_notices(agent, NOTICE_KEPT_FOR, NOTICE_CLAIMED_FOR)
            .await
            .map_err(ScreenError::internal)
    }

    /// The request carrying these notices failed: the next one carries them.
    pub async fn notices_returned(&self, ids: &[Uuid]) -> Result<(), ScreenError> {
        if ids.is_empty() {
            return Ok(());
        }
        self.repo
            .unclaim_notices(ids)
            .await
            .map_err(ScreenError::internal)
    }

    /// The request carrying these notices succeeded: they are delivered.
    pub async fn notices_delivered(&self, ids: &[Uuid]) -> Result<(), ScreenError> {
        if ids.is_empty() {
            return Ok(());
        }
        self.repo
            .delete_notices(ids)
            .await
            .map_err(ScreenError::internal)
    }

    /// `lease` if it still holds; a lapsed one is released, with its
    /// hand-back recorded and the guest told.
    async fn live(&self, lease: Option<Lease>) -> Result<Option<Lease>, ScreenError> {
        let Some(lease) = lease else {
            return Ok(None);
        };
        if lease.is_live(Utc::now()) {
            return Ok(Some(lease));
        }
        let released = self
            .repo
            .release(lease.computer_id, Release::Lapsed)
            .await
            .map_err(ScreenError::internal)?;
        if released.is_some() {
            self.signal.released(lease.computer_id).await;
        }
        Ok(None)
    }
}

/// Tickets per person in a sliding window, on this replica: a person with a
/// stuck reconnect loop can't flood the guest with sockets.
#[derive(Default)]
struct TicketLimiter {
    issued: Mutex<HashMap<String, Vec<tokio::time::Instant>>>,
}

impl TicketLimiter {
    fn admit(&self, user: &MacroUserIdStr<'_>, now: tokio::time::Instant) -> bool {
        // A poisoned lock still holds a usable count.
        let mut issued = self
            .issued
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        issued.retain(|_, times| {
            times.retain(|time| now.duration_since(*time) < TICKET_WINDOW);
            !times.is_empty()
        });
        let times = issued.entry(user.as_ref().to_owned()).or_default();
        if times.len() >= MAX_TICKETS_PER_WINDOW as usize {
            return false;
        }
        times.push(now);
        true
    }
}

/// Resolves on the next change to `computer`'s lease, or when changes were
/// missed.
async fn changed(changes: &mut broadcast::Receiver<ComputerId>, computer: ComputerId) {
    loop {
        match changes.recv().await {
            Ok(changed) if changed == computer => return,
            Ok(_) => {}
            Err(broadcast::error::RecvError::Lagged(_)) => return,
            // No listener any more; the lapse and re-check timers still wake.
            Err(broadcast::error::RecvError::Closed) => std::future::pending::<()>().await,
        }
    }
}

/// What storage keeps of a ticket.
pub fn ticket_hash(secret: &TicketSecret) -> TicketHash {
    Sha256::digest(secret.expose().as_bytes()).into()
}
