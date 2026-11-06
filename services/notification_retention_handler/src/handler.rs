//! Thin Lambda adapter. Empty/manual payloads default to a read-only preview.

use std::time::{Duration, SystemTime};

use lambda_runtime::{Error, LambdaEvent};
use notification::domain::retention::{
    NotificationRetentionRepository, NotificationRetentionService, RetentionMode,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CleanupEvent {
    #[serde(default = "default_dry_run")]
    dry_run: bool,
}

fn default_dry_run() -> bool {
    true
}

impl CleanupEvent {
    fn mode(&self) -> RetentionMode {
        if self.dry_run {
            RetentionMode::DryRun
        } else {
            RetentionMode::Delete
        }
    }
}

#[tracing::instrument(
    name = "notification.retention.invoke",
    err,
    skip(service, event),
    fields(faas.invocation_id = %event.context.request_id, dry_run = event.payload.dry_run)
)]
pub(crate) async fn handle<R: NotificationRetentionRepository>(
    service: &NotificationRetentionService<R>,
    event: LambdaEvent<CleanupEvent>,
) -> Result<(), Error> {
    let budget = event
        .context
        .deadline()
        .duration_since(SystemTime::now())
        .unwrap_or_default()
        .saturating_sub(Duration::from_secs(10));
    if budget < Duration::from_secs(15) {
        tracing::warn!("not enough invocation time for notification retention; skipping");
        return Ok(());
    }
    // Also bound stalls outside SQL execution (pool acquisition/network I/O).
    // Dropping an in-flight repository future rolls back its transaction.
    tokio::time::timeout(budget, service.run(event.payload.mode(), budget)).await??;
    Ok(())
}

#[cfg(test)]
mod test;
