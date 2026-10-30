//! The hourly sweep: classify signal threads the event stream missed.
//!
//! Events can be lost, a classification can fail, initial sync emits no
//! events, and a thread can become signal without one. The sweep covers all
//! of these. The first sweep runs at startup, which backfills a newly
//! allowlisted inbox. Overlapping sweeps (during a deploy) are harmless: a
//! stored result for a thread's latest message is never classified again.

use std::{sync::Arc, time::Duration};

use email::domain::focus::{FocusClassifier, FocusService, FocusStore, ProfileSource};
use rootcause::Report;
use tokio_util::sync::CancellationToken;

/// Threads one sweep classifies at most; the next sweep continues.
const SWEEP_LIMIT: i64 = 2_000;

/// Sweep every `interval` over the last `window_days` until `shutdown`.
pub async fn run_sweeps<S, P, C>(
    service: Arc<FocusService<S, P, C>>,
    interval: Duration,
    window_days: u16,
    shutdown: CancellationToken,
) -> Result<(), Report>
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
{
    let window = chrono::Duration::days(i64::from(window_days));
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            () = shutdown.cancelled() => return Ok(()),
            _ = ticker.tick() => {}
        }
        let sweep = tokio::select! {
            biased;
            () = shutdown.cancelled() => return Ok(()),
            result = service.sweep(window, SWEEP_LIMIT) => result,
        };
        match sweep {
            Ok(report) => tracing::info!(
                candidates = report.candidates,
                classified = report.classified,
                skipped = report.skipped,
                failed = report.failed,
                stopped_early = report.stopped_early,
                "focus sweep finished"
            ),
            Err(error) => tracing::error!(error = ?error, "focus sweep failed"),
        }
    }
}
