//! How many sessions this replica attaches to external runtimes at once.
//!
//! An attach binds a session onto its runtime's socket, provisions its
//! egress, and has the runtime restore it over ACP (`session/load` or
//! `session/resume`). Every path that does one shares a single
//! [`AttachBudget`]: a runtime's dial, a prompt or delivery that finds its
//! session detached, and notification recovery. A user's prompt draws from
//! permits background work can never take, and background work queues per
//! harness first, so one runtime listing hundreds of sessions neither delays
//! a user nor starves another runtime's dial.

use std::sync::Arc;
use std::time::Duration;

use agent_session::domain::model::AgentSessionId;
use agent_session::domain::session::HANDSHAKE_TIMEOUT;
use dashmap::DashMap;
use harness_id::HarnessId;
use tokio::sync::{AcquireError, OwnedSemaphorePermit, Semaphore, SemaphorePermit};
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// Attaches this replica runs at once, across every path and harness.
pub const ATTACH_CONCURRENCY: usize = 8;
/// Of [`ATTACH_CONCURRENCY`], how many only a user's prompt may hold.
pub const USER_RESERVED_ATTACHES: usize = 2;
/// Background attaches one harness may hold at once.
pub const HARNESS_ATTACH_SHARE: usize = 4;
/// The longest a permit is held waiting for the runtime to restore the
/// session, so a `session/load` that never answers cannot leak it. Longer
/// than the session actor's own handshake deadline, which starts as the
/// session attaches, so the actor gives up on a hung restore first and the
/// permit is normally released by that, not by this bound.
pub const ATTACH_PERMIT_HOLD: Duration = HANDSHAKE_TIMEOUT.saturating_add(Duration::from_secs(5));

/// Why a session is being attached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum AttachPath {
    /// The session's runtime dialed in and still lists it.
    Dial,
    /// A user prompted a detached session.
    Prompt,
    /// Work nobody prompted just now (a system turn, a notification, a
    /// queued action) reached a detached session.
    Delivery,
    /// Notification recovery rebinding a batch that was still running.
    Recovery,
}

impl AttachPath {
    /// Whether a person is waiting on this attach, so it may use the
    /// reserved permits and skips the per-harness share.
    fn is_user(self) -> bool {
        matches!(self, Self::Prompt)
    }
}

/// The per-replica attach limiter. One per harness service.
pub struct AttachBudget {
    total: Semaphore,
    background: Semaphore,
    per_harness: DashMap<HarnessId, Arc<Semaphore>>,
    harness_share: usize,
    hold: Duration,
    /// Acquires begun, for tests to wait on.
    #[cfg(test)]
    requested: tokio::sync::watch::Sender<usize>,
    /// Permits handed out, for tests.
    #[cfg(test)]
    granted: std::sync::atomic::AtomicUsize,
}

impl Default for AttachBudget {
    fn default() -> Self {
        Self::new(
            ATTACH_CONCURRENCY,
            USER_RESERVED_ATTACHES,
            HARNESS_ATTACH_SHARE,
            ATTACH_PERMIT_HOLD,
        )
    }
}

