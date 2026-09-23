pub mod agent_task;
mod notify;

#[cfg(test)]
mod test;

use std::{sync::Arc, time::Duration};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde_json::Value;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use crate::domain::event_runs::{
    ClaimedEventRun, EventExecutionResult, EventExecutor, EventRunOutcome,
};
use crate::domain::models::{
    ActionExecutionRecord, InProgressExecution, MAX_ACTION_TIME, ScheduledAction,
    ScheduledActionUpdate,
};
use crate::domain::ports::{
    ScheduledActionExecutor, ScheduledActionLiveUpdate, ScheduledActionRepo, ScheduledAgentRunner,
};

/// Shared execution path. Cron/manual calls return after tracked chat creation;
/// event workers await it and own atomic event/history finalization and release.
pub struct InProcessExecutor<Rpo, Live, Runner> {
    repo: Arc<Rpo>,
    live_updates: Arc<Live>,
    runner: Arc<Runner>,
    tracker: TaskTracker,
    cancellation: CancellationToken,
}

impl<Rpo, Live, Runner> Clone for InProcessExecutor<Rpo, Live, Runner> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
            live_updates: self.live_updates.clone(),
            runner: self.runner.clone(),
            tracker: self.tracker.clone(),
            cancellation: self.cancellation.clone(),
        }
    }
}

impl<Rpo, Live, Runner> InProcessExecutor<Rpo, Live, Runner>
where
    Rpo: ScheduledActionRepo,
    Live: ScheduledActionLiveUpdate,
    Runner: ScheduledAgentRunner,
{
    pub fn new(
        repo: Arc<Rpo>,
        runner: Arc<Runner>,
        live_updates: Arc<Live>,
        tracker: TaskTracker,
        cancellation: CancellationToken,
    ) -> Self {
        Self {
            repo,
            runner,
            live_updates,
            tracker,
            cancellation,
        }
    }

    async fn prepare(
        &self,
        action: &ScheduledAction,
        chat_id: &mut Option<String>,
    ) -> Result<String> {
        let owner = action.owner_user()?.clone();
        let action_id = action.id.context("persisted action required")?;
        let created = self.runner.create_chat(action).await?;
        // Retain the chat link even if publishing Started stalls or is cancelled.
        *chat_id = Some(created.clone());
        self.live_updates
            .publish_update(ScheduledActionUpdate::Started {
                owner,
                action_id,
                chat_id: created.clone(),
            })
            .await;
        Ok(created)
    }

    async fn stopped(&self, action: &ScheduledAction, chat_id: &str, is_success: bool) {
        if let (Ok(owner), Some(action_id)) = (action.owner_user(), action.id) {
            self.live_updates
                .publish_update(ScheduledActionUpdate::Stopped {
                    owner: owner.clone(),
                    action_id,
                    chat_id: chat_id.to_owned(),
                    is_success,
                })
                .await;
        }
    }
}

const BOOKKEEPING_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
#[error("scheduled action cancelled")]
struct ExecutionCancelled;

/// Bound every execution operation (including chat preparation) by the claim's
/// original deadline. Cancellation drops the runner, whose session guard cancels
/// the request context used by tools, including detached cooperative tool work.
async fn bounded<T>(
    deadline: DateTime<Utc>,
    cancellation: impl Future<Output = ()> + Send,
    operation: impl Future<Output = Result<T>> + Send,
) -> Result<T> {
    let remaining = (deadline - Utc::now()).to_std().unwrap_or_default();
    anyhow::ensure!(!remaining.is_zero(), "scheduled action deadline exceeded");
    tokio::select! {
        biased;
        _ = cancellation => Err(ExecutionCancelled.into()),
        _ = tokio::time::sleep(remaining) => anyhow::bail!("scheduled action deadline exceeded"),
        result = operation => result,
    }
}

fn execution_record(
    action: &ScheduledAction,
    chat_id: Option<String>,
    started_at: DateTime<Utc>,
    result: &Result<()>,
) -> ActionExecutionRecord {
    let end_time = Utc::now();
    ActionExecutionRecord {
        id: None,
        action_id: action.id.expect("claimed actions are persisted"),
        resource_id: chat_id,
        start_time: started_at,
        end_time,
        is_success: result.is_ok(),
        result: match result {
            Ok(()) => Value::Null,
            Err(error) => Value::String(error.to_string()),
        },
        created_at: end_time,
    }
}

