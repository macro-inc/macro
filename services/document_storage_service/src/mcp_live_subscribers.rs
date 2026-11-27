//! Keeps this replica's set of users with a live MCP Events subscription
//! fresh, so ingestion's fan-out queries only for audiences that hold one.

use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;
use webhook::domain::mcp::{live_subscribers::McpLiveSubscribers, ports::McpSubscriptionRepo};

/// Between refreshes: how long a new subscription can wait before its events
/// are matched in this replica.
const REFRESH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// Refresh `subscribers` every [`REFRESH_INTERVAL`] until shutdown.
pub(crate) async fn run<R: McpSubscriptionRepo>(
    subscribers: McpLiveSubscribers,
    repo: R,
    cancellation: CancellationToken,
) {
    let mut interval = tokio::time::interval(REFRESH_INTERVAL);
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
            result = subscribers.refresh(&repo) => {
                let _ = result.inspect_err(|error| {
                    tracing::warn!(error = ?error, "mcp live subscriber refresh failed");
                });
            }
        }
    }
}
