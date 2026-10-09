//! Runs the reconciliation sweep on a schedule, for the service that owns
//! Stripe.

use crate::domain::{BillingService, EntitlementSource, SettlementCandidates, SettlementSweep};
use chrono::Utc;
use std::time::Duration;

/// How long after boot the first sweep runs. Short, so a deploy that lands
/// while usage is owed recovers it without waiting out a full interval, and
/// so rolling restarts cannot keep pushing the first sweep ahead of them.
pub const SETTLEMENT_SWEEP_INITIAL_DELAY: Duration = Duration::from_secs(60);

/// How often the sweep runs after that. Every host also requests settlement
/// after a counted completion, so an hour bounds how long a lost request or
/// a closed period waits, not how long usage normally takes to settle.
pub const SETTLEMENT_SWEEP_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Sweep forever: once after `initial_delay`, then every `interval`.
///
/// A sweep that fails is logged and tried again at the next tick; one that
/// runs long delays the next tick rather than overlapping it. The caller
/// spawns this and drops or aborts the task to stop it: settlement is
/// idempotent and every step commits on its own, so stopping mid-sweep
/// leaves nothing half done.
pub async fn run_settlement_sweep<B, C, E>(
    sweep: SettlementSweep<B, C, E>,
    initial_delay: Duration,
    interval: Duration,
) where
    B: BillingService,
    C: SettlementCandidates,
    E: EntitlementSource,
{
    tokio::time::sleep(initial_delay).await;
    loop {
        match sweep.run_once(Utc::now()).await {
            Ok(report) => tracing::info!(
                candidates = report.candidates,
                payers = report.payers,
                failed = report.failed,
                "ai billing settlement sweep finished"
            ),
            Err(error) => {
                tracing::warn!(error = ?error, "ai billing settlement sweep failed");
            }
        }
        tokio::time::sleep(interval).await;
    }
}
