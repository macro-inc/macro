//! Periodic call reconciliation for missed RTC leave webhooks.

use std::sync::Arc;
use std::time::Duration;

use crate::domain::ports::CallService;

/// How often active calls are checked against their RTC rooms.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Runs until the task is dropped; spawn it next to the call routers.
pub async fn run_stale_call_sweeper<S: CallService>(service: Arc<S>, interval: Duration) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        if let Err(error) = service.reconcile_stale_calls().await {
            tracing::error!(error = ?error, "stale call sweep failed");
        }
    }
}
