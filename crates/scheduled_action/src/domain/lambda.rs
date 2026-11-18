//! Tracked, cancellable cron actions implemented by Rust closures.
//!
//! These are internal jobs, not user-configurable routine targets. Durable claim
//! and retry state belongs to the job's domain, so replicas can share the schedule.
use super::models::Schedule;
use chrono::Utc;
use std::{future::Future, sync::Arc};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument;

/// Run once on startup for catch-up, then at fixed UTC cron boundaries. Jobs
/// never overlap in this process. Cancellation drops in-flight work; durable
/// jobs must retain a lease or retry record until their write commits.
pub fn spawn<F, Fut>(
    name: &'static str,
    schedule: Schedule,
    tracker: &TaskTracker,
    stop: CancellationToken,
    action: F,
) where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = anyhow::Result<()>> + Send,
{
    let action = Arc::new(action);
    tracker.spawn(async move {
        loop {
            let span = tracing::info_span!("scheduled.lambda", job = name);
            tokio::select! {
                biased;
                _ = stop.cancelled() => break,
                result = action().instrument(span) => {
                    if let Err(error) = result { tracing::error!(error = ?error, job = name, "scheduled job failed"); }
                }
            }
            let Some(next) = schedule.next_run_after_now(chrono_tz::UTC) else { break; };
            let delay = (next - Utc::now()).to_std().unwrap_or_default();
            tokio::select! {
                _ = stop.cancelled() => break,
                _ = tokio::time::sleep(delay) => {}
            }
        }
    });
}

#[cfg(test)]
mod test;
