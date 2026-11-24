//! Periodically catches the database rows index up with what events missed.
//!
//! Live events cover writes through the databases service. Every round
//! catches up tables whose events were lost; every
//! [`ROUNDS_PER_INDEX_SCAN`]th round also walks the whole index for documents
//! whose rows or tables are gone and reindexes tables whose columns or
//! options changed outside their journal, both of which read whole tables. Every task runs the loop, and one at a time
//! leads each round (`DatabaseRowIndexService::sweep_once`). Its passes wait
//! on the backfill gate: the first round after a deploy reindexes every
//! table, which is a backfill in all but name.

use std::{sync::Arc, time::Duration};

use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

/// How often a task tries to lead a round.
pub(crate) const SWEEP_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Rounds between walks of the whole index: every six hours.
pub(crate) const ROUNDS_PER_INDEX_SCAN: u32 = 24;

/// Sweep every `interval` until `cancel`, starting one interval from now so
/// a deploy's tasks do not all sweep as they start.
pub(crate) async fn run_sweeps(
    indexer: Arc<crate::DatabaseRowIndexer>,
    gate: crate::domain::backfill_gate::BackfillGate,
    interval: Duration,
    cancel: CancellationToken,
) {
    let mut ticks = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut round: u32 = 0;
    loop {
        tokio::select! {
            () = cancel.cancelled() => return,
            _ = ticks.tick() => {}
        }
        round = round.wrapping_add(1);
        let scan_index = round.is_multiple_of(ROUNDS_PER_INDEX_SCAN);

        // One span per round, so each round is its own finished trace.
        let span = tracing::info_span!("database_rows.sweep");
        // The error is recorded on the round's span; the next round retries.
        let _ = indexer
            .sweep_once(scan_index, &gate, &cancel)
            .instrument(span)
            .await;
    }
}
