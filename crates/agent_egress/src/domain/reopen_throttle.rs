//! Holding back a sandbox that reopens an MCP event stream in a loop.
//!
//! Seen live (prod, 2026-09-26): one session's MCP client re-issued the GET
//! for a connected server's event stream 380 times at exactly one a second,
//! for six and a half minutes. Whatever the upstream was answering — a
//! stream it closed at once, a status the client did not take for an
//! answer — the client's reconnect had no backoff of its own, and every
//! attempt went upstream stamped with the owner's credential.
//!
//! The proxy cannot fix the client, and it must not answer for the upstream:
//! the reopen may be legitimate, and refusing it would break a stream that
//! merely dropped. What it can do is pace. A few reopens a minute pass at
//! once; past that each is held a little longer before it goes upstream, so
//! a storm settles to a trickle while a client that reconnects once is
//! never delayed.

#[cfg(test)]
mod test;

use std::collections::VecDeque;
use std::num::NonZeroUsize;
use std::time::{Duration, Instant};

use lru::LruCache;

use crate::domain::model::AgentSessionId;

/// Event-stream opens one session may make on one upstream within
/// [`REOPEN_WINDOW`] before further opens are held back.
///
/// A client that keeps one stream open reconnects when it drops, which is
/// rarely, and a handshake may open a second while the first is closing.
/// Six a minute is far past both.
pub const REOPENS_ALLOWED: usize = 6;

/// The sliding window [`REOPENS_ALLOWED`] counts within.
pub const REOPEN_WINDOW: Duration = Duration::from_secs(60);

/// The first hold past the allowance; each further open doubles it.
pub const REOPEN_HOLD_BASE: Duration = Duration::from_secs(1);

/// The longest any one open is held.
///
/// Long enough that a one-a-second storm becomes four a minute; short
/// enough that a client whose upstream has recovered is streaming again
/// within the quarter minute.
pub const REOPEN_HOLD_CEILING: Duration = Duration::from_secs(15);

/// Sessions times upstreams remembered at once. Past this the oldest is
/// forgotten, which for a storm still in progress means one free burst.
const TRACKED_STREAMS: NonZeroUsize = match NonZeroUsize::new(4096) {
    Some(capacity) => capacity,
    None => panic!("the capacity is a non-zero literal"),
};

/// One session's recent opens on one upstream.
#[derive(Debug, Default)]
pub struct RecentReopens {
    opened: VecDeque<Instant>,
}

impl RecentReopens {
    /// Record an open at `now` and answer with how long to hold it: nothing
    /// within the allowance, then a hold that doubles with each open past
    /// it, up to [`REOPEN_HOLD_CEILING`].
    ///
    /// Also answers how many opens the window now holds, for the log line.
    pub fn admit(&mut self, now: Instant) -> Admission {
        while self
            .opened
            .front()
            .is_some_and(|at| now.saturating_duration_since(*at) > REOPEN_WINDOW)
        {
            self.opened.pop_front();
        }
        self.opened.push_back(now);
        let recent = self.opened.len();
        let excess = recent.saturating_sub(REOPENS_ALLOWED);
        let hold = if excess == 0 {
            Duration::ZERO
        } else {
            // `excess - 1` doublings of the base, capped before the shift
            // can overflow: 2^63 seconds is past any ceiling.
            let doublings = u32::try_from(excess - 1).unwrap_or(u32::MAX).min(20);
            REOPEN_HOLD_BASE
                .checked_mul(1 << doublings)
                .unwrap_or(REOPEN_HOLD_CEILING)
                .min(REOPEN_HOLD_CEILING)
        };
        Admission { recent, hold }
    }
}

/// What one open was admitted as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Admission {
    /// Opens in the window, this one included.
    pub recent: usize,
    /// How long to hold this open before it goes upstream; zero within the
    /// allowance.
    pub hold: Duration,
}

impl Admission {
    /// Whether this open is past the allowance.
    pub fn is_held(&self) -> bool {
        !self.hold.is_zero()
    }
}

/// The reopen history of every (session, upstream) pair seen recently.
///
/// Bounded by [`TRACKED_STREAMS`]: sessions come and go, and a map that only
/// grew would be the one leak in a proxy whose bodies are otherwise
/// streamed.
#[derive(Debug)]
pub struct ReopenThrottle {
    recent: std::sync::Mutex<LruCache<(AgentSessionId, String), RecentReopens>>,
}

impl Default for ReopenThrottle {
    fn default() -> Self {
        Self {
            recent: std::sync::Mutex::new(LruCache::new(TRACKED_STREAMS)),
        }
    }
}

impl ReopenThrottle {
    /// Record that `session` is opening `upstream`'s event stream now.
    pub fn admit(&self, session: &AgentSessionId, upstream: &str) -> Admission {
        self.admit_at(session, upstream, Instant::now())
    }

    /// [`Self::admit`] at a stated instant.
    pub fn admit_at(&self, session: &AgentSessionId, upstream: &str, now: Instant) -> Admission {
        let mut recent = self.recent.lock().expect("reopen throttle poisoned");
        recent
            .get_or_insert_mut((*session, upstream.to_owned()), RecentReopens::default)
            .admit(now)
    }
}
