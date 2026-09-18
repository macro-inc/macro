//! Dispatches due actions by publishing a run request to
//! [`MacroAiRoutinesTopic`](macro_event_topics::MacroAiRoutinesTopic).
//!
//! The scheduler owns *when* a routine fires; the agent trigger consumer owns
//! the run itself. So an "execution" here is the publish: the claim guards it
//! against a peer instance dispatching the same firing, the schedule advances
//! once the broker has the request, and the execution record says the request
//! was dispatched (or why it was not).

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_routines::{AiRoutineMacroEvent, AiRoutineRunRequested, AiRoutineTrigger};
use anyhow::{Context as _, Result};
use chrono::Utc;
use macro_event_broker::{MacroEvent as _, MacroEventBroker};
use macro_uuid::generate_uuid_v7;
use serde_json::json;

use crate::domain::models::{
    ActionExecutionRecord, ActionKind, AgentTask, AlreadyRunningError, InProgressExecution,
    MAX_ACTION_TIME, ScheduledAction,
};
use crate::domain::ports::{ScheduledActionExecutor, ScheduledActionRepo};

/// Publishes a run request for each action it is asked to execute.
///
/// One instance per trigger source: the polling dispatcher stamps requests as
/// scheduled, the HTTP run-now handler as manual.
pub struct KafkaRoutineExecutor<Rpo, Broker> {
    repo: Arc<Rpo>,
    publisher: Arc<Broker>,
    trigger: AiRoutineTrigger,
}

impl<Rpo, Broker> KafkaRoutineExecutor<Rpo, Broker> {
    pub fn new(repo: Arc<Rpo>, publisher: Arc<Broker>, trigger: AiRoutineTrigger) -> Self {
        Self {
            repo,
            publisher,
            trigger,
        }
    }
}

/// Reject an action another worker claimed within the stale window before
/// touching the database.
fn try_claim(action: &ScheduledAction, id: macro_uuid::Uuid) -> Result<()> {
    if let Some(claimed_at) = action.claimed
        && Utc::now() - claimed_at < MAX_ACTION_TIME
    {
        return Err(anyhow::Error::new(AlreadyRunningError { action_id: id }));
    }
    Ok(())
}

fn already_published_this_firing(
    records: &[ActionExecutionRecord],
    next_run_at: chrono::DateTime<Utc>,
) -> Option<&ActionExecutionRecord> {
    records.iter().find(|record| {
        record.is_success
            && record.result.get("status").and_then(|value| value.as_str()) == Some("dispatched")
            && record.start_time >= next_run_at
            && record.resource_id.is_some()
    })
}

async fn publish<Broker: MacroEventBroker>(
    publisher: &Broker,
    event: &AiRoutineMacroEvent,
) -> Result<()> {
    publisher
        .send_event(event)?
        .await
        .context("routine run request publication task failed")??;
    Ok(())
}

impl<Rpo, Broker> ScheduledActionExecutor for KafkaRoutineExecutor<Rpo, Broker>
where
    Rpo: ScheduledActionRepo,
    Broker: MacroEventBroker,
{
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        let id = *action
            .id
            .as_ref()
            .context("cannot execute a scheduled action without an id")?;
        try_claim(&action, id)?;
        let task = match action.kind {
            ActionKind::Agent => serde_json::from_value::<AgentTask>(action.task.clone())
                .context("invalid agent task definition")?,
        };
        self.repo.claim_action(&id).await?;

        let records = match self.repo.get_execution_records(&id).await {
            Ok(records) => records,
            Err(error) => {
                tracing::error!(error = ?error, action_id = %id, "failed to load execution records");
                Vec::new()
            }
        };
        if already_published_this_firing(&records, action.next_run_at).is_some() {
            if let Err(error) = self.repo.update_next_run_at(&id).await {
                tracing::error!(error = ?error, action_id = %id, "failed to update next_run_at");
            }
            if let Err(error) = self.repo.release_action(&id).await {
                tracing::error!(error = ?error, action_id = %id, "failed to release action claim");
            }
            return Ok(InProgressExecution {
                action_id: id,
                chat_id: None,
            });
        }

        let session_id = generate_uuid_v7();
        let request = AiRoutineRunRequested {
            routine_id: id,
            owner: action.owner.clone(),
            name: action.name.clone(),
            model: task.model,
            session_id,
            prompt: task.prompt,
            user_prompt: task.user_prompt,
            requested_at: Utc::now(),
            trigger: self.trigger,
        };

        let start_time = Utc::now();
        let event = AiRoutineMacroEvent::run_requested(request);
        let event_id = event.event().event_id;
        let published = publish(self.publisher.as_ref(), &event).await;
        let end_time = Utc::now();

        let record = ActionExecutionRecord {
            id: None,
            action_id: id,
            resource_id: published.is_ok().then(|| session_id.to_string()),
            start_time,
            end_time,
            is_success: published.is_ok(),
            result: match &published {
                Ok(()) => json!({ "status": "dispatched", "event_id": event_id }),
                Err(error) => json!({ "status": "dispatch_failed", "error": error.to_string() }),
            },
            created_at: end_time,
        };

        // Bookkeeping failures are logged rather than returned: the request is
        // already with the broker (or already failed), and the claim must still
        // be released so the action is not stuck until its stale window lapses.
        if let Err(error) = self.repo.create_execution_record(record).await {
            tracing::error!(error = ?error, action_id = %id, "failed to save execution record");
        }
        if let Err(error) = self.repo.update_last_executed(&id, end_time).await {
            tracing::error!(error = ?error, action_id = %id, "failed to update last executed time");
        }
        // Advance the schedule whether or not the publish succeeded, as the
        // in-process runner did for failed runs: a firing is consumed once
        // attempted, and the record above says how it went.
        if let Err(error) = self.repo.update_next_run_at(&id).await {
            tracing::error!(error = ?error, action_id = %id, "failed to update next_run_at");
        }
        if let Err(error) = self.repo.release_action(&id).await {
            tracing::error!(error = ?error, action_id = %id, "failed to release action claim");
        }

        published?;
        tracing::info!(action_id = %id, macro.event.id = %event_id, "dispatched routine run request");
        Ok(InProgressExecution {
            action_id: id,
            chat_id: None,
        })
    }
}
