//! Bounded, awaitable event dispatch. No detached execution tasks: shutdown
//! signals active executors and waits for terminal bookkeeping before returning.

use std::time::Duration;

use futures::{StreamExt, stream};
use tokio_util::sync::CancellationToken;

use crate::domain::event_runs::{PageSize, dispatch::EventRunDispatch};

#[cfg(test)]
mod test;

/// At most ten runs in flight, with at most one durable head per action.
const CONCURRENT_RUNS: u16 = 10;
const POLL_INTERVAL: Duration = Duration::from_secs(1);

pub async fn run_event_worker(service: impl EventRunDispatch, shutdown: CancellationToken) {
    run(service, shutdown, POLL_INTERVAL).await;
}

async fn run(service: impl EventRunDispatch, shutdown: CancellationToken, interval: Duration) {
    let limit = PageSize::try_from(CONCURRENT_RUNS).expect("worker bound is a valid page size");
    loop {
        if shutdown.is_cancelled() {
            return;
        }
        if service.reconcile(limit).await.is_err() {
            tracing::warn!(
                outcome = "reconciliation_unavailable",
                "event maintenance deferred"
            );
        }
        match service.pending(limit).await {
            Ok(pending) => {
                stream::iter(pending)
                    .for_each_concurrent(usize::from(CONCURRENT_RUNS), |pending| {
                        let service = &service;
                        let shutdown = &shutdown;
                        async move {
                            if shutdown.is_cancelled() {
                                return;
                            }
                            // Do not select/drop dispatch on shutdown: a claim may
                            // already have committed. The executor owns cancellation.
                            if service
                                .dispatch(pending, shutdown.cancelled())
                                .await
                                .is_err()
                            {
                                tracing::warn!(
                                    outcome = "dispatch_unavailable",
                                    "event dispatch or bookkeeping deferred"
                                );
                            }
                        }
                    })
                    .await;
            }
            Err(_) => tracing::warn!(outcome = "queue_unavailable", "event polling deferred"),
        }
        tokio::select! {
            _ = shutdown.cancelled() => return,
            _ = tokio::time::sleep(interval) => {},
        }
    }
}
