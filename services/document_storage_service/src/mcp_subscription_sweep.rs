//! Periodic removal of expired MCP Events subscriptions.

use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;
use webhook::domain::mcp::{ports::McpSubscriptionRepo, service::McpSubscriptionSweeper};

/// Between rounds. Expired rows are never matched or delivered, so the sweep
/// only bounds how long they take space.
const SWEEP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

/// Sweep expired subscriptions every [`SWEEP_INTERVAL`] until shutdown. Every
/// replica runs it; batches skip rows another replica holds.
pub(crate) async fn run<R: McpSubscriptionRepo>(
    sweeper: McpSubscriptionSweeper<R>,
    cancellation: CancellationToken,
) {
    let mut interval = tokio::time::interval(SWEEP_INTERVAL);
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
            // The sweep opens one span per round and records its error.
            result = sweeper.sweep_expired() => {
                let _ = result.inspect_err(|error| {
                    tracing::warn!(error = ?error, "mcp event subscription sweep failed");
                });
            }
        }
    }
}
