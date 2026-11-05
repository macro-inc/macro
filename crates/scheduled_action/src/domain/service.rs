use std::sync::Arc;

use ai_billing::PlanTier;
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
use github::domain::{models::GithubError, ports::GithubInstallationClaims};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::{CreationPrincipal, Owner};
use tokio::sync::mpsc::Sender;

use super::event_runs::ConfigurationRevision;
use super::event_trigger::ActionTrigger;
use super::models::{
    ActionConfiguration, ActionConfigurationUpdate, ActionExecutionRecord, ActionPolicyError,
    DispatchEvent, InProgressExecution, ListedAction, OwnerNotUserError, ScheduledAction,
};
use super::ports::{
    RoutinePlans, ScheduledActionExecutor, ScheduledActionRepo, ScheduledActionService,
    TaskTargetValidator,
};
use super::routine_limit::RoutineLimit;
use super::target_validation::{ModelOnlyTargets, require_explicit_selection};

#[cfg(test)]
pub(crate) mod test;

pub struct ScheduledActionServiceImpl<
    Rpo,
    Exe,
    Grants,
    Targets = ModelOnlyTargets,
    Github = NoGithubLinks,
    Plans = FreePlans,
> {
    repo: Arc<Rpo>,
    executor: Arc<Exe>,
    grants: Arc<Grants>,
    dispatcher_tx: Sender<DispatchEvent>,
    event_management_enabled: bool,
    conditions_enabled: bool,
    targets: Targets,
    github: Github,
    plans: Plans,
}

/// Composition without plan lookups: every owner gets the Free routine
/// limit, so a host that forgets to wire plans fails closed.
pub struct FreePlans;

impl RoutinePlans for FreePlans {
    async fn plan(&self, _owner: &MacroUserIdStr<'static>) -> Result<PlanTier> {
        Ok(PlanTier::Free)
    }
}

/// Composition without GitHub: no owner counts as linked, so GitHub triggers
/// cannot be enabled.
pub struct NoGithubLinks;

impl GithubInstallationClaims for NoGithubLinks {
    async fn is_linked(&self, _user: &MacroUserIdStr<'_>) -> Result<bool, GithubError> {
        Ok(false)
    }

    async fn has_claim(
        &self,
        _user: &MacroUserIdStr<'_>,
        _installation_id: u64,
    ) -> Result<bool, GithubError> {
        Ok(false)
    }
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
            conditions_enabled: false,
            targets: ModelOnlyTargets,
            github: NoGithubLinks,
            plans: FreePlans,
        }
    }
}

