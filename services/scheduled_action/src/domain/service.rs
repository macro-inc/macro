use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{
        EditAccessLevel, EntityAccessReceipt, EntityType, OwnerAccessLevel, RequiredPermission,
        ViewAccessLevel,
    },
    ports::ScheduledActionGrants,
};
use entity_registry::OwnedPurgeOutcome;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::{CreationPrincipal, Owner};
use tokio::sync::mpsc::Sender;

use super::event_runs::ConfigurationRevision;
use super::event_trigger::ActionTrigger;
use super::models::{
    ActionConfiguration, ActionExecutionRecord, ActionPolicyError, CreateScheduledAction,
    DispatchEvent, InProgressExecution, OwnerNotUserError, ScheduledAction, UpdateScheduledAction,
};
use super::ports::{
    ScheduledActionExecutor, ScheduledActionRepo, ScheduledActionService, TaskTargetValidator,
};
use super::target_validation::{ModelOnlyTargets, require_explicit_agent};

#[cfg(test)]
pub(crate) mod test;

pub struct ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets = ModelOnlyTargets> {
    repo: Arc<Rpo>,
    executor: Arc<Exe>,
    grants: Arc<Grants>,
    dispatcher_tx: Sender<DispatchEvent>,
    event_management_enabled: bool,
    targets: Targets,
}

impl<Rpo: ScheduledActionRepo, Exe, Grants> ScheduledActionServiceImpl<Rpo, Exe, Grants> {
    /// Event management defaults off until explicitly enabled by composition.
    pub fn new(
        repo: Arc<Rpo>,
        executor: Arc<Exe>,
        dispatcher_tx: Sender<DispatchEvent>,
        grants: Arc<Grants>,
    ) -> Self {
        Self {
            repo,
            executor,
            grants,
            dispatcher_tx,
            event_management_enabled: false,
            targets: ModelOnlyTargets,
        }
    }
}

impl<Rpo: ScheduledActionRepo, Exe, Grants, Targets>
    ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets>
{
    pub fn with_target_validation<T: TaskTargetValidator>(
        self,
        targets: T,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, T> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            event_management_enabled: self.event_management_enabled,
            targets,
        }
    }

    pub fn with_event_management_enabled(mut self, enabled: bool) -> Self {
        self.event_management_enabled = enabled;
        self
    }

    async fn load_granted<T: RequiredPermission>(
        &self,
        receipt: &EntityAccessReceipt<T>,
    ) -> Result<ScheduledAction> {
        if receipt.entity().entity_type != EntityType::ScheduledAction {
            bail!("scheduled action receipt has the wrong entity type");
        }
        let Ok(id) = receipt.entity().entity_id.parse::<Uuid>() else {
            bail!("scheduled action receipt id is not a uuid");
        };
        match self.repo.get_action(&id).await? {
            Some(action)
                if receipt
                    .acting_user_id()
                    .is_some_and(|user| action.owner.is_user(user)) =>
            {
                Ok(action)
            }
            _ => Err(ActionPolicyError::NotFound.into()),
        }
    }

    fn check_event_management(&self, trigger: &ActionTrigger) -> Result<()> {
        if trigger.event_filters().is_some() && !self.event_management_enabled {
            return Err(ActionPolicyError::EventManagementDisabled.into());
        }
        Ok(())
    }

    async fn replace_configuration(
        &self,
        mut action: ScheduledAction,
        input: ActionConfiguration,
    ) -> Result<ScheduledAction>
    where
        Targets: TaskTargetValidator,
    {
        require_explicit_agent(&action.task, &input.task)?;
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
        if claim_blocks_replacement(&action, now) && !disable_only {
            return Err(ActionPolicyError::UpdateConflict.into());
        }
        if !disable_only {
            self.targets
                .validate_task(&input.task, action.owner_user()?)
                .await?;
            if trigger_changed || (!action.enabled && input.enabled) {
                action.next_run_at = next_run(&input.trigger)?;
            }
        }
        action.event_activated_at = if input.trigger.event_filters().is_some() {
            if trigger_changed || (!action.enabled && input.enabled) {
                Some(now)
            } else {
                action.event_activated_at
            }
        } else {
            None
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
}

fn next_run(trigger: &ActionTrigger) -> Result<Option<DateTime<Utc>>> {
    let next = trigger.next_run_after(Utc::now());
    if trigger.has_schedule() && next.is_none() && trigger.event_filters().is_none() {
        return Err(ActionPolicyError::NoFutureFirings.into());
    }
    Ok(next)
}

pub(crate) async fn list_accessible_actions<R, G>(
    repo: &R,
    grants: &G,
    user_id: &MacroUserIdStr<'static>,
) -> Result<Vec<ScheduledAction>>
where
    R: ScheduledActionRepo,
    G: ScheduledActionGrants,
{
    let ids = grants
        .accessible_scheduled_action_ids(user_id)
        .await
        .map_err(|error| anyhow::anyhow!("failed to list accessible scheduled actions: {error}"))?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut actions = repo.get_actions_by_ids(&ids).await?;
    actions.retain(|action| action.owner.is_user(user_id));
    actions.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then(left.id.cmp(&right.id))
    });
    Ok(actions)
}

