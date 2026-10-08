//! Waiting out source rate limits. Adapters report a throttled read with the
//! provider's `Retry-After`; the domain decides how long to wait, retries
//! once, and paces reads that share a per-user quota.

use crate::domain::ports::{ApiSourceError, SlackSourceError};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::time::Instant;

#[cfg(test)]
mod test;

/// Wait used when a throttled read names no `Retry-After`.
const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(5);
/// Longest wait before the one retry.
const RATE_LIMIT_MAX_SLEEP: Duration = Duration::from_secs(30);

/// A source read error that may be a rate limit.
pub(super) trait RateLimitError {
    /// How long to wait before retrying, when the source refused the read
    /// for rate limiting; `None` for every other failure.
    fn retry_delay(&self) -> Option<Duration>;
}

impl RateLimitError for SlackSourceError {
    fn retry_delay(&self) -> Option<Duration> {
        match self {
            Self::RateLimited { retry_after } => Some(retry_after.unwrap_or(DEFAULT_RETRY_AFTER)),
            _ => None,
        }
    }
}

impl RateLimitError for ApiSourceError {
    fn retry_delay(&self) -> Option<Duration> {
        match self {
            Self::RateLimited { retry_after, .. } => {
                Some(retry_after.unwrap_or(DEFAULT_RETRY_AFTER))
            }
            _ => None,
        }
    }
}

/// Run `read`, and once more after the source's `Retry-After` when it was
/// rate limited.
pub(super) async fn retry_rate_limited<T, E, F, Fut>(mut read: F) -> Result<T, E>
where
    E: RateLimitError,
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    match read().await {
        Err(error) => match error.retry_delay() {
            Some(delay) => {
                tokio::time::sleep(delay.min(RATE_LIMIT_MAX_SLEEP)).await;
                read().await
            }
            None => Err(error),
        },
        read => read,
    }
}

/// Spaces each user's reads of one source at least `interval` apart, across
/// every batch running for that user in this process.
pub(crate) struct UserPacers {
    interval: Duration,
    pacers: Mutex<HashMap<String, Weak<Pacer>>>,
}

impl UserPacers {
    pub(crate) fn new(interval: Duration) -> Self {
        Self {
            interval,
            pacers: Mutex::default(),
        }
    }

    /// The pacer shared by every open reader for `user`.
    pub(crate) fn pacer(&self, user: &MacroUserIdStr<'static>) -> Arc<Pacer> {
        let mut pacers = self.pacers.lock().unwrap();
        pacers.retain(|_, pacer| pacer.strong_count() > 0);
        if let Some(pacer) = pacers.get(user.as_ref()).and_then(Weak::upgrade) {
            return pacer;
        }
        let pacer = Arc::new(Pacer {
            interval: self.interval,
            next: tokio::sync::Mutex::new(Instant::now()),
        });
        pacers.insert(user.as_ref().to_string(), Arc::downgrade(&pacer));
        pacer
    }
}

/// One user's read schedule.
pub(crate) struct Pacer {
    interval: Duration,
    next: tokio::sync::Mutex<Instant>,
}

impl Pacer {
    /// Wait until this user's next read may start.
    pub(crate) async fn wait_turn(&self) {
        let mut next = self.next.lock().await;
        let now = Instant::now();
        if *next > now {
            tokio::time::sleep_until(*next).await;
        }
        *next = (*next).max(now) + self.interval;
    }
}
