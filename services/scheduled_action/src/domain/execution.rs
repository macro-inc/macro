#[cfg(test)]
mod test;

use std::{sync::Arc, time::Duration};

use ai_billing::{AiAdmissionError, AiAdmissionService, DisabledAiAdmissionService};
use ai_usage::AiFeature;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use macro_uuid::{Uuid, generate_uuid_v7};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use crate::domain::event_runs::{
    ClaimedEventRun, EventExecutionResult, EventExecutor, EventRunOutcome,
};
use crate::domain::models::{
    ActionExecutionRecord, AgentTask, ExecutionResource, ExecutionResult, InProgressExecution,
    MAX_ACTION_TIME, ResolvedTaskTarget, ScheduledAction, ScheduledActionUpdate,
};
use crate::domain::ports::{
    ScheduledActionExecutor, ScheduledActionLiveUpdate, ScheduledActionRepo, ScheduledAgentRunner,
};

/// Run identity allocated before any awaited preparation. Runners can cancel
/// partially created remote sessions even when preparation never returns.
#[derive(Debug)]
pub struct ExecutionHandle {
    /// Caller-generated agent session ID, available before preparation starts.
    pub session_id: Uuid,
    /// Caller-generated initial action ID for prompt delivery and status checks.
    pub action_id: Uuid,
    /// Set as soon as resource existence is established, even if preparation later fails.
    pub resource: Option<ExecutionResource>,
    // Cancellation during admission must not contact a runner that never started.
    preparation_started: bool,
}

impl Default for ExecutionHandle {
    fn default() -> Self {
        Self {
            session_id: generate_uuid_v7(),
            action_id: generate_uuid_v7(),
            resource: None,
            preparation_started: false,
        }
    }
}

/// Shared execution path. Cron/manual calls return after tracked preparation;
/// event workers await it and own atomic event/history finalization and release.
pub struct InProcessExecutor<Rpo, Live, Runner> {
    repo: Arc<Rpo>,
    live_updates: Arc<Live>,
    runner: Arc<Runner>,
    admission: Arc<dyn AiAdmissionService>,
    tracker: TaskTracker,
    cancellation: CancellationToken,
}

impl<Rpo, Live, Runner> Clone for InProcessExecutor<Rpo, Live, Runner> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
            live_updates: self.live_updates.clone(),
            runner: self.runner.clone(),
            admission: self.admission.clone(),
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
    /// Admission defaults off for compatibility; production must configure it
    /// with `with_admission` using the shared enforcement policy.
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
            admission: Arc::new(DisabledAiAdmissionService),
            tracker,
            cancellation,
        }
    }

    /// Configure model admission. Agent funding and admission belong to the
    /// session/harness service, not to the scheduler's model policy.
    pub fn with_admission(mut self, admission: Arc<dyn AiAdmissionService>) -> Self {
        self.admission = admission;
        self
    }

    async fn prepare(
        &self,
        action: &ScheduledAction,
        handle: &mut ExecutionHandle,
    ) -> Result<ExecutionResource> {
        let owner = action.owner_user()?.clone();
        let action_id = action.id.context("persisted action required")?;
        let task: AgentTask =
            serde_json::from_value(action.task.clone()).context("invalid agent task definition")?;
        if matches!(task.resolve_target()?, ResolvedTaskTarget::Model { .. }) {
            self.admission.admit(&owner, AiFeature::Automation).await?;
        }
        handle.preparation_started = true;
        self.runner.prepare(action, handle).await?;
        // Retain the resource even if publishing Started stalls or is cancelled.
        let resource = handle
            .resource
            .clone()
            .context("runner prepared no resource")?;
        self.live_updates
            .publish_update(ScheduledActionUpdate::Started {
                owner,
                action_id,
                chat_id: resource.chat_id(),
                resource: Some(resource.clone()),
            })
            .await;
        Ok(resource)
    }

    async fn cancel(
        &self,
        action: &ScheduledAction,
        handle: &ExecutionHandle,
        error: &anyhow::Error,
    ) {
        if !handle.preparation_started
            || (handle.resource.is_none() && error.is::<AiAdmissionError>())
        {
            return;
        }
        match tokio::time::timeout(CANCELLATION_TIMEOUT, self.runner.cancel(action, handle)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::warn!(?error, action_id=?action.id, "runner cancellation failed")
            }
            Err(error) => {
                tracing::warn!(?error, action_id=?action.id, "runner cancellation timed out")
            }
        }
    }

    async fn stopped(
        &self,
        action: &ScheduledAction,
        resource: ExecutionResource,
        is_success: bool,
    ) {
        if let (Ok(owner), Some(action_id)) = (action.owner_user(), action.id) {
            self.live_updates
                .publish_update(ScheduledActionUpdate::Stopped {
                    owner: owner.clone(),
                    action_id,
                    chat_id: resource.chat_id(),
                    resource: Some(resource),
                    is_success,
                })
                .await;
        }
    }
}

