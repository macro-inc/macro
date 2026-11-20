//! Publishes this task's [`LaneBacklog`] every [`PUBLISH_INTERVAL`] for the
//! service's autoscaling, which tracks each lane's age in CloudWatch beside
//! CPU, so a backlog keeps tasks running.

use std::time::Duration;

use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;
use tracing::{Instrument as _, field};

#[cfg(test)]
mod test;

use super::IndexMetrics;
use crate::domain::backlog::BacklogSink;

/// CloudWatch's standard resolution, the period target tracking evaluates.
pub(crate) const PUBLISH_INTERVAL: Duration = Duration::from_secs(60);

/// Publishes until `shutdown` is cancelled. A round with no fresh pending
/// ages publishes nothing; a failed publish is logged and the next round
/// tries again.
pub(crate) async fn publish_lane_backlog<S: BacklogSink>(
    metrics: IndexMetrics,
    sink: S,
    shutdown: CancellationToken,
) {
    let mut tick = tokio::time::interval(PUBLISH_INTERVAL);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            () = shutdown.cancelled() => break,
            _ = tick.tick() => {}
        }
        let Some(backlog) = metrics.lane_backlog(tokio::time::Instant::now().into_std()) else {
            continue;
        };
        let millis = |age: Option<Duration>| {
            age.map(|age| u64::try_from(age.as_millis()).unwrap_or(u64::MAX))
        };
        let span = tracing::info_span!(
            "search.backlog_publish",
            live_ms = millis(backlog.live),
            email_ms = millis(backlog.email),
            otel.status_code = field::Empty,
        );
        async {
            if let Err(error) = sink.publish(backlog).await {
                tracing::Span::current().record("otel.status_code", "ERROR");
                tracing::warn!(error = ?error, "could not publish the search backlog for autoscaling");
            }
        }
        .instrument(span)
        .await;
    }
}
