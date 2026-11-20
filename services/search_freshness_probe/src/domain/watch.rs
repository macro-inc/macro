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
/// fast phase spans the freshness `target`, so a seen time under it is
/// accurate to `fast`; past it only the five-minute bound matters.
#[derive(Debug, Clone, Copy)]
pub struct Schedule {
    /// Gap between searches at first.
    pub fast: Duration,
    /// How long searches come every `fast`.
    pub fast_for: Duration,
    /// A change shown later than this is late.
    pub target: Duration,
    /// Gap between searches after that.
    pub slow: Duration,
    /// When an unseen change counts as missed.
    pub give_up_after: Duration,
    /// How long searches may fail in a row before the round ends as a search
    /// failure. A round in an outage then lasts this long rather than the
    /// whole five minutes, so an outage fails a round every minute.
    pub failing_for: Duration,
}

impl Schedule {
    /// The objective's 60 s and 5 minutes.
    pub const PRODUCTION: Self = Self {
        fast: Duration::from_secs(1),
        fast_for: Duration::from_secs(60),
        target: Duration::from_secs(60),
        slow: Duration::from_secs(5),
        give_up_after: Duration::from_secs(300),
        failing_for: Duration::from_secs(30),
    };

    /// A round that tests recall rather than speed, with an expensive query:
    /// every 5 s throughout, so its seen time is accurate to 5 s.
    pub const RECALL: Self = Self {
        fast: Duration::from_secs(5),
        ..Self::PRODUCTION
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
    /// `Seen`, `Late`, `Unseen` or `SearchFailed`.
    pub outcome: Outcome,
    /// Polls run, each one search per check.
    pub polls: u32,
    /// Polls whose search failed.
    pub failed_polls: u32,
}

/// Searches on `schedule` until every check holds in the same poll, and says
/// how long after `written_at` that poll answered. A failed poll is retried at
/// the next one. The round ends `SearchFailed` when searches have failed for
/// `failing_for` in a row, or when the last poll before the deadline failed:
/// then search's state is unknown, so the round is not a miss.
pub async fn watch<S: Search>(
    search: &S,
    checks: &[Check],
    schedule: Schedule,
    written_at: Instant,
) -> Watched {
    let deadline = written_at + schedule.give_up_after;
    let mut polls = 0;
    let mut failed_polls = 0;
    // When the current run of failed polls began.
    let mut failing_since: Option<Instant> = None;

    loop {
        let started = Instant::now();
        polls += 1;
        let poll = try_join_all(checks.iter().map(|check| async move {
            let hits = search.hits(&check.query).await?;
            Ok::<_, S::Err>(check.holds(&hits))
        }))
        .await;
        let answered = Instant::now();

        match poll {
            Ok(results) if results.iter().all(|holds| *holds) => {
                let after = answered - written_at;
                let outcome = if after <= schedule.target {
                    Outcome::Seen(after)
                } else {
                    Outcome::Late(after)
                };
                return Watched {
                    outcome,
                    polls,
                    failed_polls,
                };
            }
            Ok(_) => failing_since = None,
            Err(error) => {
                failed_polls += 1;
                let since = *failing_since.get_or_insert(started);
                if answered - since >= schedule.failing_for || answered >= deadline {
                    tracing::warn!(
                        error = ?error,
                        polls,
                        failed_polls,
                        "search kept failing during a probe round"
                    );
                    return Watched {
                        outcome: Outcome::SearchFailed,
                        polls,
                        failed_polls,
                    };
                }
            }
        }

        if answered >= deadline {
            return Watched {
                outcome: Outcome::Unseen,
                polls,
                failed_polls,
            };
        }

        let next = started + schedule.gap_after(started - written_at);
        tokio::time::sleep_until(next.min(deadline)).await;
    }
}
