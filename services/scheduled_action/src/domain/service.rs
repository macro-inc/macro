use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::Owner;
use tokio::sync::mpsc::Sender;

use super::event_runs::ConfigurationRevision;
use super::event_trigger::ActionTrigger;
use super::models::{
    ActionConfiguration, ActionExecutionRecord, ActionPolicyError, CreateScheduledAction,
    DispatchEvent, InProgressExecution, MAX_ACTION_TIME, ScheduledAction, UpdateScheduledAction,
};
use super::ports::{ScheduledActionExecutor, ScheduledActionRepo, ScheduledActionService};

#[cfg(test)]
pub(crate) mod test;

pub struct ScheduledActionServiceImpl<Rpo, Exe> {
    repo: Arc<Rpo>,
    executor: Arc<Exe>,
    dispatcher_tx: Sender<DispatchEvent>,
    event_management_enabled: bool,
}

impl<Rpo: ScheduledActionRepo, Exe> ScheduledActionServiceImpl<Rpo, Exe> {
    /// Event management defaults off until explicitly enabled by composition.
    pub fn new(repo: Arc<Rpo>, executor: Arc<Exe>, dispatcher_tx: Sender<DispatchEvent>) -> Self {
        Self {
            repo,
            executor,
            dispatcher_tx,
            event_management_enabled: false,
        }
    }

    pub fn with_event_management_enabled(mut self, enabled: bool) -> Self {
        self.event_management_enabled = enabled;
        self
    }

    async fn owned_action(
        &self,
        id: &Uuid,
        caller: &MacroUserIdStr<'static>,
    ) -> Result<ScheduledAction> {
        match self.repo.get_action(id, caller.clone()).await? {
            Some(action) if action.owner.is_user(caller) => Ok(action),
            _ => Err(ActionPolicyError::NotFound.into()),
        }
    }

    fn check_event_management(&self, trigger: &ActionTrigger) -> Result<()> {
        if matches!(trigger, ActionTrigger::Events { .. }) && !self.event_management_enabled {
            return Err(ActionPolicyError::EventManagementDisabled.into());
        }
        Ok(())
    }
}

fn next_run(trigger: &ActionTrigger) -> Result<Option<DateTime<Utc>>> {
    match trigger {
        ActionTrigger::Cron { schedule, timezone } => schedule
            .next_run_after_now(*timezone)
            .map(Some)
            .ok_or_else(|| ActionPolicyError::NoFutureFirings.into()),
        // Filters are validated value objects: neither deserialization nor Rust
        // constructors can supply unbounded, empty or unsupported selectors.
        ActionTrigger::Events { .. } => Ok(None),
    }
}

fn same_trigger(left: &ActionTrigger, right: &ActionTrigger) -> bool {
    match (left, right) {
        (
            ActionTrigger::Cron {
                schedule: a,
                timezone: at,
            },
            ActionTrigger::Cron {
                schedule: b,
                timezone: bt,
            },
        ) => a.as_str() == b.as_str() && at == bt,
        (ActionTrigger::Events { filters: a }, ActionTrigger::Events { filters: b }) => a == b,
        _ => false,
    }
}

