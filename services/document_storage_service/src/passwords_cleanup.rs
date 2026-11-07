//! Cancellation-aware scheduling for the vault's durable enrollment cleanup.

use passwords::domain::service::PasswordService;
use std::{sync::Arc, time::Duration};
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);

/// Run immediate and periodic cleanup until the service begins shutdown.
pub(crate) async fn run(service: Arc<PasswordService>, cancellation: CancellationToken) {
    let mut interval = tokio::time::interval(CLEANUP_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = interval.tick() => {}
        }

        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = service.cleanup_expired_totp_enrollments() => {
                // The domain emits per-enrollment spans and retains unsuccessful
                // work in the journal for the next pass. Never log vault data.
                let _ = result.inspect_err(|error| {
                    tracing::warn!(error = ?error, "passwords enrollment cleanup failed");
                });
            }
        }
    }
}
