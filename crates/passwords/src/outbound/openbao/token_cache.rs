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

/// Service tokens have a 60-second maximum TTL; a longer lease from the
/// provider is never trusted beyond it.
const MAX_LEASE: Duration = Duration::from_secs(60);

/// A token is reused only while more than this much of its lease remains:
/// two 10-second requests, the most a read operation makes. Longer operations
/// rely on `with_session` re-running them after a rejected token.
const REFRESH_MARGIN: Duration = Duration::from_secs(20);

/// Teams whose idle slots are kept; the least recently used idle team is
/// dropped first. Slots in use by a caller are never evicted.
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
    capacity: NonZeroUsize,
    generations: AtomicU64,
}

impl TokenCache {
    pub(super) fn new(capacity: NonZeroUsize) -> Self {
        Self {
            slots: Mutex::new(LruCache::unbounded()),
            capacity,
            generations: AtomicU64::new(0),
        }
    }

    fn slot(&self, team: TeamId) -> Slot {
        let mut slots = self
            .slots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(slot) = slots.get(&team) {
            return slot.clone();
        }
        // Only the map holds an idle slot. A slot a caller holds keeps its
        // single-flight login, so the map may briefly exceed capacity.
        while slots.len() >= self.capacity.get() {
            let Some(idle) = slots
                .iter()
                .rev()
                .find(|(_, slot)| Arc::strong_count(slot) == 1)
                .map(|(team, _)| *team)
            else {
                break;
            };
            slots.pop(&idle);
        }
        slots.get_or_insert(team, Slot::default).clone()
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
        self.acquire(team, None, login).await
    }

    /// Replaces a token the provider rejected. If another caller already
    /// replaced it, returns that newer token without logging in again.
    pub(super) async fn replace<Login, Pending>(
        &self,
        team: TeamId,
        rejected: &Lease,
        login: Login,
    ) -> Result<Lease, Error>
    where
        Login: FnOnce() -> Pending,
        Pending: Future<Output = Result<Session, Error>>,
    {
        self.acquire(team, Some(rejected.generation), login).await
    }

    async fn acquire<Login, Pending>(
        &self,
        team: TeamId,
        rejected: Option<u64>,
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
            && Some(entry.generation) != rejected
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
        if let Some(refresh_at) = session
            .lease_duration()
            .min(MAX_LEASE)
            .checked_sub(REFRESH_MARGIN)
            .and_then(|usable| requested.checked_add(usable))
        {
            state.cached = Some(Cached {
                session: session.clone(),
                refresh_at,
                generation,
            });
        }
        Ok(Lease {
            session,
            cache_hit: false,
            generation,
        })
    }
}

#[cfg(test)]
mod test;
