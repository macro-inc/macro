//! A user's budget for the streamed sync across streams and server tasks,
//! counted in Redis: how often they may start a stream, and how much page
//! time their streams may spend per hour. Each server task's own limits (one
//! open stream per user, shared page slots) reset with the task; this does
//! not.
//!
//! It guards cost, not access: when Redis cannot answer, the stream runs.

use rate_limit::{RateBudgetPort, RateLimitConfig, RateLimitKey};
use std::time::Duration;

/// Stream starts per user per minute. A second pass streams back to back,
/// 15 to 30 s each with a 2 s pause, about 2 to 4 starts a minute.
const STARTS_PER_MINUTE: u64 = 10;
/// Page time per user per hour, in milliseconds. A large account's whole
/// first and second pass takes a few minutes of page time (about 2.5 minutes
/// for the benchmark's L account on a debug build).
const PAGE_MS_PER_HOUR: u64 = 30 * 60 * 1_000;
/// Page time a stream needs left to start: about one page.
const PAGE_MS_TO_START: u64 = 1_000;

fn starts() -> RateLimitConfig {
    RateLimitConfig::new(STARTS_PER_MINUTE, Duration::from_secs(60))
}

fn page_time() -> RateLimitConfig {
    RateLimitConfig::new(PAGE_MS_PER_HOUR, Duration::from_secs(60 * 60))
}

fn starts_key(user: &str) -> RateLimitKey {
    RateLimitKey::builder(&"soup-sync-stream-start")
        .append(&user)
        .finish()
}

fn page_time_key(user: &str) -> RateLimitKey {
    RateLimitKey::builder(&"soup-sync-stream-page-ms")
        .append(&user)
        .finish()
}

/// Whether a user may start a stream now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Admission {
    Admitted,
    /// Over budget: ask again after this long.
    Refused {
        retry_after: Duration,
    },
}

/// The budget, over a store of counters that expire with their window.
#[derive(Clone)]
pub(super) struct SyncStreamBudget<B> {
    counters: B,
}

impl<B: RateBudgetPort> SyncStreamBudget<B> {
    pub(super) fn new(counters: B) -> Self {
        Self { counters }
    }

    /// Counts a stream start. Refused when the user started too many this
    /// minute or has less than a page of page time left this hour.
    pub(super) async fn admit(&self, user: &str) -> Admission {
        for (key, config, cost, budget) in [
            (starts_key(user), starts(), 1, "starts"),
            (
                page_time_key(user),
                page_time(),
                PAGE_MS_TO_START,
                "page_time",
            ),
        ] {
            match self.counters.spend(key, config, cost).await {
                Ok(Ok(_)) => {}
                Ok(Err(exceeded)) => {
                    tracing::warn!(
                        sync.budget = budget,
                        sync.retry_after_s =
                            i64::try_from(exceeded.retry_after.as_secs()).unwrap_or(i64::MAX),
                        "soup sync stream refused: the user's budget is spent"
                    );
                    return Admission::Refused {
                        retry_after: exceeded.retry_after,
                    };
                }
                Err(error) => {
                    tracing::warn!(error = ?error, sync.budget = budget, "soup sync stream budget unavailable");
                }
            }
        }
        Admission::Admitted
    }

    /// Charges a page's execution time. `false` once the hour's page time is
    /// spent: the page that does not fit takes what is left, so the next
    /// start is refused until the window ends.
    pub(super) async fn charge(&self, user: &str, ran: Duration) -> bool {
        let ms = u64::try_from(ran.as_millis()).unwrap_or(u64::MAX).max(1);
        match self
            .counters
            .spend(page_time_key(user), page_time(), ms)
            .await
        {
            Ok(Ok(_)) => true,
            Ok(Err(exceeded)) => {
                let left = exceeded.max_count.saturating_sub(exceeded.current_count);
                if left > 0
                    && let Err(error) = self
                        .counters
                        .spend(page_time_key(user), page_time(), left)
                        .await
                {
                    tracing::warn!(error = ?error, "soup sync stream budget unavailable");
                }
                false
            }
            Err(error) => {
                tracing::warn!(error = ?error, "soup sync stream budget unavailable");
                true
            }
        }
    }
}

#[cfg(test)]
mod test;
