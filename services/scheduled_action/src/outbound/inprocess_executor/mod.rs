mod agent_task;
mod notify;
mod remote_agent_task;

use std::sync::Arc;

use ai_tools::ToolServiceContext;
use anyhow::Result;
use chrono::Utc;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use serde_json::Value;
use sqlx::PgPool;

use crate::domain::models::{
    ActionExecutionRecord, ActionKind, AlreadyRunningError, InProgressExecution, MAX_ACTION_TIME,
    ScheduledAction, ScheduledActionUpdate,
};
use crate::domain::ports::{
    RemoteAgentClient, ScheduledActionExecutor, ScheduledActionLiveUpdate, ScheduledActionRepo,
};

pub struct InProcessExecutor<
    Rpo: ScheduledActionRepo,
    Live: ScheduledActionLiveUpdate,
    Remote: RemoteAgentClient,
> {
    repo: Arc<Rpo>,
    db: PgPool,
    tool_context: ToolServiceContext,
    notification_ingress: Arc<SqsNotificationIngress<SqsQueue>>,
    live_updates: Arc<Live>,
    remote_agent_client: Arc<Remote>,
}

impl<Rpo: ScheduledActionRepo, Live: ScheduledActionLiveUpdate, Remote: RemoteAgentClient>
    InProcessExecutor<Rpo, Live, Remote>
{
    pub fn new(
        repo: Arc<Rpo>,
        db: PgPool,
        tool_context: ToolServiceContext,
        notification_ingress: Arc<SqsNotificationIngress<SqsQueue>>,
        live_updates: Arc<Live>,
        remote_agent_client: Arc<Remote>,
    ) -> Self {
        Self {
            repo,
            db,
            tool_context,
            notification_ingress,
            live_updates,
            remote_agent_client,
        }
    }
}

fn try_claim(action: &ScheduledAction) -> Result<()> {
    if let Some(claimed_at) = action.claimed {
        let elapsed = Utc::now() - claimed_at;
        if elapsed < MAX_ACTION_TIME {
            return Err(anyhow::Error::new(AlreadyRunningError {
                action_id: *action.id.as_ref().unwrap(),
            }));
        }
    }
    Ok(())
}

impl<Rpo, Live, Remote> ScheduledActionExecutor for InProcessExecutor<Rpo, Live, Remote>
where
    Rpo: ScheduledActionRepo + Send + Sync + 'static,
    Live: ScheduledActionLiveUpdate,
    Remote: RemoteAgentClient,
{
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        try_claim(&action)?;

        let id = *action.id.as_ref().unwrap();
        self.repo.claim_action(&id).await?;

        // Create the chat up front so the caller gets a chat_id synchronously
        // and the eventual execution record can link back to it.
        // Both kinds write their run transcript to a chat, so the UI (which
        // navigates by chat_id) is identical for a remote agent.
        let created_chat = match action.kind {
            ActionKind::Agent | ActionKind::RemoteAgent => {
                agent_task::create_run_chat(&self.db, &action).await
            }
        };

        // The claim is taken before setup, and only the spawned run releases
        // it. Failing here without releasing would leave the action unrunnable
        // until the claim goes stale (MAX_ACTION_TIME).
        let chat_id = match created_chat {
            Ok(chat_id) => chat_id,
            Err(e) => {
                if let Err(release_error) = self.repo.release_action(&id).await {
                    tracing::error!(
                        error=?release_error,
                        action_id=?id,
                        "failed to release action claim after run setup failed"
                    );
                }
                return Err(e);
            }
        };

        self.live_updates
            .publish_update(ScheduledActionUpdate::Started {
                owner: action.owner.clone(),
                action_id: id,
                chat_id: chat_id.clone(),
            })
            .await;

        let execution = InProgressExecution {
            action_id: id,
            chat_id: Some(chat_id.clone()),
        };

        let repo = Arc::clone(&self.repo);
        let db = self.db.clone();
        let tool_context = self.tool_context.clone();
        let notification_ingress = Arc::clone(&self.notification_ingress);
        let live_updates = Arc::clone(&self.live_updates);
        let remote_agent_client = Arc::clone(&self.remote_agent_client);
        let start_time = Utc::now();
        let record_resource_id = chat_id.clone();
        tokio::spawn(async move {
            let result = run_job(
                &db,
                &tool_context,
                &notification_ingress,
                remote_agent_client.as_ref(),
                &action,
                &chat_id,
            )
            .await;
            let end_time = Utc::now();
            let is_success = result.is_ok();

            let record = ActionExecutionRecord {
                id: None,
                action_id: id,
                resource_id: Some(record_resource_id.clone()),
                start_time,
                end_time,
                is_success,
                result: match &result {
                    Ok(_) => Value::Null,
                    Err(e) => Value::String(e.to_string()),
                },
                created_at: end_time,
            };

            if let Err(e) = repo.create_execution_record(record).await {
                tracing::error!(error=?e, action_id=?id, "failed to save execution record");
            }

            if let Err(e) = repo.update_last_executed(&id, end_time).await {
                tracing::error!(error=?e, action_id=?id, "failed to update last executed time");
            }

            // Recompute next_run_at based on the cron, so the UI shows the
            // upcoming run after the one we just completed. The repo fetches
            // the current schedule + timezone itself and skips the update if
            // there's no future fire time.
            if let Err(e) = repo.update_next_run_at(&id).await {
                tracing::error!(error=?e, action_id=?id, "failed to update next_run_at");
            }

            if let Err(e) = repo.release_action(&id).await {
                tracing::error!(error=?e, action_id=?id, "failed to release action claim");
            }

            // Fire the stop event after release so that any follow-up "run
            // now" the UI issues in response will not race the claim.
            live_updates
                .publish_update(ScheduledActionUpdate::Stopped {
                    owner: action.owner.clone(),
                    action_id: id,
                    chat_id: record_resource_id.clone(),
                    is_success,
                })
                .await;

            if let Err(e) = &result {
                tracing::error!(error=?e, action_id=?id, "scheduled action execution failed");
            }
        });

        Ok(execution)
    }
}

async fn run_job<Remote: RemoteAgentClient>(
    db: &PgPool,
    tool_context: &ToolServiceContext,
    notification_ingress: &Arc<SqsNotificationIngress<SqsQueue>>,
    remote_agent_client: &Remote,
    action: &ScheduledAction,
    chat_id: &str,
) -> Result<()> {
    match action.kind {
        ActionKind::Agent => {
            agent_task::run_agent_task(db, tool_context, notification_ingress, action, chat_id)
                .await?;
            Ok(())
        }
        ActionKind::RemoteAgent => {
            remote_agent_task::run_remote_agent_task(
                db,
                remote_agent_client,
                notification_ingress,
                action,
                chat_id,
            )
            .await?;
            Ok(())
        }
    }
}