const BOOKKEEPING_TIMEOUT: Duration = Duration::from_secs(10);
const CANCELLATION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
#[error("scheduled action cancelled")]
struct ExecutionCancelled;

/// Bound preparation and execution by the claim's original deadline. Dropping
/// the operation triggers local session guards; bounded remote cancellation is
/// attempted separately before bookkeeping.
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
    resource: Option<ExecutionResource>,
    started_at: DateTime<Utc>,
    result: &Result<()>,
) -> ActionExecutionRecord {
    let end_time = Utc::now();
    ActionExecutionRecord {
        id: None,
        action_id: action.id.expect("claimed actions are persisted"),
        resource_id: resource.as_ref().map(|resource| resource.id.clone()),
        start_time: started_at,
        end_time,
        is_success: result.is_ok(),
        result: serde_json::to_value(ExecutionResult::new(
            resource,
            result.as_ref().err().map(ToString::to_string),
        ))
        .expect("execution metadata is JSON serializable"),
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
        // a claim or abandon a run after creating its resource.
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let executor = self.clone();
        self.tracker.spawn(async move {
            let claim = bounded(
                deadline,
                executor.cancellation.cancelled(),
                executor
                    .repo
                    .claim_action(&id, action.configuration_revision, action.next_run_at),
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
            let mut handle = ExecutionHandle::default();
            let result = bounded(deadline, executor.cancellation.cancelled(), async {
                let resource = executor.prepare(&action, &mut handle).await?;
                if let Some(ready_tx) = ready_tx.take() {
                    let _ = ready_tx.send(Ok(InProgressExecution {
                        action_id: id,
                        chat_id: resource.chat_id(),
                        resource: Some(resource),
                    }));
                }
                executor.runner.run(&action, &handle, None).await
            })
            .await;
            if let Err(error) = &result {
                executor.cancel(&action, &handle, error).await;
            }
            let record = execution_record(&action, handle.resource.clone(), start_time, &result);
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
            if let Some(resource) = handle.resource {
                let _ = tokio::time::timeout(
                    BOOKKEEPING_TIMEOUT,
                    executor.stopped(&action, resource, result.is_ok()),
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
            .context("failed to prepare scheduled action resource")?
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
        let mut handle = ExecutionHandle::default();
        let shutdown = async {
            tokio::select! {
                _ = self.cancellation.cancelled() => {},
                _ = cancellation => {},
            }
        };
        let deadline = run.deadline.min(run.started_at + MAX_ACTION_TIME);
        let result = bounded(deadline, shutdown, async {
            self.prepare(&run.action, &mut handle).await?;
            self.runner
                .run(&run.action, &handle, Some(&run.run.pending.event))
                .await
        })
        .await;
        if let Err(error) = &result {
            self.cancel(&run.action, &handle, error).await;
        }
        let record = execution_record(
            &run.action,
            handle.resource.clone(),
            run.started_at,
            &result,
        );
        if let Some(resource) = handle.resource {
            let _ = tokio::time::timeout(
                BOOKKEEPING_TIMEOUT,
                self.stopped(&run.action, resource, result.is_ok()),
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
