#[cfg(test)]
mod test;

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use tokio::sync::mpsc::{Receiver, Sender};
use tokio::task::{JoinError, JoinHandle};
use tokio_util::sync::CancellationToken;

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
/// Maximum time the service waits for polling tasks to stop.
pub const POLLING_DISPATCHER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

/// A [`ScheduledActionDispatcher`] that polls Postgres for due actions rather
/// than holding an in-memory cron schedule. Safe to run in multiple instances:
/// coordination is done via [`ScheduledActionRepo::claim_action`], which is an
/// atomic conditional UPDATE. The first instance to claim an action wins; peers
/// see the stale-or-unclaimed filter exclude it on subsequent polls.
///
/// Polling cadence: each batch of up to [`BATCH_SIZE`] actions is processed,
/// then the loop sleeps until [`BATCH_MIN_DURATION`] has elapsed from the batch
/// start. This gives other dispatcher instances a chance to pick up work, and
/// bounds DB load when there is nothing to do.
///
/// [`DispatchEvent`]s on the returned [`Sender`] are drained and dropped —
/// polling reads state directly from the DB each tick, so create/update/delete
/// events are redundant. The sender is only accepted to satisfy the trait
/// contract shared with the in-memory dispatcher.
pub struct PgPollingDispatcher<Rpo: ScheduledActionRepo, Exe: ScheduledActionExecutor> {
    repo: Arc<Rpo>,
    executor: Exe,
}

impl<Rpo, Exe> PgPollingDispatcher<Rpo, Exe>
where
    Rpo: ScheduledActionRepo,
    Exe: ScheduledActionExecutor,
{
    pub fn new(repo: Arc<Rpo>, executor: Exe) -> Self {
        Self { repo, executor }
    }
}

impl<Rpo, Exe> PgPollingDispatcher<Rpo, Exe>
where
    Rpo: ScheduledActionRepo + Send + Sync + 'static,
    Exe: ScheduledActionExecutor + Send + 'static,
{
    /// Start polling with an owned runtime that can cancel and await both
    /// background tasks.
    pub fn begin_managed_dispatch_loop(
        self,
    ) -> (
        Sender<DispatchEvent>,
        Receiver<InProgressExecution>,
        PgPollingDispatcherRuntime,
    ) {
        let SpawnedDispatchLoop {
            dispatch_sender,
            execution_receiver,
            cancellation,
            event_drain_task,
            polling_task,
        } = self.spawn_dispatch_loop();

        let runtime = PgPollingDispatcherRuntime {
            cancellation,
            event_drain_task: Some(event_drain_task),
            polling_task: Some(polling_task),
        };

        (dispatch_sender, execution_receiver, runtime)
    }

    fn spawn_dispatch_loop(self) -> SpawnedDispatchLoop {
        let (dispatch_sender, dispatch_receiver) =
            tokio::sync::mpsc::channel::<DispatchEvent>(BUFFER_SIZE);
        let (execution_sender, execution_receiver) =
            tokio::sync::mpsc::channel::<InProgressExecution>(BUFFER_SIZE);
        let cancellation = CancellationToken::new();

        let event_drain_task = tokio::spawn(drain_dispatch_events(
            dispatch_receiver,
            cancellation.clone(),
        ));
        let polling_task = tokio::spawn(run_polling_loop(
            self,
            execution_sender,
            cancellation.clone(),
        ));

        SpawnedDispatchLoop {
            dispatch_sender,
            execution_receiver,
            cancellation,
            event_drain_task,
            polling_task,
        }
    }
}

impl<Rpo, Exe> ScheduledActionDispatcher for PgPollingDispatcher<Rpo, Exe>
where
    Rpo: ScheduledActionRepo + Send + Sync + 'static,
    Exe: ScheduledActionExecutor + Send + 'static,
{
    fn begin_dispatch_loop(self) -> (Sender<DispatchEvent>, Receiver<InProgressExecution>) {
        let SpawnedDispatchLoop {
            dispatch_sender,
            execution_receiver,
            cancellation,
            event_drain_task,
            polling_task,
        } = self.spawn_dispatch_loop();

        // Preserve the port's existing detached-task behavior. Production
        // composition roots should use `begin_managed_dispatch_loop` instead.
        drop(cancellation);
        drop(event_drain_task);
        drop(polling_task);

        (dispatch_sender, execution_receiver)
    }
}

struct SpawnedDispatchLoop {
    dispatch_sender: Sender<DispatchEvent>,
    execution_receiver: Receiver<InProgressExecution>,
    cancellation: CancellationToken,
    event_drain_task: JoinHandle<()>,
    polling_task: JoinHandle<()>,
}

