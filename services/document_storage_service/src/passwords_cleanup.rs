//! Cancellation-aware scheduling for explicit item deletion, retained TOTP
//! cleanup, committed agent access-request event delivery and unfinished team
//! vault setups.

use passwords::domain::{agent::service::AgentVaultService, service::PasswordService};
use std::{sync::Arc, time::Duration};
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
/// Setups that a write started and could not finish wait for this pass; their
/// rows carry their own backoff, so most passes find nothing due.
const VAULT_SETUP_INTERVAL: Duration = Duration::from_secs(5);

/// Run immediate and periodic cleanup until the service begins shutdown.
pub(crate) async fn run(
    service: Arc<PasswordService>,
    agents: Arc<AgentVaultService>,
    cancellation: CancellationToken,
) {
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
            result = async {
                service.cleanup_retired_items().await?;
                service.cleanup_expired_totp_enrollments().await
            } => {
                // The domain emits per-item and enrollment spans and retains unsuccessful
                // work in the journal for the next pass. Never log vault data.
                let _ = result.inspect_err(|error| {
                    tracing::warn!(error = ?error, "passwords vault cleanup failed");
                });
            }
        }

        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            result = agents.deliver_access_events() => {
                let _ = result.inspect_err(|error| {
                    tracing::warn!(error = ?error, "passwords agent access event delivery failed");
                });
            }
        }
    }
}

/// Finish team vault setups that a write started, until shutdown. Without a
/// provisioner no setup is ever recorded, so the pass finds nothing.
pub(crate) async fn resume_vault_setup(
    service: Arc<PasswordService>,
    cancellation: CancellationToken,
) {
    let mut interval = tokio::time::interval(VAULT_SETUP_INTERVAL);
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
            result = service.resume_vault_setup() => {
                let _ = result.inspect_err(|error| {
                    tracing::warn!(error = ?error, "passwords vault setup resume failed");
                });
            }
        }
    }
}
