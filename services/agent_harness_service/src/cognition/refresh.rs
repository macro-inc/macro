//! Projection refresh sweeps hosted by the agent harness.
pub mod context;
mod event;
mod sweep;

use event::RefreshCadence;
use std::{sync::Arc, time::Duration};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

pub fn start(
    db: sqlx::PgPool,
    sqs_client: Arc<sqs_client::SQS>,
    cancellation: CancellationToken,
    tasks: TaskTracker,
) {
    for (cadence, period) in [
        (RefreshCadence::High, Duration::from_secs(6 * 60 * 60)),
        (RefreshCadence::Medium, Duration::from_secs(24 * 60 * 60)),
        (RefreshCadence::Low, Duration::from_secs(3 * 24 * 60 * 60)),
    ] {
        let context = context::Context {
            db: db.clone(),
            sqs_client: sqs_client.clone(),
        };
        let cancellation = cancellation.clone();
        tasks.spawn(async move {
            let mut interval = tokio::time::interval(period);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => break,
                    _ = interval.tick() => {
                        match sweep::run(&context, cadence).await {
                            Ok(stats) => tracing::info!(
                                cadence = cadence.as_str(), deleted = stats.deleted,
                                refreshed = stats.refreshed, enqueue_failures = stats.enqueue_failures,
                                "projection refresh sweep complete"
                            ),
                            Err(error) => tracing::error!(error = ?error, cadence = cadence.as_str(), "projection refresh sweep failed"),
                        }
                    }
                }
            }
        });
    }
}
