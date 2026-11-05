use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio::sync::mpsc::{Receiver, Sender};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

use crate::domain::models::{DispatchEvent, InProgressExecution};
use crate::domain::ports::{
    ScheduledActionDispatcher, ScheduledActionExecutor, ScheduledActionRepo,
};

const BUFFER_SIZE: usize = 1024;
/// Pull this many candidates per DB round trip. The dispatcher keeps pulling
/// batches until a poll returns nothing due.
const BATCH_SIZE: i64 = 10;
/// Minimum wall time a batch must take before we pull again. This paces the
/// polling loop and gives peer instances a chance to claim work when a backlog
/// exists (preventing a single instance from draining the queue).
const BATCH_MIN_DURATION: Duration = Duration::from_secs(30);

/// A [`ScheduledActionDispatcher`] that polls Postgres for due actions rather
/// than holding an in-memory cron schedule. Safe to run in multiple instances:
/// coordination is done via [`ScheduledActionRepo::claim_action`], which is an
/// atomic conditional UPDATE fenced to `next_run_at`. The first instance to
/// claim an action wins; peers see the stale-or-unclaimed filter exclude it on
/// subsequent polls.
///
/// Polling cadence: each batch of up to [`BATCH_SIZE`] actions is processed,
/// then the loop sleeps until [`BATCH_MIN_DURATION`] has elapsed from the batch
/// start, or until an earlier firing comes due. This gives other dispatcher
/// instances a chance to pick up work, and bounds DB load when there is nothing
/// to do.
///
/// An earlier firing is the first not-yet-due action the poll returned, or the
/// `next_run_at` of an enabled action created or updated through the returned
/// [`Sender`]. Either wakes the loop when it comes due, so a routine due in two
/// seconds runs in about two seconds rather than at the next batch.
pub struct PgPollingDispatcher<Rpo: ScheduledActionRepo, Exe: ScheduledActionExecutor> {
    repo: Arc<Rpo>,
    executor: Exe,
    lifecycle: PgPollingDispatcherLifecycle,
}

/// Cooperative shutdown configuration for [`PgPollingDispatcher`].
///
/// Retain clones of the token and tracker to cancel the dispatcher and wait
/// for both of its background tasks to finish.
#[derive(Clone)]
pub struct PgPollingDispatcherLifecycle {
    cancellation_token: CancellationToken,
    task_tracker: TaskTracker,
    ready: Option<tokio::sync::watch::Receiver<bool>>,
}

impl PgPollingDispatcherLifecycle {
    /// Creates lifecycle configuration from caller-owned shutdown handles.
    pub fn new(cancellation_token: CancellationToken, task_tracker: TaskTracker) -> Self {
        Self {
            cancellation_token,
            task_tracker,
            ready: None,
        }
    }
}

impl PgPollingDispatcherLifecycle {
    /// Delay polling until the hosting process can accept routine dispatches.
    pub fn with_readiness(mut self, ready: tokio::sync::watch::Receiver<bool>) -> Self {
        self.ready = Some(ready);
        self
    }
}

impl Default for PgPollingDispatcherLifecycle {
    fn default() -> Self {
        Self::new(CancellationToken::new(), TaskTracker::new())
    }
}

impl<Rpo, Exe> PgPollingDispatcher<Rpo, Exe>
where
    Rpo: ScheduledActionRepo,
    Exe: ScheduledActionExecutor,
{
    pub fn new(repo: Arc<Rpo>, executor: Exe) -> Self {
        Self {
            repo,
            executor,
            lifecycle: PgPollingDispatcherLifecycle::default(),
        }
    }

    /// Configures handles for cooperatively stopping and joining dispatcher
    /// tasks. Without this opt-in, the dispatcher retains its previous
    /// process-lifetime behavior.
    pub fn with_lifecycle(mut self, lifecycle: PgPollingDispatcherLifecycle) -> Self {
        self.lifecycle = lifecycle;
        self
    }
}

