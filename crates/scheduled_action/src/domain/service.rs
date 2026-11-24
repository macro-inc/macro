use std::sync::Arc;

use anyhow::{Result, bail};
use bots::domain::models::AgentMcpServer;
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
use model_entity::EntityAppearance;
use model_owner::{CreationPrincipal, Owner};
use routine_program::{CodeIdentity, RoutineProgram};
use tokio::sync::mpsc::Sender;

use super::appearance::{AppearanceChooser, AppearanceSet, ChangeAppearance, check_pick};
use super::code_check::{CodeCheckError, checked_task, named_steps, same_task};
use super::code_upgrade::{CodeUpgrade, NoCodeUpgrades, UpgradeOutcome};
use super::event_rollout::{EventRoutineRollout, EventRoutinesOff};
use super::event_runs::ConfigurationRevision;
use super::event_trigger::ActionTrigger;
use super::models::{
    ActionConfiguration, ActionConfigurationUpdate, ActionPolicyError, CheckedStepProblems,
    CreatedItem, DispatchEvent, InProgressExecution, ListScope, ListedAction, ListedRun,
    MAX_DESCRIPTION_CHARS, OwnerNotUserError, Requester, RoutineCheck, RoutineLimits, RunCaller,
    RunningRun, ScheduledAction, SubRoutine, SubRoutineKey,
};
use super::ports::{
    CodeUpgrades, DraftHandBacks, NoRoutineCode, RequestSessions, RoutineCode, RoutinePlans,
    SavedAction, ScheduledActionExecutor, ScheduledActionRepo, ScheduledActionService,
    StandardRoutinePlans, StepProblems, SubRoutines, SuggestionOrigins, TaskTargetValidator,
};

mod sub_routines;
use super::run_stops::RunStops;
use super::target_validation::{ModelOnlyTargets, require_explicit_selection};

#[cfg(test)]
pub(crate) mod test;

pub struct ScheduledActionServiceImpl<
    Rpo,
    Exe,
    Grants,
    Targets = ModelOnlyTargets,
    Github = NoGithubLinks,
    Code = NoRoutineCode,
    Upgrades = NoCodeUpgrades,
    Rollout = EventRoutinesOff,
> {
    repo: Arc<Rpo>,
    executor: Arc<Exe>,
    grants: Arc<Grants>,
    dispatcher_tx: Sender<DispatchEvent>,
    rollout: Rollout,
    conditions_enabled: bool,
    targets: Targets,
    github: Github,
    /// Type-checks code steps before they are saved.
    code: Arc<Code>,
    /// How code steps were brought to new SDKs.
    upgrades: Arc<Upgrades>,
    /// Where a routine draft's session hands its check back.
    drafts: Option<DraftChecks>,
    /// What a suggestion a routine is saved from was, for its log.
    origins: Option<Arc<dyn SuggestionOrigins>>,
    /// Finds the agent session behind a create, to tell a routine run's.
    run_sessions: Option<Arc<dyn RequestSessions>>,
    /// Where a stop of a run in progress is sent.
    stops: RunStops,
    /// The routine limits each owner's plan gives.
    plans: Arc<dyn RoutinePlans>,
}

/// What keeps a draft session's check as its answer.
#[derive(Clone)]
struct DraftChecks {
    hand_backs: Arc<dyn DraftHandBacks>,
    sessions: Arc<dyn RequestSessions>,
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
    /// Event triggers stay off until composition supplies a rollout.
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
            rollout: EventRoutinesOff,
            conditions_enabled: false,
            targets: ModelOnlyTargets,
            github: NoGithubLinks,
            code: Arc::new(NoRoutineCode),
            upgrades: Arc::new(NoCodeUpgrades),
            drafts: None,
            origins: None,
            run_sessions: None,
            stops: RunStops::default(),
            plans: Arc::new(StandardRoutinePlans),
        }
    }
}