fn claim_blocks_replacement(action: &ScheduledAction, now: DateTime<Utc>) -> bool {
    action
        .claim_expires_at()
        .is_some_and(|expires_at| now <= expires_at)
}

fn same_trigger(left: &ActionTrigger, right: &ActionTrigger) -> bool {
    left == right
}

impl<Rpo, Exe, Grants, Targets> ScheduledActionService
    for ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets>
where
    Rpo: ScheduledActionRepo,
    Grants: ScheduledActionGrants,
    Targets: TaskTargetValidator,
    Exe: ScheduledActionExecutor + Send + Sync + 'static,
{
    async fn get_action(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ScheduledAction> {
        self.load_granted(&receipt).await
    }

    async fn delete_user_actions(&self, user_id: MacroUserIdStr<'static>) -> Result<()> {
        // Use the repository list, not the legacy cron-only service list, so
        // event-triggered actions are also removed regardless of rollout gates.
        for action in self.repo.get_owned_actions(&user_id).await? {
            if !action.owner.is_user(&user_id) {
                bail!("account cleanup returned an action owned by another principal");
            }
            let Some(id) = action.id else {
                bail!("cannot delete action without id");
            };
            // Reserve before deleting: a stopped dispatcher must not leave us
            // reporting failure after losing the row needed to retry its event.
            let permit = self.dispatcher_tx.reserve().await?;
            self.repo.delete_action(&id).await?;
            permit.send(DispatchEvent::Delete(action));
        }
        Ok(())
    }

    #[tracing::instrument(
        err,
        skip(self, expected_owner),
        fields(%id, owner.kind = ?expected_owner.owner_type())
    )]
    async fn purge_owned_action(
        &self,
        id: Uuid,
        expected_owner: &Owner,
    ) -> Result<OwnedPurgeOutcome> {
        let Some(action) = self.repo.get_action(&id).await? else {
            return Ok(OwnedPurgeOutcome::Purged);
        };
        if action.owner != *expected_owner {
            return Ok(OwnedPurgeOutcome::OwnedElsewhere);
        }
        // Reserve before deleting: a stopped dispatcher must fail the purge
        // while the row still exists for the retry to find.
        let permit = self.dispatcher_tx.reserve().await?;
        self.repo.delete_action(&id).await?;
        permit.send(DispatchEvent::Delete(action));
        Ok(OwnedPurgeOutcome::Purged)
    }

    async fn create_action(
        &self,
        principal: &CreationPrincipal,
        input: CreateScheduledAction,
    ) -> Result<ScheduledAction> {
        let owner = principal.owner();
        let owner_user = owner.as_user().ok_or(OwnerNotUserError {
            owner_type: owner.owner_type(),
        })?;
        let input = ActionConfiguration::from(input);
        self.check_event_management(&input.trigger)?;
        self.targets.validate_task(&input.task, owner_user).await?;
        let now = Utc::now();
        let next_run_at = next_run(&input.trigger)?;
        let event_activated_at = input.trigger.event_filters().is_some().then_some(now);
        let created = self
            .repo
            .create_action(ScheduledAction {
                id: None,
                owner,
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
        Ok(
            list_accessible_actions(self.repo.as_ref(), self.grants.as_ref(), &user_id)
                .await?
                .into_iter()
                .filter(|action| {
                    include_events || matches!(action.trigger, ActionTrigger::Cron { .. })
                })
                .collect(),
        )
    }

    async fn update_action(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        input: UpdateScheduledAction,
    ) -> Result<ScheduledAction> {
        let action = self.load_granted(&receipt).await?;
        let input = input.into_configuration(action.enabled);
        self.replace_configuration(action, input).await
    }

    async fn set_enabled(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        enabled: bool,
    ) -> Result<ScheduledAction> {
        let action = self.load_granted(&receipt).await?;
        if action.enabled == enabled {
            return Ok(action);
        }
        let input = ActionConfiguration {
            name: action.name.clone(),
            trigger: action.trigger.clone(),
            kind: action.kind.clone(),
            task: action.task.clone(),
            enabled,
        };
        self.replace_configuration(action, input).await
    }

    async fn delete_action(&self, receipt: EntityAccessReceipt<OwnerAccessLevel>) -> Result<()> {
        let action = self.load_granted(&receipt).await?;
        let Some(id) = action.id else {
            bail!("cannot delete action without id");
        };
        self.repo.delete_action(&id).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Delete(action))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch delete event: {e}"))?;
        Ok(())
    }

    async fn execute_action_now(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<InProgressExecution> {
        let action = self.load_granted(&receipt).await?;
        action.owner_user()?;
        // Manual execution deliberately has no event reference or event-run ID.
        self.executor.execute_action(action).await
    }

    async fn get_execution_records(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<ActionExecutionRecord>> {
        let action = self.load_granted(&receipt).await?;
        let Some(id) = action.id else {
            bail!("cannot read execution history without id");
        };
        self.repo.get_execution_records(&id).await
    }
}