impl<Rpo, Live, Runner> ScheduledActionExecutor for InProcessExecutor<Rpo, Live, Runner>
where
    Rpo: ScheduledActionRepo,
    Live: ScheduledActionLiveUpdate,
    Runner: ScheduledAgentRunner,
{
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        action.owner_user()?;
        anyhow::ensure!(!self.cancellation.is_cancelled(), "executor is stopping");
        let id = action.id.context("persisted action required")?;
        let start_time = Utc::now();
        let deadline = start_time + MAX_ACTION_TIME;

        // Track preparation too: cancellation of an HTTP request must not leak
        // a claim or abandon a run after creating its chat.
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let executor = self.clone();
        self.tracker.spawn(async move {
            let claim = bounded(
                deadline,
                executor.cancellation.cancelled(),
                executor.repo.claim_action(&id),
            )
            .await;
            let token = match claim {
                Ok(token) => token,
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                    return;
                }
            };
            let mut ready_tx = Some(ready_tx);
            let mut chat_id = None;
            let result = bounded(deadline, executor.cancellation.cancelled(), async {
                let created = executor.prepare(&action, &mut chat_id).await?;
                if let Some(ready_tx) = ready_tx.take() {
                    let _ = ready_tx.send(Ok(InProgressExecution {
                        action_id: id,
                        chat_id: Some(created.clone()),
                    }));
                }
                executor.runner.run(&action, &created, None).await
            })
            .await;
            let record = execution_record(&action, chat_id.clone(), start_time, &result);
            let end_time = record.end_time;
            let bookkeeping = async {
                let _ = executor.repo.create_execution_record(record).await.inspect_err(|error| {
                    tracing::error!(?error, action_id=?id, "failed to save execution record");
                });
                let _ = executor.repo.update_last_executed(&id, end_time).await.inspect_err(|error| {
                    tracing::error!(?error, action_id=?id, "failed to update last executed time");
                });
                let _ = executor.repo.update_next_run_at(&id).await.inspect_err(|error| {
                    tracing::error!(?error, action_id=?id, "failed to update next run time");
                });
            };
            if tokio::time::timeout(BOOKKEEPING_TIMEOUT, bookkeeping).await.is_err() {
                tracing::error!(action_id=?id, "execution bookkeeping timed out");
            }
            // Always attempt fenced release, even after failed preparation or
            // stalled history persistence. Never retry model/tool execution.
            let release = executor.repo.release_action(&id, token);
            match tokio::time::timeout(BOOKKEEPING_TIMEOUT, release).await {
                Ok(Ok(())) => {},
                Ok(Err(error)) => tracing::error!(?error, action_id=?id, "failed to release action claim"),
                Err(error) => tracing::error!(?error, action_id=?id, "claim release timed out"),
            }
            if let Some(chat_id) = chat_id {
                let _ = tokio::time::timeout(
                    BOOKKEEPING_TIMEOUT,
                    executor.stopped(&action, &chat_id, result.is_ok()),
                )
                .await;
            }
            if let Err(error) = result {
                tracing::error!(?error, action_id=?id, "scheduled action execution failed");
                if let Some(ready_tx) = ready_tx {
                    let _ = ready_tx.send(Err(error));
                }
            }
        });
        ready_rx
            .await
            .context("failed to prepare scheduled action chat")?
    }
}

impl<Rpo, Live, Runner> EventExecutor for InProcessExecutor<Rpo, Live, Runner>
where
    Rpo: ScheduledActionRepo,
    Live: ScheduledActionLiveUpdate,
    Runner: ScheduledAgentRunner,
{
    async fn execute(
        &self,
        run: &ClaimedEventRun,
        cancellation: impl Future<Output = ()> + Send,
    ) -> EventExecutionResult {
        let mut chat_id = None;
        let shutdown = async {
            tokio::select! {
                _ = self.cancellation.cancelled() => {},
                _ = cancellation => {},
            }
        };
        let deadline = run.deadline.min(run.started_at + MAX_ACTION_TIME);
        let result = bounded(deadline, shutdown, async {
            let created = self.prepare(&run.action, &mut chat_id).await?;
            self.runner
                .run(&run.action, &created, Some(&run.run.pending.event))
                .await
        })
        .await;
        let record = execution_record(&run.action, chat_id.clone(), run.started_at, &result);
        if let Some(chat_id) = chat_id {
            let _ = tokio::time::timeout(
                BOOKKEEPING_TIMEOUT,
                self.stopped(&run.action, &chat_id, result.is_ok()),
            )
            .await;
        }
        // No claim/release or history writes here: the worker finalizes with
        // run.token in the same transaction as the terminal queue transition.
        EventExecutionResult {
            outcome: match &result {
                Ok(()) => EventRunOutcome::Succeeded,
                Err(error) if error.is::<ExecutionCancelled>() => EventRunOutcome::Interrupted,
                Err(_) => EventRunOutcome::Failed,
            },
            record: Some(record),
        }
    }
}