impl<Rpo, Exe> ScheduledActionService for ScheduledActionServiceImpl<Rpo, Exe>
where
    Rpo: ScheduledActionRepo,
    Exe: ScheduledActionExecutor + Send + Sync + 'static,
{
    async fn delete_user_actions(&self, user_id: MacroUserIdStr<'static>) -> Result<()> {
        // Use the repository list, not the legacy cron-only service list, so
        // event-triggered actions are also removed regardless of rollout gates.
        for action in self.repo.get_actions(user_id.clone()).await? {
            if !action.owner.is_user(&user_id) {
                bail!("account cleanup returned an action owned by another principal");
            }
            let Some(id) = action.id else {
                bail!("cannot delete action without id");
            };
            // Reserve before deleting: a stopped dispatcher must not leave us
            // reporting failure after losing the row needed to retry its event.
            let permit = self.dispatcher_tx.reserve().await?;
            self.repo.delete_action(&id, user_id.clone()).await?;
            permit.send(DispatchEvent::Delete(action));
        }
        Ok(())
    }

    async fn create_action(
        &self,
        input: CreateScheduledAction,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<ScheduledAction> {
        let input = ActionConfiguration::from(input);
        self.check_event_management(&input.trigger)?;
        let now = Utc::now();
        let next_run_at = next_run(&input.trigger)?;
        let event_activated_at = match &input.trigger {
            ActionTrigger::Events { .. } => Some(now),
            ActionTrigger::Cron { .. } => None,
        };
        let created = self
            .repo
            .create_action(ScheduledAction {
                id: None,
                owner: Owner::User(user_id),
                name: input.name,
                trigger: input.trigger,
                kind: input.kind,
                task: input.task,
                enabled: input.enabled,
                created_at: now,
                updated_at: now,
                configuration_revision: ConfigurationRevision::INITIAL,
                event_activated_at,
                next_run_at,
                claimed: None,
            })
            .await?;
        self.dispatcher_tx
            .send(DispatchEvent::Create(created.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch create event: {e}"))?;
        Ok(created)
    }

    async fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
    ) -> Result<Vec<ScheduledAction>> {
        Ok(self
            .repo
            .get_actions(user_id.clone())
            .await?
            .into_iter()
            .filter(|action| action.owner.is_user(&user_id))
            .filter(|action| include_events || matches!(action.trigger, ActionTrigger::Cron { .. }))
            .collect())
    }

    async fn update_action(
        &self,
        id: &Uuid,
        input: UpdateScheduledAction,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<ScheduledAction> {
        let mut action = self.owned_action(id, &macro_user_id).await?;
        let input = ActionConfiguration::from(input);
        let trigger_changed = !same_trigger(&action.trigger, &input.trigger);
        let configuration_changed = trigger_changed
            || action.name != input.name
            || action.kind != input.kind
            || action.task != input.task;
        let disable_only = !input.enabled && !configuration_changed;
        // A rollout gate must not prevent an owner from stopping an existing
        // event action. Deletion, history and explicit manual runs also remain available.
        if !disable_only {
            self.check_event_management(&action.trigger)?;
            self.check_event_management(&input.trigger)?;
        }
        let now = Utc::now();
        if action
            .claimed
            .is_some_and(|claimed| claimed >= now - MAX_ACTION_TIME)
            && !disable_only
        {
            return Err(ActionPolicyError::UpdateConflict.into());
        }
        if !disable_only {
            action.next_run_at = next_run(&input.trigger)?;
        }
        action.event_activated_at = match &input.trigger {
            ActionTrigger::Cron { .. } => None,
            ActionTrigger::Events { .. }
                if trigger_changed || (!action.enabled && input.enabled) =>
            {
                Some(now)
            }
            ActionTrigger::Events { .. } => action.event_activated_at,
        };
        action.configuration_revision = action.configuration_revision.next()?;
        action.name = input.name;
        action.trigger = input.trigger;
        action.kind = input.kind;
        action.task = input.task;
        action.enabled = input.enabled;
        action.updated_at = now;

        let updated = self.repo.update_action(action).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Update(updated.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch update event: {e}"))?;
        Ok(updated)
    }

    async fn delete_action(&self, id: &Uuid, macro_user_id: MacroUserIdStr<'static>) -> Result<()> {
        let action = self.owned_action(id, &macro_user_id).await?;
        self.repo.delete_action(id, macro_user_id).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Delete(action))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch delete event: {e}"))?;
        Ok(())
    }

    async fn execute_action_now(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<InProgressExecution> {
        let action = self.owned_action(id, &macro_user_id).await?;
        action.owner_user()?;
        // Manual execution deliberately has no event reference or event-run ID.
        self.executor.execute_action(action).await
    }

    async fn get_execution_records(
        &self,
        id: &Uuid,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ActionExecutionRecord>> {
        self.owned_action(id, &macro_user_id).await?;
        self.repo.get_execution_records(id).await
    }
}
