//! Composition of memory's durable daily work with the internal cron runner.
use crate::domain::{ports::ComposedMemoryRepo, service::MemoryServiceImpl};
use scheduled_action::domain::{lambda, models::Schedule};
use std::sync::Arc;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

/// Check due users every five minutes. Only completed UTC days are generated;
/// retries and restarts resume from the last committed day, one day at a time.
pub fn start<R: ComposedMemoryRepo>(
    service: Arc<MemoryServiceImpl<R>>,
    tracker: &TaskTracker,
    stop: CancellationToken,
) -> anyhow::Result<()> {
    let cron = Schedule::from_cron("0 */5 * * * *".to_owned())?;
    lambda::spawn("memory.refresh", cron, tracker, stop, move || {
        let service = service.clone();
        async move { service.refresh_pending().await.map_err(Into::into) }
    });
    Ok(())
}
