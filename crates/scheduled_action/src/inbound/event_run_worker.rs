//! Bounded continuous event dispatch. Shutdown signals active executors; the
//! lifecycle drains the worker, then tracked executions and terminal bookkeeping.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use tokio::sync::Semaphore;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument as _;

use crate::domain::event_runs::{
    EventRunKey, PageSize, PendingEventRun, dispatch::EventRunDispatch,
};

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
    // A run stays pending while its trigger condition is checked, so the next
    // poll can return it again. Never dispatch the same run twice at once.
    let in_flight = Arc::new(Mutex::new(HashSet::new()));
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
                        let Some(claim) = InFlight::begin(&in_flight, pending.key()) else {
                            continue;
                        };
                        let Ok(permit) = permits.clone().try_acquire_owned() else {
                            break;
                        };
                        let service = Arc::clone(&service);
                        let shutdown = shutdown.clone();
                        let span = run_span(&pending);
                        executions.spawn(
                            async move {
                                let _permit = permit;
                                let _claim = claim;
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
                            .instrument(span),
                        );
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

/// One event run's dispatch, in the trace its event was admitted in.
fn run_span(pending: &PendingEventRun) -> tracing::Span {
    let event = &pending.event;
    let span = tracing::info_span!(
        "routine.event_run",
        action_id = %pending.action_id,
        event_id = %event.event_id().as_uuid(),
        event_name = event.event_name().as_str(),
        entity_id = ?event.entity_id(),
        message_id = ?event.message_id(),
    );
    crate::trace_context::adopt(&span, pending.traceparent.as_deref());
    span
}

/// Marks a run as being dispatched by this worker until dropped.
struct InFlight {
    keys: Arc<Mutex<HashSet<EventRunKey>>>,
    key: EventRunKey,
}

impl InFlight {
    fn begin(keys: &Arc<Mutex<HashSet<EventRunKey>>>, key: EventRunKey) -> Option<Self> {
        keys.lock()
            .expect("in-flight set lock")
            .insert(key)
            .then(|| Self {
                keys: Arc::clone(keys),
                key,
            })
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        self.keys
            .lock()
            .expect("in-flight set lock")
            .remove(&self.key);
    }
}
