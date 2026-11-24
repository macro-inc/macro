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

use opentelemetry::KeyValue;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

use crate::domain::database_row_index::SweepFailed;

/// Counter of sweep steps that failed, tagged `step` (`catch_up`,
/// `stale_scan`, `reshape_check`, or `lead` when the round could not even
/// ask to lead). The Datadog monitor `search-database-rows-sweep-failing` in
/// infra/stacks/monitoring/monitors/search-freshness.ts reads it by this
/// name and tag; rename them together.
pub(crate) const SWEEP_FAILURES: &str = "search.database_rows.sweep_failures";
const STEP: &str = "step";
const METER_NAME: &str = "search_processing_service";

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
    let failures = opentelemetry::global::meter(METER_NAME)
        .u64_counter(SWEEP_FAILURES)
        .with_description("Database row sweep steps that failed, by step")
        .build();
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
        // The error is recorded on the round's span and counted per step;
        // the next round retries.
        let Err(error) = indexer
            .sweep_once(scan_index, &gate, &cancel)
            .instrument(span)
            .await
        else {
            continue;
        };
        let failed = error
            .iter_reports()
            .find_map(|report| report.downcast_current_context::<SweepFailed>());
        match failed {
            Some(failed) => {
                for step in &failed.steps {
                    failures.add(1, &[KeyValue::new(STEP, <&'static str>::from(*step))]);
                }
            }
            None => failures.add(1, &[KeyValue::new(STEP, "lead")]),
        }
    }
}