impl<Rpo: ScheduledActionRepo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
    ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
{
    pub fn with_target_validation<T: TaskTargetValidator>(
        self,
        targets: T,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, T, Github, Code, Upgrades, Rollout> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            rollout: self.rollout,
            conditions_enabled: self.conditions_enabled,
            targets,
            github: self.github,
            code: self.code,
            upgrades: self.upgrades,
            drafts: self.drafts,
            origins: self.origins,
            run_sessions: self.run_sessions,
            stops: self.stops,
            plans: self.plans,
        }
    }

    /// Lets owners with a linked GitHub account enable GitHub triggers.
    pub fn with_github_links<G: GithubInstallationClaims>(
        self,
        github: G,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, G, Code, Upgrades, Rollout> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            rollout: self.rollout,
            conditions_enabled: self.conditions_enabled,
            targets: self.targets,
            github,
            code: self.code,
            upgrades: self.upgrades,
            drafts: self.drafts,
            origins: self.origins,
            run_sessions: self.run_sessions,
            stops: self.stops,
            plans: self.plans,
        }
    }

    /// Decides, per owner, who may save event triggers.
    pub fn with_event_routines<R: EventRoutineRollout>(
        self,
        rollout: R,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, R> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            rollout,
            conditions_enabled: self.conditions_enabled,
            targets: self.targets,
            github: self.github,
            code: self.code,
            upgrades: self.upgrades,
            drafts: self.drafts,
            origins: self.origins,
            run_sessions: self.run_sessions,
            stops: self.stops,
            plans: self.plans,
        }
    }

    /// Lets routines have code steps, type-checked by `code` when saved,
    /// and shows how they were brought to new SDKs from `upgrades`.
    pub fn with_code<C: RoutineCode, U: CodeUpgrades>(
        self,
        code: Arc<C>,
        upgrades: Arc<U>,
    ) -> ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, C, U, Rollout> {
        ScheduledActionServiceImpl {
            repo: self.repo,
            executor: self.executor,
            grants: self.grants,
            dispatcher_tx: self.dispatcher_tx,
            rollout: self.rollout,
            conditions_enabled: self.conditions_enabled,
            targets: self.targets,
            github: self.github,
            code,
            upgrades,
            drafts: self.drafts,
            origins: self.origins,
            run_sessions: self.run_sessions,
            stops: self.stops,
            plans: self.plans,
        }
    }

    /// Keep a routine draft's session's checks as its answer, finding the
    /// session behind a request through `sessions`.
    pub fn with_draft_hand_backs(
        mut self,
        hand_backs: Arc<dyn DraftHandBacks>,
        sessions: Arc<dyn RequestSessions>,
    ) -> Self {
        self.drafts = Some(DraftChecks {
            hand_backs,
            sessions,
        });
        self
    }

    /// Log what suggestion a routine is saved from, found through `origins`.
    pub fn with_suggestion_origins(mut self, origins: Arc<dyn SuggestionOrigins>) -> Self {
        self.origins = Some(origins);
        self
    }

    /// Make routines created from a routine run's agent session that
    /// routine's sub-routines, finding the session through `sessions`.
    pub fn with_run_sessions(mut self, sessions: Arc<dyn RequestSessions>) -> Self {
        self.run_sessions = Some(sessions);
        self
    }

    /// Send stops of runs in progress through `stops`, shared with the
    /// executor that runs them.
    pub fn with_run_stops(mut self, stops: RunStops) -> Self {
        self.stops = stops;
        self
    }

    /// Read each owner's sub-routine limit from their plan through `plans`
    /// instead of giving everyone the standard one.
    pub fn with_routine_plans(mut self, plans: Arc<dyn RoutinePlans>) -> Self {
        self.plans = plans;
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
    async fn delete_and_dispatch(&self, id: &Uuid, action: ScheduledAction) -> Result<()>
    where
        Rpo: SubRoutines,
    {
        // A routine's sub-routines are deleted with it.
        let children = match action.sub_routine {
            Some(_) => Vec::new(),
            None => self.repo.children(id).await?,
        };
        let permit = self.dispatcher_tx.reserve().await?;
        self.repo.delete_action(id).await?;
        permit.send(DispatchEvent::Delete(action));
        for child in children {
            self.dispatcher_tx
                .send(DispatchEvent::Delete(child))
                .await
                .map_err(|e| anyhow::anyhow!("failed to dispatch delete event: {e}"))?;
        }
        Ok(())
    }

    /// Event triggers need the owner's rollout; a flag that cannot be read
    /// counts as off.
    async fn check_event_management(
        &self,
        trigger: &ActionTrigger,
        owner: &MacroUserIdStr<'_>,
    ) -> Result<()>
    where
        Rollout: EventRoutineRollout,
    {
        if trigger.event_filters().is_none() {
            return Ok(());
        }
        let enabled = self
            .rollout
            .enabled_for(owner)
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, "feature flags unavailable; event triggers stay off");
            })
            .unwrap_or(false);
        if !enabled {
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

    /// Every create goes through here, so only a person creates a routine
    /// that writes as them, whichever route it comes by.
    #[expect(
        clippy::too_many_arguments,
        reason = "each create route sets a different subset"
    )]
    async fn create(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        template_id: Option<Uuid>,
        appearance: EntityAppearance,
        suggestion_id: Option<Uuid>,
        sub_routine: Option<SubRoutine>,
        requester: Requester,
    ) -> Result<ScheduledAction>
    where
        Targets: TaskTargetValidator,
        Github: GithubInstallationClaims,
        Code: RoutineCode,
        Rollout: EventRoutineRollout,
    {
        if requester == Requester::Program && writes_as_owner(&input.task) {
            return Err(ActionPolicyError::OwnerIdentityNeedsPerson.into());
        }
        let owner = principal.owner();
        let owner_user = owner.as_user().ok_or(OwnerNotUserError {
            owner_type: owner.owner_type(),
        })?;
        let mut input = input;
        // An agent's pick stands in for the default, or a template's look.
        let appearance = match input.appearance.take() {
            Some(pick) => {
                check_pick(&pick)?;
                pick
            }
            None => {
                appearance
                    .validate()
                    .map_err(ActionPolicyError::InvalidAppearance)?;
                appearance
            }
        };
        input.task = named_steps(&input.task);
        let description = description(&input.description)?;
        self.check_event_management(&input.trigger, owner_user)
            .await?;
        self.check_conditions(&input.trigger)?;
        self.targets.validate_task(&input.task, owner_user).await?;
        let task = checked_task(self.code.as_ref(), &input.task, None).await?;
        if input.enabled {
            self.check_github(&input.trigger, owner_user).await?;
        }
        let now = Utc::now();
        let next_run_at = next_run(&input.trigger, now, |_| false)?;
        let event_activated_at = input.trigger.event_filters().is_some().then_some(now);
        // Only a sub-routine is counted against a limit, so only it reads the
        // owner's plan.
        let max_active_sub_routines = if sub_routine.is_some() {
            self.plans.limits(owner_user).await.active_sub_routines
        } else {
            RoutineLimits::STANDARD.active_sub_routines
        };
        let created = self
            .repo
            .create_action(
                ScheduledAction {
                    id: None,
                    owner,
                    name: input.name,
                    trigger: input.trigger,
                    kind: input.kind,
                    task,
                    enabled: input.enabled,
                    run_visibility: input.run_visibility,
                    created_at: now,
                    updated_at: now,
                    configuration_revision: ConfigurationRevision::INITIAL,
                    event_activated_at,
                    next_run_at,
                    claimed: None,
                    template_id,
                    appearance,
                    suggestion_id,
                    description,
                    sub_routine,
                },
                max_active_sub_routines,
            )
            .await?;
        self.dispatcher_tx
            .send(DispatchEvent::Create(created.clone()))
            .await
            .map_err(|e| anyhow::anyhow!("failed to dispatch create event: {e}"))?;
        Ok(created)
    }

    /// What saving `input` would find wrong, by the same checks [`Self::create`]
    /// makes, and the routine as it would be stored. Nothing is saved.
    async fn check(
        &self,
        owner: &MacroUserIdStr<'static>,
        input: ActionConfiguration,
    ) -> Result<RoutineCheck>
    where
        Targets: TaskTargetValidator,
        Github: GithubInstallationClaims,
        Code: RoutineCode,
        Rollout: EventRoutineRollout,
    {
        let mut input = input;
        input.task = named_steps(&input.task);
        let mut problems = Vec::new();
        let mut steps = Vec::new();
        let found = [
            description(&input.description).map(|_| ()),
            input
                .appearance
                .as_ref()
                .map_or(Ok(()), check_pick)
                .map_err(anyhow::Error::from),
            self.check_event_management(&input.trigger, owner).await,
            self.check_conditions(&input.trigger),
            self.targets.validate_task(&input.task, owner).await,
        ];
        for result in found {
            if let Err(error) = result {
                problems.push(check_problem(error)?);
            }
        }
        match checked_task(self.code.as_ref(), &input.task, None).await {
            Ok(task) => input.task = task,
            Err(CodeCheckError::DoesNotCheck { steps: failing }) => {
                steps = step_positions(&input.task, failing);
            }
            Err(CodeCheckError::Unavailable(reason)) => problems.push(reason),
        }
        if input.enabled
            && let Err(error) = self.check_github(&input.trigger, owner).await
        {
            problems.push(check_problem(error)?);
        }
        if let Err(error) = next_run(&input.trigger, Utc::now(), |_| false) {
            problems.push(check_problem(error)?);
        }
        Ok(RoutineCheck {
            ok: problems.is_empty() && steps.is_empty(),
            problems,
            steps,
            routine: input,
            missing_apps: Vec::new(),
        })
    }

    /// Keep `check` as the answer of the routine draft whose session made
    /// the request `correlation` names, when it is `owner`'s draft. A check
    /// that isn't a draft's, or a store that fails, leaves the check's own
    /// answer alone.
    async fn hand_back(
        &self,
        owner: &MacroUserIdStr<'static>,
        correlation: Option<Uuid>,
        check: &RoutineCheck,
        created: &[CreatedItem],
    ) {
        let (Some(drafts), Some(correlation)) = (&self.drafts, correlation) else {
            return;
        };
        let recorded = async {
            let Some(session) = drafts.sessions.session_of(correlation).await? else {
                return Ok(false);
            };
            drafts
                .hand_backs
                .record(session, owner, check, created)
                .await
        }
        .await;
        match recorded {
            Ok(recorded) => {
                tracing::Span::current().record("routine.check.draft", recorded);
            }
            Err(error) => tracing::warn!(error = ?error, "could not keep a draft's check"),
        }
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

    /// Replace a routine's configuration, then make its sub-routines follow
    /// a change of whether it is on. A program may rename, describe or switch
    /// off a routine that writes as its owner, but not switch one to, change
    /// what one does (its task or trigger), or switch one on.
    async fn replace_configuration(
        &self,
        action: ScheduledAction,
        input: ActionConfiguration,
        requester: Requester,
    ) -> Result<ScheduledAction>
    where
        Rpo: SubRoutines,
        Targets: TaskTargetValidator,
        Github: GithubInstallationClaims,
        Code: RoutineCode,
        Upgrades: CodeUpgrades,
        Rollout: EventRoutineRollout,
    {
        if requester == Requester::Program
            && writes_as_owner(&input.task)
            && (!writes_as_owner(&action.task)
                || !same_task(&action.task, &named_steps(&input.task))
                || !same_trigger(&action.trigger, &input.trigger)
                || (!action.enabled && input.enabled))
        {
            return Err(ActionPolicyError::OwnerIdentityNeedsPerson.into());
        }
        let was_enabled = action.enabled;
        let updated = self.replace_one(action, input, false).await?;
        if updated.sub_routine.is_none() && updated.enabled != was_enabled {
            self.follow_parent(&updated, requester).await;
        }
        Ok(updated)
    }

    /// Store an agent's pick for `action`'s look, unless its owner chose one:
    /// the appearance it has afterwards.
    #[tracing::instrument(name = "routine.pick_appearance", skip_all, fields(
        routine.id = tracing::field::Empty,
        routine.appearance.picked = tracing::field::Empty,
    ), err)]
    async fn pick_appearance(
        &self,
        action: &ScheduledAction,
        pick: EntityAppearance,
        attribution: activity::Attribution,
    ) -> Result<EntityAppearance> {
        let id = action.id.ok_or(ActionPolicyError::NotFound)?;
        let span = tracing::Span::current();
        span.record("routine.id", tracing::field::display(id));
        let set = self
            .repo
            .set_appearance(ChangeAppearance {
                id,
                appearance: pick.clone(),
                chooser: AppearanceChooser::Agent,
                attribution,
                event_id: macro_uuid::generate_uuid_v7(),
                occurred_at: Utc::now(),
            })
            .await?;
        span.record("routine.appearance.picked", set.changed());
        // The look the row holds once locked, not `action`'s: an owner's
        // choice may have committed since the configuration was saved.
        Ok(match set {
            AppearanceSet::Changed { .. } => pick,
            AppearanceSet::Kept { current } => current,
        })
    }

    /// Refuse saving a routine that writes as its owner while any of its
    /// code steps holds code a model wrote in an upgrade (a step the rewrite
    /// changed, saved while the routine wrote as Macro, however many releases
    /// ago) that the owner hasn't changed since: that code would act under
    /// their name. Checked on every save, not only the one that switches the
    /// identity, so restoring the model's code later is refused too.
    async fn refuse_owner_identity_over_a_rewrite(
        &self,
        action: &ScheduledAction,
        task: &serde_json::Value,
    ) -> Result<()>
    where
        Upgrades: CodeUpgrades,
    {
        let (Ok(next), Some(id)) = (RoutineProgram::from_task(task), action.id) else {
            return Ok(());
        };
        if next.code_identity() != CodeIdentity::Owner {
            return Ok(());
        }
        // The sources each rewrite wrote: its steps whose code differs from
        // the task it rewrote.
        let mut written = std::collections::HashSet::new();
        for upgrade in self.upgrades.list_upgrades(id).await? {
            let (UpgradeOutcome::Rewritten, Some(rewrite)) = (upgrade.outcome, upgrade.task) else {
                continue;
            };
            let before = code_sources(&upgrade.previous_task);
            written.extend(
                code_sources(&rewrite)
                    .into_iter()
                    .filter(|source| !before.contains(source)),
            );
        }
        if next
            .code_steps()
            .into_iter()
            .any(|step| written.contains(&step.source))
        {
            return Err(ActionPolicyError::UnreviewedRewrite.into());
        }
        Ok(())
    }

    /// Replace one routine's configuration. `with_parent` marks a
    /// sub-routine switched off because its parent was.
    async fn replace_one(
        &self,
        mut action: ScheduledAction,
        mut input: ActionConfiguration,
        with_parent: bool,
    ) -> Result<ScheduledAction>
    where
        Targets: TaskTargetValidator,
        Github: GithubInstallationClaims,
        Code: RoutineCode,
        Upgrades: CodeUpgrades,
        Rollout: EventRoutineRollout,
    {
        require_explicit_selection(&action.task, &input.task)?;
        input.task = named_steps(&input.task);
        // Clients don't echo the SDK the stored code was checked against.
        if same_task(&action.task, &input.task) {
            input.task = action.task.clone();
        }
        let trigger_changed = !same_trigger(&action.trigger, &input.trigger);
        let configuration_changed = trigger_changed
            || action.name != input.name
            || action.kind != input.kind
            || !same_task(&action.task, &input.task)
            || action.run_visibility != input.run_visibility
            || action.description != input.description.trim();
        let disable_only = !input.enabled && !configuration_changed;
        // A rollout gate must not prevent an owner from stopping an existing
        // event action. Deletion, history and explicit manual runs also remain available.
        if !disable_only {
            let owner = action.owner_user()?;
            self.check_event_management(&action.trigger, owner).await?;
            self.check_event_management(&input.trigger, owner).await?;
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
            self.refuse_owner_identity_over_a_rewrite(&action, &input.task)
                .await?;
            input.task = checked_task(self.code.as_ref(), &input.task, Some(&action.task)).await?;
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
        // Checked like any update, but with nothing to replace: a new revision
        // would only supersede event runs queued under the current one.
        // A sub-routine its parent's pause now holds off must record that,
        // even when nothing else about it changes.
        let newly_held = with_parent
            && !input.enabled
            && action
                .sub_routine
                .as_ref()
                .is_some_and(|link| !link.paused_by_parent);
        if !configuration_changed && action.enabled == input.enabled && !newly_held {
            return Ok(action);
        }
        action.configuration_revision = action.configuration_revision.next()?;
        action.name = input.name;
        action.trigger = input.trigger;
        action.kind = input.kind;
        action.task = input.task;
        action.enabled = input.enabled;
        action.run_visibility = input.run_visibility;
        action.description = description(&input.description)?;
        action.updated_at = now;
        // Off with its parent until it is switched on again, by the parent
        // or by hand; an edit while it is off keeps the mark.
        if let Some(link) = &mut action.sub_routine {
            link.paused_by_parent = !input.enabled && (with_parent || link.paused_by_parent);
        }

        let updated = self.repo.update_action(action).await?;
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

/// Who an appearance write is attributed to: the person, or the bot and the
/// person it acts for. Nobody for an internal or anonymous request.
fn attribution(
    auth: &entity_access::domain::models::EntityAccessAuth,
) -> Option<activity::Attribution> {
    use entity_access::domain::models::EntityAccessAuth;
    match auth {
        EntityAccessAuth::Authenticated(user) => Some(activity::Attribution::direct(
            activity::Actor::new_from_user(user.clone()),
        )),
        EntityAccessAuth::Bot(bot) => Some(activity::Attribution::new(
            activity::Actor::new_from_bot(bot.bot_id()),
            bot.scope().acting_user_id().cloned(),
        )),
        EntityAccessAuth::Internal | EntityAccessAuth::Unauthenticated => None,
    }
}

/// The most apps a check keeps as missing.
const MAX_MISSING_APPS: usize = 10;
/// The longest app slug or name a check keeps.
const MAX_APP_TEXT: usize = 100;

/// The apps a routine draft's session `named` as missing, as a check keeps
/// them ([`missing_apps`]), never one `task` already requires. The session
/// found them in the catalog; whether they are connected is the person's to
/// see.
pub(crate) fn named_missing_apps(
    named: Vec<AgentMcpServer>,
    task: &serde_json::Value,
) -> Vec<AgentMcpServer> {
    let required = RoutineProgram::from_task(task)
        .map(|program| program.mcp_servers)
        .unwrap_or_default();
    missing_apps(named, &required)
}

/// `apps` as a routine may name them missing: trimmed, each slug once, never
/// one in `required`, and only ones shaped like an app (a slug of letters,
/// digits, `_` and `-`, and a name), at most [`MAX_MISSING_APPS`].
pub(crate) fn missing_apps(
    apps: Vec<AgentMcpServer>,
    required: &[AgentMcpServer],
) -> Vec<AgentMcpServer> {
    let mut kept: Vec<AgentMcpServer> = Vec::new();
    for app in apps {
        let slug = app.app_slug.trim();
        let name = app.server_name.trim();
        let shaped = !slug.is_empty()
            && slug.len() <= MAX_APP_TEXT
            && slug
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            && !name.is_empty()
            && name.chars().count() <= MAX_APP_TEXT;
        let seen = |other: &AgentMcpServer| other.app_slug == slug;
        if !shaped || required.iter().any(seen) || kept.iter().any(seen) {
            continue;
        }
        kept.push(AgentMcpServer {
            app_slug: slug.to_owned(),
            server_name: name.to_owned(),
        });
        if kept.len() == MAX_MISSING_APPS {
            break;
        }
    }
    kept
}

/// An error the routine's author can fix, as a problem to show them; any
/// other error is the check's own failure.
fn check_problem(error: anyhow::Error) -> Result<String> {
    use super::target_validation::TargetValidationError;
    use agent_session::domain::routines::RoutineSessionError;
    let theirs = match error.downcast_ref::<ActionPolicyError>() {
        Some(ActionPolicyError::NotFound | ActionPolicyError::UpdateConflict) => false,
        Some(_) => true,
        None => {
            error.downcast_ref::<TargetValidationError>().is_some()
                || matches!(
                    error.downcast_ref::<RoutineSessionError>(),
                    Some(
                        RoutineSessionError::InvalidCommand
                            | RoutineSessionError::ModelMismatch
                            | RoutineSessionError::PersonaUnavailable
                            | RoutineSessionError::Forbidden
                            | RoutineSessionError::AppNotConnected
                            | RoutineSessionError::AppsUnsupported
                    )
                )
        }
    };
    if theirs {
        Ok(error.to_string())
    } else {
        Err(error)
    }
}

/// Failing code steps by their place among `task`'s steps; the checker
/// counts code steps alone.
pub(crate) fn step_positions(
    task: &serde_json::Value,
    failing: Vec<StepProblems>,
) -> Vec<CheckedStepProblems> {
    let positions: Vec<usize> = routine_program::RoutineProgram::from_task(task)
        .map(|program| {
            program
                .steps
                .iter()
                .enumerate()
                .filter(|(_, step)| matches!(step, routine_program::Step::Code(_)))
                .map(|(index, _)| index)
                .collect()
        })
        .unwrap_or_default();
    failing
        .into_iter()
        .map(|step| CheckedStepProblems {
            index: positions.get(step.index).copied().unwrap_or(step.index),
            title: step.title,
            problems: step.problems,
        })
        .collect()
}

/// A description as stored: trimmed, and within the limit.
fn description(text: &str) -> Result<String> {
    let text = text.trim();
    if text.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(ActionPolicyError::DescriptionTooLong.into());
    }
    Ok(text.to_owned())
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
    R: SubRoutines,
    G: ScheduledActionGrants,
{
    let ids = grants
        .accessible_scheduled_action_ids(user_id)
        .await
        .map_err(|error| anyhow::anyhow!("failed to list accessible scheduled actions: {error}"))?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // Sub-routines are listed under the routine that created them.
    let mut actions = repo.top_level_by_ids(&ids).await?;
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

impl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout> ScheduledActionService
    for ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
where
    Github: GithubInstallationClaims,
    Code: RoutineCode,
    Upgrades: CodeUpgrades,
    Rollout: EventRoutineRollout,
    Rpo: ScheduledActionRepo + SubRoutines,
    Grants: ScheduledActionGrants,
    Targets: TaskTargetValidator,
    Exe: ScheduledActionExecutor + Send + Sync + 'static,
{
    async fn get_action<T: RequiredPermission>(
        &self,
        receipt: &EntityAccessReceipt<T>,
    ) -> Result<ScheduledAction> {
        self.load_granted(receipt).await
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
        // No route says who sends it, so it is taken for a program's.
        self.create(
            principal,
            input,
            None,
            EntityAppearance::default(),
            None,
            None,
            Requester::Program,
        )
        .await
    }

    #[tracing::instrument(name = "routine.create", skip_all, fields(
        routine.id = tracing::field::Empty,
        routine.parent_id = tracing::field::Empty,
        routine.created_by_run_id = tracing::field::Empty,
        routine.creating_routine_id = tracing::field::Empty,
        routine.keyed = key.is_some(),
        routine.create.outcome = tracing::field::Empty,
    ), err)]
    async fn create_action_from(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        caller: RunCaller,
        key: Option<SubRoutineKey>,
    ) -> Result<SavedAction> {
        let span = tracing::Span::current();
        if caller.requester == Requester::Program && writes_as_owner(&input.task) {
            span.record("routine.create.outcome", "refused_owner_identity");
            return Err(ActionPolicyError::OwnerIdentityNeedsPerson.into());
        }
        let saved = match self.creating_run(principal, caller).await? {
            Some(run) => {
                self.create_sub_routine(principal, input, run, key, caller.requester)
                    .await
            }
            None if key.is_some() => Err(ActionPolicyError::KeyOutsideRun.into()),
            None => self
                .create(
                    principal,
                    input,
                    None,
                    EntityAppearance::default(),
                    None,
                    None,
                    caller.requester,
                )
                .await
                .map(SavedAction::Created),
        };
        let outcome = match &saved {
            Ok(SavedAction::Created(_)) => "created",
            Ok(SavedAction::Updated(_)) => "updated",
            Err(error) => match error.downcast_ref::<ActionPolicyError>() {
                Some(ActionPolicyError::TooManySubRoutines) => "refused_cap",
                _ => "failed",
            },
        };
        span.record("routine.create.outcome", outcome);
        if let Ok(SavedAction::Created(action) | SavedAction::Updated(action)) = &saved
            && let Some(id) = action.id
        {
            span.record("routine.id", tracing::field::display(id));
        }
        saved
    }

    async fn detach_action(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<ScheduledAction> {
        let action = self.load_granted(&receipt).await?;
        self.detach(action).await
    }

    #[tracing::instrument(name = "routine.check", skip_all, fields(
        routine.check.ok = tracing::field::Empty,
        routine.check.problems = tracing::field::Empty,
        routine.check.failing_steps = tracing::field::Empty,
        routine.check.missing_apps = tracing::field::Empty,
        routine.check.draft = tracing::field::Empty,
    ), err)]
    async fn check_action(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        created: Vec<CreatedItem>,
        missing_apps: Vec<AgentMcpServer>,
        correlation: Option<Uuid>,
    ) -> Result<RoutineCheck> {
        let owner = principal.owner();
        let owner_user = owner.as_user().ok_or(OwnerNotUserError {
            owner_type: owner.owner_type(),
        })?;
        let mut check = self.check(owner_user, input).await?;
        check.missing_apps = named_missing_apps(missing_apps, &check.routine.task);
        let span = tracing::Span::current();
        span.record("routine.check.ok", check.ok);
        span.record("routine.check.problems", check.problems.len());
        span.record("routine.check.failing_steps", check.steps.len());
        span.record("routine.check.missing_apps", check.missing_apps.len());
        self.hand_back(owner_user, correlation, &check, &created)
            .await;
        Ok(check)
    }

    async fn create_action_from_template(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        template_id: Uuid,
        appearance: EntityAppearance,
        requester: Requester,
    ) -> Result<ScheduledAction> {
        self.create(
            principal,
            input,
            Some(template_id),
            appearance,
            None,
            None,
            requester,
        )
        .await
    }

    async fn create_action_from_suggestion(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        suggestion_id: Uuid,
        requester: Requester,
    ) -> Result<ScheduledAction> {
        let created = self
            .create(
                principal,
                input,
                None,
                EntityAppearance::default(),
                Some(suggestion_id),
                None,
                requester,
            )
            .await?;
        // Accepts by who suggested, kind and surface, for the suggestions
        // dashboard. A failed lookup only leaves those fields out.
        let origin = match (&self.origins, principal.owner().as_user()) {
            (Some(origins), Some(owner)) => origins
                .origin(owner, suggestion_id)
                .await
                .inspect_err(|error| tracing::warn!(error = ?error, "could not read the suggestion a routine was saved from"))
                .ok()
                .flatten(),
            _ => None,
        };
        tracing::info!(
            event = "routine_suggestions.saved",
            routine.suggestion.id = %suggestion_id,
            from = origin.map(|origin| origin.from),
            kind = origin.map(|origin| origin.kind),
            surface = origin.and_then(|origin| origin.surface),
            enabled = created.enabled,
        );
        Ok(created)
    }

    async fn get_actions(
        &self,
        user_id: MacroUserIdStr<'static>,
        include_events: bool,
        scope: ListScope,
    ) -> Result<Vec<ListedAction>> {
        let actions: Vec<ScheduledAction> = self
            .list_in(self.grants.as_ref(), &user_id, scope)
            .await?
            .into_iter()
            // Only the plain list has clients that predate event and one-time
            // triggers; the sub-routine scopes return every trigger type.
            .filter(|action| {
                include_events
                    || scope != ListScope::TopLevel
                    || matches!(action.trigger, ActionTrigger::Cron { .. })
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
        requester: Requester,
    ) -> Result<ScheduledAction> {
        let action = self.load_granted(&receipt).await?;
        let mut input = input.into_configuration(&action);
        let pick = input.appearance.take();
        if let Some(pick) = &pick {
            check_pick(pick)?;
        }
        let mut updated = self.replace_configuration(action, input, requester).await?;
        // Only an agent acting for the owner picks the look of their routine.
        let for_owner = receipt
            .acting_user_id()
            .is_some_and(|user| updated.owner.as_user() == Some(user));
        if let (Some(pick), Some(attribution), true) =
            (pick, attribution(receipt.auth()), for_owner)
        {
            updated.appearance = self.pick_appearance(&updated, pick, attribution).await?;
        }
        Ok(updated)
    }

    #[tracing::instrument(err, skip_all)]
    async fn set_appearance(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        appearance: EntityAppearance,
    ) -> Result<EntityAppearance> {
        appearance
            .validate()
            .map_err(ActionPolicyError::InvalidAppearance)?;
        let action = self.load_granted(&receipt).await?;
        let id = action.id.ok_or(ActionPolicyError::NotFound)?;
        let attribution = attribution(receipt.auth()).ok_or(ActionPolicyError::NotFound)?;
        self.repo
            .set_appearance(ChangeAppearance {
                id,
                appearance: appearance.clone(),
                chooser: AppearanceChooser::Owner,
                attribution,
                event_id: macro_uuid::generate_uuid_v7(),
                occurred_at: Utc::now(),
            })
            .await?;
        Ok(appearance)
    }

    async fn set_enabled(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        enabled: bool,
        requester: Requester,
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
            description: action.description.clone(),
            appearance: None,
        };
        self.replace_configuration(action, input, requester).await
    }

    async fn delete_action(&self, receipt: EntityAccessReceipt<OwnerAccessLevel>) -> Result<()> {
        let action = self.load_granted(&receipt).await?;
        let Some(id) = action.id else {
            bail!("cannot delete action without id");
        };
        self.delete_and_dispatch(&id, action).await
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

    #[tracing::instrument(name = "routine.stop", skip_all, err, fields(action_id = tracing::field::Empty, running = tracing::field::Empty))]
    async fn stop_run(&self, receipt: EntityAccessReceipt<OwnerAccessLevel>) -> Result<()> {
        let action = self.load_granted(&receipt).await?;
        let Some(id) = action.id else {
            bail!("cannot stop a run without an id");
        };
        let span = tracing::Span::current();
        span.record("action_id", tracing::field::display(id));
        // A routine that isn't running has nothing to stop; a stop sent again
        // after its run ended changes nothing.
        let running = self.repo.running_run(&id).await?;
        span.record("running", running.is_some());
        match running {
            Some(run) => self.stops.request(run.run_id).await,
            None => Ok(()),
        }
    }

    async fn get_execution_records(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<ListedRun>> {
        let action = self.load_granted(&receipt).await?;
        let Some(id) = action.id else {
            bail!("cannot read execution history without id");
        };
        let records = self.repo.get_execution_records(&id).await?;
        self.with_created(&action, records).await
    }

    fn catalog(&self, timezone: chrono_tz::Tz) -> Vec<super::catalog::CatalogEntry> {
        super::catalog::catalog(self.code.as_ref(), timezone)
    }

    async fn get_code_upgrades(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<CodeUpgrade>> {
        let action = self.load_granted(&receipt).await?;
        let Some(id) = action.id else {
            bail!("cannot read code upgrades without id");
        };
        self.upgrades.list_upgrades(id).await
    }

    async fn get_unusable_knobs(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<super::knob_entities::UnusableKnob>> {
        let action = self.load_granted(&receipt).await?;
        self.targets
            .unusable_knobs(&action.task, action.owner_user()?)
            .await
    }
}

/// Whether `task` is a routine whose code writes as its owner.
fn writes_as_owner(task: &serde_json::Value) -> bool {
    RoutineProgram::from_task(task)
        .is_ok_and(|program| program.code_identity() == CodeIdentity::Owner)
}

/// The source of each of `task`'s code steps, in order.
fn code_sources(task: &serde_json::Value) -> Vec<String> {
    RoutineProgram::from_task(task)
        .map(|program| {
            program
                .code_steps()
                .into_iter()
                .map(|step| step.source.clone())
                .collect()
        })
        .unwrap_or_default()
}
