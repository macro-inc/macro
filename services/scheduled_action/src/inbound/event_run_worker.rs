//! Bounded continuous event dispatch. Shutdown signals active executors; the
//! lifecycle drains the worker, then tracked executions and terminal bookkeeping.

use std::{sync::Arc, time::Duration};

use tokio::sync::Semaphore;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use crate::domain::event_runs::{PageSize, dispatch::EventRunDispatch};

#[cfg(test)]
mod test;

const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Track dispatch futures separately from the worker without detaching them.
/// The composition root budgets capacity alongside HTTP and cron work.
pub async fn run_event_worker(
    service: impl EventRunDispatch,
    shutdown: CancellationToken,
    executions: TaskTracker,
    concurrency: PageSize,
) {
    run(service, shutdown, executions, concurrency, POLL_INTERVAL).await;
}

async fn run(
    service: impl EventRunDispatch,
    shutdown: CancellationToken,
    executions: TaskTracker,
    limit: PageSize,
    interval: Duration,
) {
    let service = Arc::new(service);
    let permits = Arc::new(Semaphore::new(usize::from(limit.get())));
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
        let free = u16::try_from(permits.available_permits()).expect("capacity fits PageSize");
        if let Ok(page) = PageSize::try_from(free) {
            match service.pending(page).await {
                Ok(pending) => {
                    for pending in pending {
                        let Ok(permit) = permits.clone().try_acquire_owned() else {
                            break;
                        };
                        let service = Arc::clone(&service);
                        let shutdown = shutdown.clone();
                        executions.spawn(async move {
                            let _permit = permit;
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
                        });
                    }
                }
                Err(_) => tracing::warn!(outcome = "queue_unavailable", "event polling deferred"),
            }
        }
        tokio::select! {
            _ = shutdown.cancelled() => return,
            _ = tokio::time::sleep(interval) => {},
        }
    }
}