impl<Rpo, Exe> ScheduledActionDispatcher for PgPollingDispatcher<Rpo, Exe>
where
    Rpo: ScheduledActionRepo + Send + Sync + 'static,
    Exe: ScheduledActionExecutor + Send + 'static,
{
    fn begin_dispatch_loop(self) -> (Sender<DispatchEvent>, Receiver<InProgressExecution>) {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<DispatchEvent>(BUFFER_SIZE);
        let (extx, exrx) = tokio::sync::mpsc::channel::<InProgressExecution>(BUFFER_SIZE);

        let PgPollingDispatcher {
            repo,
            executor,
            lifecycle,
        } = self;
        let cancellation_token = lifecycle.cancellation_token;

        // The earliest firing a create or update asked for. The poll loop
        // clears it when it polls, since that poll reads the saved row.
        let (wake_tx, mut wake_rx) = tokio::sync::watch::channel(None::<DateTime<Utc>>);
        let wake_tx = Arc::new(wake_tx);
        let poll_wake_tx = Arc::clone(&wake_tx);

        // Always drain so service-side sends never block on a full channel.
        let drain_cancellation_token = cancellation_token.clone();
        lifecycle.task_tracker.spawn(async move {
            loop {
                let event = tokio::select! {
                    biased;
                    _ = drain_cancellation_token.cancelled() => break,
                    event = rx.recv() => event,
                };
                let Some(event) = event else {
                    break;
                };
                if let Some(at) = requested_wake(&event) {
                    wake_tx.send_if_modified(|earliest| {
                        let earlier = earliest.is_none_or(|earliest| at < earliest);
                        if earlier {
                            *earliest = Some(at);
                        }
                        earlier
                    });
                }
            }
        });

        lifecycle.task_tracker.spawn(async move {
            if !wait_until_ready(lifecycle.ready, &cancellation_token).await {
                return;
            }
            loop {
                if cancellation_token.is_cancelled() {
                    return;
                }

                let batch_start = Instant::now();
                poll_wake_tx.send_replace(None);
                wake_rx.mark_unchanged();
                let poll_result = tokio::select! {
                    biased;
                    _ = cancellation_token.cancelled() => return,
                    result = repo.get_next_unclaimed_actions(BATCH_SIZE) => result,
                };

                let mut next_due = None;
                match poll_result {
                    Ok(candidates) => {
                        let now = Utc::now();
                        for action in candidates {
                            if !action.enabled || !action.trigger.has_schedule() {
                                continue;
                            }
                            let Some(next_run_at) = action.next_run_at else {
                                continue;
                            };
                            // Candidates come back sorted by next_run_at ASC.
                            // The first non-due one ends the batch — anything
                            // after it is also not yet due.
                            if next_run_at > now {
                                next_due = Some(next_run_at);
                                break;
                            }

                            let id = action.id;
                            // The executor atomically claims the row before
                            // running. If a peer instance claimed it between
                            // our pull and this call, the claim fails and we
                            // skip — that's the multi-instance contract.
                            if cancellation_token.is_cancelled() {
                                return;
                            }
                            match executor.execute_action(action).await {
                                Ok(execution) => {
                                    let _ = extx.send(execution).await;
                                }
                                Err(e) => {
                                    // Could be a benign race (peer claimed
                                    // first) or a real execute failure. Both
                                    // are non-fatal to the polling loop.
                                    tracing::warn!(
                                        error=?e,
                                        action_id=?id,
                                        "failed to execute scheduled action (may be claimed by peer)",
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!(error=?e, "failed to poll for due scheduled actions");
                    }
                }

                let batch_end = batch_start + BATCH_MIN_DURATION;
                loop {
                    let requested = *wake_rx.borrow_and_update();
                    let wake_at = [next_due, requested]
                        .into_iter()
                        .flatten()
                        .map(instant_at)
                        .fold(batch_end, Instant::min);
                    tokio::select! {
                        biased;
                        _ = cancellation_token.cancelled() => return,
                        _ = tokio::time::sleep_until(wake_at.into()) => break,
                        _ = wake_rx.changed() => {}
                    }
                }
            }
        });

        (tx, exrx)
    }
}

/// When a saved action next needs the dispatcher, if it is enabled to run.
fn requested_wake(event: &DispatchEvent) -> Option<DateTime<Utc>> {
    match event {
        DispatchEvent::Create(action) | DispatchEvent::Update(action) if action.enabled => {
            action.next_run_at
        }
        DispatchEvent::Create(_) | DispatchEvent::Update(_) | DispatchEvent::Delete(_) => None,
    }
}

/// The monotonic instant of a wall-clock time; past times are now.
fn instant_at(at: DateTime<Utc>) -> Instant {
    let wait = (at - Utc::now()).to_std().unwrap_or_default();
    Instant::now() + wait
}

async fn wait_until_ready(
    ready: Option<tokio::sync::watch::Receiver<bool>>,
    cancellation: &CancellationToken,
) -> bool {
    let Some(mut ready) = ready else {
        return !cancellation.is_cancelled();
    };
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => false,
        result = ready.wait_for(|ready| *ready) => result.is_ok(),
    }
}
