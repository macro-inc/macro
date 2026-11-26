//! A user's budget for the streamed sync across streams and server tasks,
//! counted in Redis: how often they may start a stream, and how much page
//! time their streams may spend per hour. Each server task's own limits (one
//! open stream per user, shared page slots) reset with the task; this does
//! not.
//!
//! It guards cost, not access: when Redis cannot answer, the stream runs.

use rate_limit::{RateBudgetPort, RateLimitConfig, RateLimitExceeded, RateLimitKey};
use rootcause::Report;
use std::time::Duration;
use tracing::field::Empty;

/// Stream starts per user per minute. A second pass streams back to back,
/// 15 to 30 s each with a 2 s pause, about 2 to 4 starts a minute.
const STARTS_PER_MINUTE: u64 = 10;
/// Page time per user per hour, in milliseconds. A large account's whole
/// first and second pass takes a few minutes of page time (about 2.5 minutes
/// for the benchmark's L account on a debug build).
const PAGE_MS_PER_HOUR: u64 = 30 * 60 * 1_000;
/// What a start spends of the page time: just enough to be refused once a
/// page took the hour's last millisecond.
const PAGE_MS_TO_START: u64 = 1;
/// The longest a budget read may take. Past it the budget counts as
/// unavailable and the stream runs, so a slow store never holds a stream.
const STORE_TIMEOUT: Duration = Duration::from_millis(250);

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

/// What charging a page did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Charge {
    Charged,
    /// The hour's page time is spent: the stream ends.
    Spent,
    /// The store did not answer; nothing was charged.
    Unavailable,
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

    /// Spends `cost` of `key`'s budget, within [`STORE_TIMEOUT`].
    async fn spend(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
        cost: u64,
    ) -> Result<Result<u64, RateLimitExceeded>, Report> {
        tokio::time::timeout(STORE_TIMEOUT, self.counters.spend(key, config, cost))
            .await
            .unwrap_or_else(|_| Err(rootcause::report!("the budget store timed out")))
    }

    /// Counts a stream start. Refused when the user started too many this
    /// minute or has spent the hour's page time.
    #[tracing::instrument(
        name = "soup.sync_stream.budget_admit",
        skip_all,
        fields(sync.budget_outcome = Empty)
    )]
    pub(super) async fn admit(&self, user: &str) -> Admission {
        let span = tracing::Span::current();
        for (key, config, cost, budget) in [
            (starts_key(user), starts(), 1, "starts"),
            (
                page_time_key(user),
                page_time(),
                PAGE_MS_TO_START,
                "page_time",
            ),
        ] {
            match self.spend(key, config, cost).await {
                Ok(Ok(_)) => {}
                Ok(Err(exceeded)) => {
                    span.record("sync.budget_outcome", budget);
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
                    span.record("sync.budget_outcome", "unavailable");
                    tracing::warn!(error = ?error, sync.budget = budget, "soup sync stream budget unavailable");
                    return Admission::Admitted;
                }
            }
        }
        span.record("sync.budget_outcome", "admitted");
        Admission::Admitted
    }

    /// Charges a page's execution time. [`Charge::Spent`] once the hour's
    /// page time is spent: the page that does not fit takes what is left, so
    /// the next start is refused until the window ends.
    #[tracing::instrument(
        name = "soup.sync_stream.budget_charge",
        skip_all,
        fields(sync.charge_ms = Empty, sync.budget_outcome = Empty)
    )]
    pub(super) async fn charge(&self, user: &str, ran: Duration) -> Charge {
        let span = tracing::Span::current();
        let ms = u64::try_from(ran.as_millis()).unwrap_or(u64::MAX).max(1);
        span.record("sync.charge_ms", i64::try_from(ms).unwrap_or(i64::MAX));
        let charge = match self.spend(page_time_key(user), page_time(), ms).await {
            Ok(Ok(_)) => Charge::Charged,
            Ok(Err(exceeded)) => {
                let left = exceeded.max_count.saturating_sub(exceeded.current_count);
                if left > 0 {
                    // Best effort: a store that fails now refuses nothing.
                    let _ = self.spend(page_time_key(user), page_time(), left).await;
                }
                Charge::Spent
            }
            Err(_) => Charge::Unavailable,
        };
        span.record(
            "sync.budget_outcome",
            match charge {
                Charge::Charged => "charged",
                Charge::Spent => "spent",
                Charge::Unavailable => "unavailable",
            },
        );
        charge
    }
}

#[cfg(test)]
mod test;