/// Owns the cancellable tasks started by [`PgPollingDispatcher`].
///
/// The scheduled-action service must stop this runtime before shutting down
/// resources used by an executor, including the AI tool event broker.
pub struct PgPollingDispatcherRuntime {
    cancellation: CancellationToken,
    event_drain_task: Option<JoinHandle<()>>,
    polling_task: Option<JoinHandle<()>>,
}

impl PgPollingDispatcherRuntime {
    /// Cancel polling and event draining, then await both tasks within the
    /// dispatcher's shutdown bound.
    pub async fn shutdown(mut self) {
        self.cancellation.cancel();

        let mut event_drain_task = self
            .event_drain_task
            .take()
            .expect("polling dispatcher runtime must own its event-drain task");
        let mut polling_task = self
            .polling_task
            .take()
            .expect("polling dispatcher runtime must own its polling task");

        let task_results = tokio::time::timeout(POLLING_DISPATCHER_SHUTDOWN_TIMEOUT, async {
            tokio::join!(&mut event_drain_task, &mut polling_task)
        })
        .await;

        match task_results {
            Ok((event_drain_result, polling_result)) => {
                log_task_result("event drain", event_drain_result);
                log_task_result("polling", polling_result);
                tracing::info!("scheduled-action polling dispatcher stopped");
            }
            Err(_) => {
                event_drain_task.abort();
                polling_task.abort();
                let _ = tokio::join!(event_drain_task, polling_task);
                tracing::warn!(
                    timeout_seconds = POLLING_DISPATCHER_SHUTDOWN_TIMEOUT.as_secs(),
                    "scheduled-action polling dispatcher shutdown timed out; remaining tasks were cancelled"
                );
            }
        }
    }
}

impl Drop for PgPollingDispatcherRuntime {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(task) = self.event_drain_task.take() {
            task.abort();
        }
        if let Some(task) = self.polling_task.take() {
            task.abort();
        }
    }
}

async fn drain_dispatch_events(
    mut dispatch_receiver: Receiver<DispatchEvent>,
    cancellation: CancellationToken,
) {
    loop {
        tokio::select! {
            biased;
            () = cancellation.cancelled() => break,
            event = dispatch_receiver.recv() => {
                if event.is_none() {
                    break;
                }
            }
        }
    }
}

async fn run_polling_loop<Rpo, Exe>(
    dispatcher: PgPollingDispatcher<Rpo, Exe>,
    execution_sender: Sender<InProgressExecution>,
    cancellation: CancellationToken,
) where
    Rpo: ScheduledActionRepo + Send + Sync + 'static,
    Exe: ScheduledActionExecutor + Send + 'static,
{
    loop {
        let batch_start = Instant::now();
        let candidates = tokio::select! {
            biased;
            () = cancellation.cancelled() => break,
            result = dispatcher.repo.get_next_unclaimed_actions(BATCH_SIZE) => {
                match result {
                    Ok(candidates) => candidates,
                    Err(error) => {
                        tracing::error!(error=?error, "failed to poll for due scheduled actions");
                        Vec::new()
                    }
                }
            }
        };

        let now = Utc::now();
        for action in candidates {
            // Candidates come back sorted by next_run_at ASC. The first
            // non-due one ends the batch — anything after it is also not due.
            if action.next_run_at > now {
                break;
            }

            let id = action.id;
            // The executor atomically claims the row before running. If a peer
            // instance claimed it between our pull and this call, the claim
            // fails and we skip — that's the multi-instance contract.
            let execution_result = tokio::select! {
                biased;
                () = cancellation.cancelled() => return,
                result = dispatcher.executor.execute_action(action) => result,
            };

            match execution_result {
                Ok(execution) => {
                    tokio::select! {
                        biased;
                        () = cancellation.cancelled() => return,
                        _ = execution_sender.send(execution) => {}
                    }
                }
                Err(error) => {
                    // This may be a benign race with a peer or an execution
                    // failure. Neither should stop future polling.
                    tracing::warn!(
                        error=?error,
                        action_id=?id,
                        "failed to execute scheduled action (may be claimed by peer)",
                    );
                }
            }
        }

        let remaining_delay = BATCH_MIN_DURATION.saturating_sub(batch_start.elapsed());
        tokio::select! {
            biased;
            () = cancellation.cancelled() => break,
            () = tokio::time::sleep(remaining_delay) => {}
        }
    }
}

fn log_task_result(task: &'static str, result: Result<(), JoinError>) {
    if let Err(error) = result {
        tracing::error!(error=?error, task, "scheduled-action dispatcher task terminated unexpectedly");
    }
}
