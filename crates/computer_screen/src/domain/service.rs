//! Tickets, the driver lease and the agent hold.

use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use computer_id::ComputerId;
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest as _, Sha256};
use tokio::sync::broadcast;

use super::models::{
    AgentNotice, EndReason, IssuedTicket, Lease, Mode, RedeemedTicket, Release, ScreenGrant,
    SessionId, TakeOver, TicketSecret,
};
use super::ports::{DriverSignal, LeaseChanges, ScreenRepo, TicketHash};

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

/// Why a screen operation failed.
#[derive(Debug, thiserror::Error)]
pub enum ScreenError {
    /// A take-over on a view-only ticket.
    #[error("this ticket may only watch")]
    DriveNotAllowed,
    /// Storage failed.
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

/// The screen service over its storage, the guest signal and lease changes.
pub struct ScreenService<Repo, Signal, Changes> {
    repo: Repo,
    signal: Signal,
    changes: Changes,
}

impl<Repo, Signal, Changes> ScreenService<Repo, Signal, Changes>
where
    Repo: ScreenRepo,
    Signal: DriverSignal,
    Changes: LeaseChanges,
{
    /// Build the service.
    pub fn new(repo: Repo, signal: Signal, changes: Changes) -> Self {
        Self {
            repo,
            signal,
            changes,
        }
    }

    /// Issue a single-use ticket for an already authorized `grant`.
    #[tracing::instrument(skip_all, fields(computer.id = %grant.computer_id, screen.mode = %grant.mode), err)]
    pub async fn issue_ticket(
        &self,
        grant: &ScreenGrant,
        traceparent: Option<&str>,
    ) -> Result<IssuedTicket, ScreenError> {
        let secret = TicketSecret::new(URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>()));
        let expires_at = Utc::now() + TICKET_TTL;
        self.repo
            .insert_ticket(ticket_hash(&secret), grant, traceparent, expires_at)
            .await
            .map_err(ScreenError::internal)?;
        Ok(IssuedTicket { secret, expires_at })
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

    /// Open the audit row of a new socket.
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
            .repo
            .user_name(&grant.user_id)
            .await
            .map_err(ScreenError::internal)?;
        let outcome = self
            .repo
            .take_over(grant, session, name, LEASE_TTL)
            .await
            .map_err(ScreenError::internal)?;

        let span = tracing::Span::current();
        match &outcome {
            TakeOver::Taken(lease) => {
                span.record("screen.take_over", "taken");
                self.signal.driving(lease).await;
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

    /// Mark an open socket as still there; due every [`SESSION_TOUCH_EVERY`].
    pub async fn touch_session(&self, id: SessionId) -> Result<(), ScreenError> {
        self.repo
            .touch_session(id)
            .await
            .map_err(ScreenError::internal)
    }

    /// The agent's undelivered notices, delivered now.
    pub async fn take_notices(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Vec<AgentNotice>, ScreenError> {
        self.repo
            .take_notices(agent)
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
