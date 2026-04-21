use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use tokio::sync::mpsc::{Receiver, Sender};

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

impl<Rpo, Exe> ScheduledActionDispatcher for PgPollingDispatcher<Rpo, Exe>
where
    Rpo: ScheduledActionRepo + Send + Sync + 'static,
    Exe: ScheduledActionExecutor + Send + 'static,
{
    fn begin_dispatch_loop(self) -> (Sender<DispatchEvent>, Receiver<InProgressExecution>) {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<DispatchEvent>(BUFFER_SIZE);
        let (extx, exrx) = tokio::sync::mpsc::channel::<InProgressExecution>(BUFFER_SIZE);

        // Drain dispatch events — the polling loop pulls fresh state from the
        // DB each tick, so create/update/delete notifications are not needed.
        // We still must drain so service-side sends don't block on a full
        // channel.
        tokio::spawn(async move { while rx.recv().await.is_some() {} });

        tokio::spawn(async move {
            loop {
                let batch_start = Instant::now();

                match self.repo.get_next_unclaimed_actions(BATCH_SIZE).await {
                    Ok(candidates) => {
                        let now = Utc::now();
                        for action in candidates {
                            // Candidates come back sorted by next_run_at ASC.
                            // The first non-due one ends the batch — anything
                            // after it is also not yet due.
                            if action.next_run_at > now {
                                break;
                            }

                            let id = action.id;
                            // The executor atomically claims the row before
                            // running. If a peer instance claimed it between
                            // our pull and this call, the claim fails and we
                            // skip — that's the multi-instance contract.
                            match self.executor.execute_action(action).await {
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

                let elapsed = batch_start.elapsed();
                if elapsed < BATCH_MIN_DURATION {
                    tokio::time::sleep(BATCH_MIN_DURATION - elapsed).await;
                }
            }
        });

        (tx, exrx)
    }
}
