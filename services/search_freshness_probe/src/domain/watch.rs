//! Polling search after a write until the change shows or the round gives up.

use std::time::Duration;

use futures::future::try_join_all;
use tokio::time::Instant;

use super::model::{Check, Outcome};
use super::ports::Search;

#[cfg(test)]
mod test;

/// When a round searches: every `fast` for the first `fast_for`, then every
/// `slow` until `give_up_after`, all from the write's acknowledgement. The
/// fast phase spans the freshness target, so a seen time under it is accurate
/// to `fast`; past it only the five-minute bound matters.
#[derive(Debug, Clone, Copy)]
pub struct Schedule {
    /// Gap between searches at first.
    pub fast: Duration,
    /// How long searches come every `fast`.
    pub fast_for: Duration,
    /// Gap between searches after that.
    pub slow: Duration,
    /// When an unseen change counts as missed.
    pub give_up_after: Duration,
}

impl Schedule {
    /// The objective's 60 s and 5 minutes.
    pub const PRODUCTION: Self = Self {
        fast: Duration::from_secs(1),
        fast_for: Duration::from_secs(60),
        slow: Duration::from_secs(5),
        give_up_after: Duration::from_secs(300),
    };

    fn gap_after(&self, elapsed: Duration) -> Duration {
        if elapsed < self.fast_for {
            self.fast
        } else {
            self.slow
        }
    }
}

/// How the watch ended, and how many searches it took.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Watched {
    /// `Seen`, `Unseen` or `SearchFailed`.
    pub outcome: Outcome,
    /// Polls run, each one search per check.
    pub polls: u32,
}

/// Searches on `schedule` until every check holds in the same poll, and says
/// how long after `written_at` that poll answered. A failed poll is retried at
/// the next one; the round ends `SearchFailed` only when the last poll before
/// giving up failed, since then search's state at the deadline is unknown.
pub async fn watch<S: Search>(
    search: &S,
    checks: &[Check],
    schedule: Schedule,
    written_at: Instant,
) -> Watched {
    let deadline = written_at + schedule.give_up_after;
    let mut polls = 0;

    loop {
        let started = Instant::now();
        polls += 1;
        let poll = try_join_all(checks.iter().map(|check| async move {
            let hits = search.hits(&check.query).await?;
            Ok::<_, S::Err>(check.holds(&hits))
        }))
        .await;
        let answered = Instant::now();

        let last_failed = match poll {
            Ok(results) if results.iter().all(|holds| *holds) => {
                return Watched {
                    outcome: Outcome::Seen(answered - written_at),
                    polls,
                };
            }
            Ok(_) => false,
            Err(error) => {
                tracing::warn!(error = ?error, polls, "search failed during a probe round");
                true
            }
        };

        if answered >= deadline {
            let outcome = if last_failed {
                Outcome::SearchFailed
            } else {
                Outcome::Unseen
            };
            return Watched { outcome, polls };
        }

        let next = started + schedule.gap_after(started - written_at);
        tokio::time::sleep_until(next.min(deadline)).await;
    }
}
