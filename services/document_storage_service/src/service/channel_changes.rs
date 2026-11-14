//! Hourly retention for the channel change log.
use std::time::Duration;

use messages::domain::changes::{ChannelChangeLogPruner, ChannelChangeLogRetention};
use tokio_util::sync::CancellationToken;

/// How often rows past retention are removed.
const RETENTION_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// Prune the channel change log now and then every hour until cancelled. A
/// failed pass is logged and retried at the next tick.
pub(crate) async fn run_retention<P: ChannelChangeLogPruner>(
    retention: ChannelChangeLogRetention<P>,
    cancellation_token: CancellationToken,
) {
    let mut ticks = tokio::time::interval(RETENTION_INTERVAL);
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => return,
            _ = ticks.tick() => {}
        }
        let _ = retention
            .run_once(chrono::Utc::now())
            .await
            .inspect_err(|error| {
                tracing::error!(?error, "failed to prune the channel change log");
            });
    }
}

#[cfg(test)]
mod test;
