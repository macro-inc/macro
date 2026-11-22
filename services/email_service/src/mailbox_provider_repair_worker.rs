//! Background scheduling for the domain's bounded provider-repair use case.
use email::domain::mailbox::provider_repair::{ProviderRepairRepository, RepairTick, repair_once};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub async fn run(repository: impl ProviderRepairRepository, stopped: CancellationToken) {
    loop {
        if stopped.is_cancelled() {
            return;
        }
        let delay = match repair_once(&repository).await {
            Ok(RepairTick::Complete) => return,
            Ok(tick) => tick.delay(),
            Err(error) => {
                tracing::warn!(
                    error.class = error.as_ref(),
                    "Legacy reconciliation provider maintenance will retry"
                );
                Duration::from_secs(5)
            }
        };
        // Finish the bounded database transaction before observing shutdown.
        // A killed process rolls back that batch and its persisted lease expires.
        tokio::select! {
            _ = stopped.cancelled() => return,
            _ = tokio::time::sleep(delay) => {},
        }
    }
}
