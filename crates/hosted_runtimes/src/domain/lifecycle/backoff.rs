//! The one retry backoff every lifecycle wait uses: capacity checks, crash
//! restarts and billing effect retries.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use tokio_retry::strategy::ExponentialBackoff;

/// A doubling delay from `first`, capped at `max`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    /// Delay before the first retry.
    pub first: std::time::Duration,
    /// Longest delay between retries.
    pub max: std::time::Duration,
}

/// Checks of a start blocked by host capacity: 20 s doubling to 10 min.
pub const CAPACITY_BACKOFF: Backoff = Backoff {
    first: std::time::Duration::from_secs(20),
    max: std::time::Duration::from_secs(10 * 60),
};

/// Restarts after a crash: 30 s doubling to 10 min.
pub const RESTART_BACKOFF: Backoff = Backoff {
    first: std::time::Duration::from_secs(30),
    max: std::time::Duration::from_secs(10 * 60),
};

/// Retries of a failed billing effect: 30 s doubling to 1 h.
pub const BILLING_BACKOFF: Backoff = Backoff {
    first: std::time::Duration::from_secs(30),
    max: std::time::Duration::from_secs(60 * 60),
};

/// How long to wait before retry number `attempt` (0 is the first retry).
pub fn backoff(policy: Backoff, attempt: u8) -> Duration {
    // `from_millis(2)` doubles; the factor scales its first delay (2 ms) to `first`.
    let factor = u64::try_from(policy.first.as_millis() / 2).unwrap_or(u64::MAX);
    let mut delays = ExponentialBackoff::from_millis(2)
        .factor(factor)
        .max_delay(policy.max);
    // The strategy never ends: past its range it saturates at `max`.
    let delay = delays.nth(usize::from(attempt)).unwrap_or(policy.max);
    Duration::from_std(delay).unwrap_or(Duration::MAX)
}

/// A pending retry: which attempt it is and when it is due.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Retry {
    /// 0 for the first retry.
    pub attempt: u8,
    /// When the retry may run.
    pub next_at: DateTime<Utc>,
}

impl Retry {
    /// Retry number `attempt`, due one backoff after `now`.
    pub fn after(policy: Backoff, attempt: u8, now: DateTime<Utc>) -> Self {
        Self {
            attempt,
            next_at: now + backoff(policy, attempt),
        }
    }
}