impl<Rpo: ScheduledActionRepo, Exe, Grants, Targets, Github, Plans>
    ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Plans>
{
    pub fn with_target_validation<T: TaskTargetValidator>(
        self,
        targets: T,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, T, Github, Plans> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            event_management_enabled: self.event_management_enabled,
            conditions_enabled: self.conditions_enabled,
            targets,
            github: self.github,
            plans: self.plans,
        }
    }

    /// Lets owners with a linked GitHub account enable GitHub triggers.
    pub fn with_github_links<G: GithubInstallationClaims>(
        self,
        github: G,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, G, Plans> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            event_management_enabled: self.event_management_enabled,
            conditions_enabled: self.conditions_enabled,
            targets: self.targets,
            github,
            plans: self.plans,
        }
    }

    /// Limits each owner's active routines by their plan.
    pub fn with_routine_plans<P: RoutinePlans>(
        self,
        plans: P,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, P> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            event_management_enabled: self.event_management_enabled,
            conditions_enabled: self.conditions_enabled,
            targets: self.targets,
            github: self.github,
            plans,
        }
    }

    pub fn with_event_management_enabled(mut self, enabled: bool) -> Self {
        self.event_management_enabled = enabled;
        self
    }

    /// Accept trigger conditions only when dispatch can check them.
    pub fn with_conditions_enabled(mut self, enabled: bool) -> Self {
        self.conditions_enabled = enabled;
        self
    }

    async fn load_granted<T: RequiredPermission>(
        &self,
        receipt: &EntityAccessReceipt<T>,
    ) -> Result<ScheduledAction> {
        granted_action(self.repo.as_ref(), receipt).await
    }

    /// Delete `action` and hand its removal to the dispatcher. The permit is
    /// reserved first so a stopped dispatcher fails while the row still exists
    /// for a retry to find.
    async fn delete_and_dispatch(&self, id: &Uuid, action: ScheduledAction) -> Result<()> {
        let permit = self.dispatcher_tx.reserve().await?;
        self.repo.delete_action(id).await?;
        permit.send(DispatchEvent::Delete(action));
        Ok(())
    }

    fn check_event_management(&self, trigger: &ActionTrigger) -> Result<()> {
        if trigger.event_filters().is_some() && !self.event_management_enabled {
            return Err(ActionPolicyError::EventManagementDisabled.into());
        }
        Ok(())
    }

    fn check_conditions(&self, trigger: &ActionTrigger) -> Result<()> {
        if trigger
            .event_filters()
            .is_some_and(|filters| filters.has_conditions())
            && !self.conditions_enabled
        {
            return Err(ActionPolicyError::ConditionsDisabled.into());
        }
        Ok(())
    }

    /// The limit a write must respect when it leaves `action` active and it
    /// wasn't before. `None` when the write adds no active routine, so pausing,
    /// deleting, and editing an active routine never depend on plan lookups.
    #[tracing::instrument(
        name = "routine.activation_limit",
        err,
        skip_all,
        fields(plan = tracing::field::Empty, limit = tracing::field::Empty)
    )]
    async fn activation_limit(
        &self,
        was_active: bool,
        action: &ScheduledAction,
    ) -> Result<Option<RoutineLimit>>
    where
        Plans: RoutinePlans,
    {
        if was_active || !action.is_active() {
            return Ok(None);
        }
        let limit = RoutineLimit::for_plan(self.plans.plan(action.owner_user()?).await?);
        let span = tracing::Span::current();
        span.record("plan", tracing::field::display(limit.plan()));
        span.record("limit", limit.max_active());
        Ok(Some(limit))
    }

    async fn create(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        template_id: Option<Uuid>,
    ) -> Result<ScheduledAction>
    where
        Targets: TaskTargetValidator,
        Github: GithubInstallationClaims,
        Plans: RoutinePlans,
    {
        let owner = principal.owner();
        let owner_user = owner.as_user().ok_or(OwnerNotUserError {
            owner_type: owner.owner_type(),
        })?;
        self.check_event_management(&input.trigger)?;
        self.check_conditions(&input.trigger)?;
        self.targets.validate_task(&input.task, owner_user).await?;
        if input.enabled {
            self.check_github(&input.trigger, owner_user).await?;
        }
        let now = Utc::now();
        let next_run_at = next_run(&input.trigger, now, |_| false)?;
        let event_activated_at = input.trigger.event_filters().is_some().then_some(now);
        let action = ScheduledAction {
            id: None,
            owner,
            name: input.name,
            trigger: input.trigger,
            kind: input.kind,
            task: input.task,
            enabled: input.enabled,
            run_visibility: input.run_visibility,
            created_at: now,
            updated_at: now,
            configuration_revision: ConfigurationRevision::INITIAL,
            event_activated_at,
            next_run_at,
            claimed: None,
            template_id,
        };
        let activation = self.activation_limit(false, &action).await?;
        let created = self.repo.create_action(action, activation).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Create(created.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch create event: {e}"))?;
        Ok(created)
    }

    /// An enabled GitHub trigger needs its owner to have linked GitHub.
    async fn check_github(&self, trigger: &ActionTrigger, owner: &MacroUserIdStr<'_>) -> Result<()>
    where
        Github: GithubInstallationClaims,
    {
        if trigger
            .event_filters()
            .is_some_and(|filters| filters.watches_github())
            && !self.github.is_linked(owner).await?
        {
            return Err(ActionPolicyError::GithubNotLinked.into());
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
        Github: GithubInstallationClaims,
        Plans: RoutinePlans,
    {
        require_explicit_selection(&action.task, &input.task)?;
        let was_active = action.is_active();
        let trigger_changed = !same_trigger(&action.trigger, &input.trigger);
        let configuration_changed = trigger_changed
            || action.name != input.name
            || action.kind != input.kind
            || action.task != input.task
            || action.run_visibility != input.run_visibility;
        let disable_only = !input.enabled && !configuration_changed;
        // A rollout gate must not prevent an owner from stopping an existing
        // event action. Deletion, history and explicit manual runs also remain available.
        if !disable_only {
            self.check_event_management(&action.trigger)?;
            self.check_event_management(&input.trigger)?;
            self.check_conditions(&input.trigger)?;
        }
        let now = Utc::now();
        if claim_blocks_replacement(&action, now) && !disable_only {
            return Err(ActionPolicyError::UpdateConflict.into());
        }
        if !disable_only {
            self.targets
                .validate_task(&input.task, action.owner_user()?)
                .await?;
            if input.enabled {
                self.check_github(&input.trigger, action.owner_user()?)
                    .await?;
            }
            if trigger_changed || (!action.enabled && input.enabled) {
                action.next_run_at =
                    next_run(&input.trigger, now, |at| once_already_fired(&action, at))?;
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
        action.run_visibility = input.run_visibility;
        action.updated_at = now;

        let activation = self.activation_limit(was_active, &action).await?;
        let updated = self.repo.update_action(action, activation).await?;
        self.dispatcher_tx
            .send(DispatchEvent::Update(updated.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch update event: {e}"))?;
        Ok(updated)
    }
}

/// The routine a receipt names, when the receipt's user owns it.
pub(crate) async fn granted_action<R: ScheduledActionRepo, T: RequiredPermission>(
    repo: &R,
    receipt: &EntityAccessReceipt<T>,
) -> Result<ScheduledAction> {
    if receipt.entity().entity_type != EntityType::ScheduledAction {
        bail!("scheduled action receipt has the wrong entity type");
    }
    let Ok(id) = receipt.entity().entity_id.parse::<Uuid>() else {
        bail!("scheduled action receipt id is not a uuid");
    };
    match repo.get_action(&id).await? {
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

fn next_run(
    trigger: &ActionTrigger,
    now: DateTime<Utc>,
    fired: impl Fn(DateTime<Utc>) -> bool,
) -> Result<Option<DateTime<Utc>>> {
    let next = trigger.first_run_at(now, fired);
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

/// Whether the stored routine already ran its once trigger at `at`. Pending
/// firings never come after `next_run_at`, so a stored once time before it (or
/// with nothing left to run) has been consumed.
fn once_already_fired(stored: &ScheduledAction, at: DateTime<Utc>) -> bool {
    stored.trigger.once_times().contains(&at) && stored.next_run_at.is_none_or(|next| next > at)
}

fn claim_blocks_replacement(action: &ScheduledAction, now: DateTime<Utc>) -> bool {
    action
        .claim_expires_at()
        .is_some_and(|expires_at| now <= expires_at)
}

fn same_trigger(left: &ActionTrigger, right: &ActionTrigger) -> bool {
    left == right
}

impl<Rpo, Exe, Grants, Targets, Github, Plans> ScheduledActionService
    for ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Plans>
where
    Github: GithubInstallationClaims,
    Plans: RoutinePlans,
    Rpo: ScheduledActionRepo,
    Grants: ScheduledActionGrants,
    Targets: TaskTargetValidator,
    Exe: ScheduledActionExecutor + Send + Sync + 'static,
{
    async fn get_action(&self, id: Uuid) -> Result<ScheduledAction> {
        self.repo
            .get_action(&id)
            .await?
            .ok_or_else(|| ActionPolicyError::NotFound.into())
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
            self.delete_and_dispatch(&id, action).await?;
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
        self.delete_and_dispatch(&id, action).await?;
        Ok(OwnedPurgeOutcome::Purged)
    }

    async fn create_action(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
    ) -> Result<ScheduledAction> {
        self.create(principal, input, None).await
    }

    async fn create_action_from_template(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        template_id: Uuid,
    ) -> Result<ScheduledAction> {
        self.create(principal, input, Some(template_id)).await
    }

    async fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
    ) -> Result<Vec<ListedAction>> {
        let actions: Vec<ScheduledAction> =
            list_accessible_actions(self.repo.as_ref(), self.grants.as_ref(), &user_id)
                .await?
                .into_iter()
                .filter(|action| {
                    include_events || matches!(action.trigger, ActionTrigger::Cron { .. })
                })
                .collect();

        let ids: Vec<Uuid> = actions.iter().filter_map(|action| action.id).collect();
        let mut last_runs = self.repo.last_runs(&ids).await?;

        Ok(actions
            .into_iter()
            .map(|action| ListedAction {
                last_run: action.id.and_then(|id| last_runs.remove(&id)),
                action,
            })
            .collect())
    }

    async fn update_action(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        input: ActionConfigurationUpdate,
    ) -> Result<ScheduledAction> {
        let action = self.load_granted(&receipt).await?;
        let input = input.into_configuration(&action);
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
            run_visibility: action.run_visibility,
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
