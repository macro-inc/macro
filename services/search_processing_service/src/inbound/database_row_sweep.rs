//! Periodically removes database row documents whose rows are gone.
//!
//! Live events cover writes through the databases service; this sweep covers
//! what they cannot: a lost event, and rows or tables removed by paths that
//! publish nothing. Every task runs the loop, and one at a time leads each
//! round (`DatabaseRowIndexService::sweep_stale_once`).

use std::{sync::Arc, time::Duration};

use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

/// How often a task tries to lead a sweep.
pub(crate) const STALE_SWEEP_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// Sweep every `interval` until `cancel`, starting one interval from now so
/// a deploy's tasks do not all sweep as they start.
pub(crate) async fn run_stale_sweeps(
    indexer: Arc<crate::DatabaseRowIndexer>,
    interval: Duration,
    cancel: CancellationToken,
) {
    let mut ticks = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            () = cancel.cancelled() => return,
            _ = ticks.tick() => {}
        }
        // One span per round, so each round is its own finished trace.
        let round = tracing::info_span!("database_rows.stale_sweep");
        // The error is recorded on the round's span; the next round retries.
        let _ = indexer.sweep_stale_once(&cancel).instrument(round).await;
    }
}
