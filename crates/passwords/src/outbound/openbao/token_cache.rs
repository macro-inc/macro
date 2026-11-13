//! Reuse of team-scoped OpenBao service tokens across provider calls.
use crate::domain::models::{Error, TeamId};
use lru::LruCache;
use openbao_client::Session;
use std::{
    future::Future,
    num::NonZeroUsize,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::time::{Duration, Instant};

/// A token is reused only while more than this much of its lease remains,
/// covering the 10-second request bound and clock skew.
const REFRESH_MARGIN: Duration = Duration::from_secs(15);

/// Teams whose tokens are kept; the least recently used team is dropped first.
pub(super) const CAPACITY: NonZeroUsize = NonZeroUsize::new(1024).expect("nonzero capacity");

type Slot = Arc<TeamSlot>;

#[derive(Default)]
struct TeamSlot {
    /// Completed login attempts, readable without waiting for the lock.
    attempts: AtomicU64,
    state: tokio::sync::Mutex<SlotState>,
}

#[derive(Default)]
struct SlotState {
    cached: Option<Cached>,
    last_login_failed: bool,
}

struct Cached {
    session: Session,
    refresh_at: Instant,
    generation: u64,
}

/// One team's token, handed to a single provider call.
#[derive(Debug)]
pub(super) struct Lease {
    pub(super) session: Session,
    pub(super) cache_hit: bool,
    generation: u64,
}

pub(super) struct TokenCache {
    slots: Mutex<LruCache<TeamId, Slot>>,
    generations: AtomicU64,
}

impl TokenCache {
    pub(super) fn new(capacity: NonZeroUsize) -> Self {
        Self {
            slots: Mutex::new(LruCache::new(capacity)),
            generations: AtomicU64::new(0),
        }
    }

    fn slot(&self, team: TeamId) -> Slot {
        self.slots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get_or_insert_mut(team, Slot::default)
            .clone()
    }

    /// Returns the team's live token, or logs in once while concurrent callers
    /// for the same team wait for that login. Callers that waited on a failed
    /// login share its failure instead of each retrying it in turn.
    pub(super) async fn session<Login, Pending>(
        &self,
        team: TeamId,
        login: Login,
    ) -> Result<Lease, Error>
    where
        Login: FnOnce() -> Pending,
        Pending: Future<Output = Result<Session, Error>>,
    {
        let slot = self.slot(team);
        let seen = slot.attempts.load(Ordering::Acquire);
        let mut state = slot.state.lock().await;
        if let Some(entry) = state.cached.as_ref()
            && Instant::now() < entry.refresh_at
        {
            return Ok(Lease {
                session: entry.session.clone(),
                cache_hit: true,
                generation: entry.generation,
            });
        }
        if state.last_login_failed && slot.attempts.load(Ordering::Acquire) != seen {
            return Err(Error::Unavailable);
        }
        state.cached = None;
        // The lease runs from the request, so a slow response cannot extend it.
        let requested = Instant::now();
        let outcome = login().await;
        state.last_login_failed = outcome.is_err();
        slot.attempts.fetch_add(1, Ordering::Release);
        let session = outcome?;
        let generation = self.generations.fetch_add(1, Ordering::Relaxed);
        if let Some(usable) = session.lease_duration().checked_sub(REFRESH_MARGIN) {
            state.cached = Some(Cached {
                session: session.clone(),
                refresh_at: requested + usable,
                generation,
            });
        }
        Ok(Lease {
            session,
            cache_hit: false,
            generation,
        })
    }

    /// Drops the token a rejected call used, unless another caller already replaced it.
    pub(super) async fn invalidate(&self, team: TeamId, lease: &Lease) {
        let slot = self.slot(team);
        let mut state = slot.state.lock().await;
        if state
            .cached
            .as_ref()
            .is_some_and(|entry| entry.generation == lease.generation)
        {
            state.cached = None;
        }
    }
}

#[cfg(test)]
mod test;
