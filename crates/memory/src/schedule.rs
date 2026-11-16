//! Composition of memory's durable daily work with the internal cron runner.
use crate::domain::{ports::ComposedMemoryRepo, service::MemoryServiceImpl};
use feature_flags::{ServiceContext, ServiceFeatureFlags};
use scheduled_action::domain::{lambda, models::Schedule};
use std::sync::Arc;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

#[cfg(test)]
mod test;

/// PostHog kill switch: while it is on, scheduled memory generation claims nobody.
pub(crate) const PAUSE_FLAG: &str = "disable-memory-refresh";

/// The service identity the kill switch is evaluated for.
pub(crate) const FLAG_CONTEXT: ServiceContext = ServiceContext::new("memory-refresh");

/// Check due users every five minutes. Only completed UTC days are generated;
/// retries and restarts resume from the last committed day, one day at a time,
/// and a day that keeps failing is given up after a bounded number of claims.
/// [`PAUSE_FLAG`] is read from `flags`, when there are flags, before each claim.
pub fn start<R, F>(
    service: Arc<MemoryServiceImpl<R>>,
    flags: Option<F>,
    tracker: &TaskTracker,
    stop: CancellationToken,
) -> anyhow::Result<()>
where
    R: ComposedMemoryRepo,
    F: ServiceFeatureFlags + 'static,
{
    let cron = Schedule::from_cron("0 */5 * * * *".to_owned())?;
    let flags = flags.map(Arc::new);
    lambda::spawn("memory.refresh", cron, tracker, stop, move || {
        let service = service.clone();
        let flags = flags.clone();
        async move {
            service
                .refresh_pending(|| paused(flags.as_deref()))
                .await
                .map_err(Into::into)
        }
    });
    Ok(())
}

/// Whether the kill switch is on. A failed flag read keeps generation running,
/// as it ran before the switch existed.
pub(crate) async fn paused<F: ServiceFeatureFlags>(flags: Option<&F>) -> bool {
    let Some(flags) = flags else {
        return false;
    };
    match flags.load_service(FLAG_CONTEXT).await {
        Ok(snapshot) if snapshot.is_enabled(PAUSE_FLAG) => {
            tracing::info!(flag = PAUSE_FLAG, "memory refresh paused");
            true
        }
        Ok(_) => false,
        Err(error) => {
            tracing::warn!(error = ?error, flag = PAUSE_FLAG, "could not read memory refresh kill switch; running");
            false
        }
    }
}
