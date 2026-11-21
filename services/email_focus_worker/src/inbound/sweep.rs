//! The hourly sweep: classify threads the event stream missed.
//!
//! Events can be lost, a classification can fail, initial sync emits no
//! events, and a thread can become signal without one. The sweep covers all
//! of these. It covers the inboxes in the Focus rollout: those
//! holding Focus, and those the backfill's looks or mail since the worker
//! started found in it, leaving an inbox being backfilled to the backfill. The
//! first sweep runs at startup and decides rows from an older rule again, from
//! their stored answers. Overlapping sweeps (during a deploy) are harmless: a stored
//! result for a thread's latest message is never sent to the classifier again.

use std::{sync::Arc, time::Duration};

use email::domain::focus::{
    DueDateExtractor, FocusClassifier, FocusEnrollment, FocusNotifier, FocusService, FocusStore,
    ProfileSource,
};
use rootcause::Report;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::metrics::{FocusMetrics, Metric};

/// Threads one sweep checks at most; the next sweep continues past them.
const SWEEP_LIMIT: i64 = 2_000;

/// Sweep every `interval` over the last `window_days` until `shutdown`.
pub async fn run_sweeps<S, P, C, N, D, E>(
    service: Arc<FocusService<S, P, C, N, D, E>>,
    interval: Duration,
    window_days: u16,
    metrics: FocusMetrics,
    shutdown: CancellationToken,
) -> Result<(), Report>
where
    S: FocusStore,
    P: ProfileSource,
    C: FocusClassifier,
    N: FocusNotifier,
    D: DueDateExtractor,
    E: FocusEnrollment,
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
        let started = Instant::now();
        let sweep = tokio::select! {
            biased;
            () = shutdown.cancelled() => return Ok(()),
            result = service.sweep(window, SWEEP_LIMIT) => result,
        };
        match sweep {
            Ok(report) => {
                metrics.observe(Metric::SweepSeconds, started.elapsed().as_secs_f64());
                if report.stopped_early {
                    metrics.add(Metric::SweepsStoppedEarly, 1.0);
                }
                tracing::info!(
                    inboxes = report.inboxes,
                    inboxes_unknown = report.inboxes_unknown,
                    inboxes_left = report.inboxes_left,
                    candidates = report.candidates,
                    classified = report.classified,
                    redecided = report.redecided,
                    skipped = report.skipped,
                    failed = report.failed,
                    stopped_early = report.stopped_early,
                    "focus sweep finished"
                );
            }
            Err(error) => {
                metrics.add(Metric::SweepFailures, 1.0);
                tracing::error!(error = ?error, "focus sweep failed");
            }
        }
    }
}