impl AttachBudget {
    /// A budget of `total` permits, `user_reserved` of them only for user
    /// prompts, at most `harness_share` background permits per harness, each
    /// held at most `hold` waiting for a restore.
    #[must_use]
    pub fn new(total: usize, user_reserved: usize, harness_share: usize, hold: Duration) -> Self {
        Self {
            total: Semaphore::new(total),
            background: Semaphore::new(total.saturating_sub(user_reserved)),
            per_harness: DashMap::new(),
            harness_share,
            hold,
            #[cfg(test)]
            requested: tokio::sync::watch::Sender::new(0),
            #[cfg(test)]
            granted: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    /// Wait for a permit to attach `session` on `harness` for `path`.
    ///
    /// Background paths take their harness's share, then a background
    /// permit, then a total one, always in that order; a prompt takes only a
    /// total permit. Dropping the future while it waits gives back whatever
    /// it already took. Errors only if the budget was closed, which nothing
    /// does.
    pub async fn acquire(
        &self,
        path: AttachPath,
        harness: HarnessId,
        session: AgentSessionId,
    ) -> Result<AttachPermit<'_>, AcquireError> {
        let span = tracing::info_span!(
            "agent.runtime.attach_permit",
            %harness,
            agent.session.id = %session,
            agent.runtime.attach_path = <&'static str>::from(path),
            agent.runtime.attach_wait_ms = tracing::field::Empty,
            agent.runtime.attach_permit_timed_out = false,
        );
        #[cfg(test)]
        self.requested.send_modify(|requested| *requested += 1);
        let started = tokio::time::Instant::now();
        let permits = self.take(path, harness).instrument(span.clone()).await;
        let waited = started.elapsed();
        span.record(
            "agent.runtime.attach_wait_ms",
            u64::try_from(waited.as_millis()).unwrap_or(u64::MAX),
        );
        let (harness_permit, background, total) = permits?;
        #[cfg(test)]
        self.granted
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(AttachPermit {
            budget: self,
            harness,
            harness_permit,
            _background: background,
            _total: total,
            span,
        })
    }

    async fn take(
        &self,
        path: AttachPath,
        harness: HarnessId,
    ) -> Result<
        (
            Option<OwnedSemaphorePermit>,
            Option<SemaphorePermit<'_>>,
            SemaphorePermit<'_>,
        ),
        AcquireError,
    > {
        if path.is_user() {
            return Ok((None, None, self.total.acquire().await?));
        }
        let share = Arc::clone(
            self.per_harness
                .entry(harness)
                .or_insert_with(|| Arc::new(Semaphore::new(self.harness_share)))
                .value(),
        );
        let harness_permit = share.acquire_owned().await?;
        let background = self.background.acquire().await?;
        let total = self.total.acquire().await?;
        Ok((Some(harness_permit), Some(background), total))
    }

    /// Permits nobody holds right now, for tests.
    #[cfg(test)]
    pub(crate) fn available(&self) -> usize {
        self.total.available_permits()
    }

    /// Wait until `count` acquires have begun, granted or not.
    #[cfg(test)]
    pub(crate) async fn requested(&self, count: usize) {
        let mut requested = self.requested.subscribe();
        let _reached = requested.wait_for(|requested| *requested >= count).await;
    }

    /// Permits handed out so far, for tests.
    #[cfg(test)]
    pub(crate) fn granted(&self) -> usize {
        self.granted.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Harnesses with a share entry, for tests.
    #[cfg(test)]
    pub(crate) fn tracked_harnesses(&self) -> usize {
        self.per_harness.len()
    }
}

/// One attach's claim on the budget, given back when dropped.
pub struct AttachPermit<'budget> {
    budget: &'budget AttachBudget,
    harness: HarnessId,
    harness_permit: Option<OwnedSemaphorePermit>,
    _background: Option<SemaphorePermit<'budget>>,
    _total: SemaphorePermit<'budget>,
    span: tracing::Span,
}

impl AttachPermit<'_> {
    /// Hold the permit while `restored` runs, for at most the budget's hold
    /// limit, then give it back. `None` when the limit ran out first, which
    /// is recorded on the permit's span. Only the wait is abandoned: the
    /// restore carries on on the session's actor, uncounted.
    pub async fn hold_until<Restored>(self, restored: Restored) -> Option<Restored::Output>
    where
        Restored: Future,
    {
        let outcome = tokio::time::timeout(self.budget.hold, restored).await.ok();
        if outcome.is_none() {
            self.span
                .record("agent.runtime.attach_permit_timed_out", true);
            tracing::warn!(parent: &self.span, "an attach held its permit past the limit; releasing it");
        }
        outcome
    }
}

impl Drop for AttachPermit<'_> {
    fn drop(&mut self) {
        let Some(harness_permit) = self.harness_permit.take() else {
            return;
        };
        drop(harness_permit);
        // Waiters and holders each own a clone, so one left means only the
        // map remembers this harness.
        self.budget
            .per_harness
            .remove_if(&self.harness, |_, share| Arc::strong_count(share) == 1);
    }
}
