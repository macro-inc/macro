//! Sub-routines: a routine one of another routine's runs created follows
//! that routine. It is listed under it, paused and deleted with it, and
//! capped per parent.

use std::collections::HashMap;

use tracing::Instrument;

use routine_program::{CopyError, SubRoutineName};

use super::configuration::Replacement;
use super::*;
use crate::domain::models::{ActionExecutionRecord, CreatedRoutine, ScheduleSubRoutine};
use crate::domain::target_validation::defines_steps;

impl<Rpo: ScheduledActionRepo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
    ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
{
    /// A task that defines sub-routines, holds inputs or is a copy needs the
    /// owner's rollout; a flag that cannot be read counts as off.
    pub(super) async fn check_sub_routines(
        &self,
        task: &serde_json::Value,
        owner: &MacroUserIdStr<'_>,
    ) -> Result<()>
    where
        Rollout: EventRoutineRollout,
    {
        let uses = |field: &str| {
            task.get(field)
                .and_then(serde_json::Value::as_array)
                .is_some_and(|items| !items.is_empty())
        };
        if !uses("sub_routines") && !uses("inputs") && SubRoutineCopy::from_task(task).is_none() {
            return Ok(());
        }
        let enabled = self
            .rollout
            .sub_routines_enabled_for(owner)
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, "feature flags unavailable; sub-routines stay off");
            })
            .unwrap_or(false);
        if !enabled {
            return Err(ActionPolicyError::SubRoutinesDisabled.into());
        }
        Ok(())
    }

    /// The program a sub-routine's copy runs, read from its parent now;
    /// `None` when `task` isn't a copy's.
    pub(super) async fn copy_program(
        &self,
        task: &serde_json::Value,
        parent_id: Option<Uuid>,
    ) -> Result<Option<RoutineProgram>> {
        let Some(copy) = SubRoutineCopy::from_task(task) else {
            return Ok(None);
        };
        let parent_id = parent_id.ok_or(ActionPolicyError::CopyOutsideRun)?;
        let parent = self
            .repo
            .get_action(&parent_id)
            .await?
            .ok_or(ActionPolicyError::NotFound)?;
        let program = RoutineProgram::from_task(&parent.task)
            .map_err(|_| ActionPolicyError::UnknownSubRoutine)?
            .copy_program(&copy)
            .map_err(|error| match error {
                CopyError::UnknownSubRoutine(_) => ActionPolicyError::UnknownSubRoutine,
                CopyError::Inputs(error) => ActionPolicyError::SubRoutineInputs(error.to_string()),
            })?;
        Ok(Some(program))
    }

    /// Authorize `task`'s agents and apps for `owner`. A copy's are its
    /// definition's, authorized whenever its parent is saved and on every
    /// run, so not again for each copy.
    pub(super) async fn validate_targets(
        &self,
        task: &serde_json::Value,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<()>
    where
        Targets: TaskTargetValidator,
    {
        if SubRoutineCopy::from_task(task).is_some() {
            return Ok(());
        }
        self.targets.validate_task(task, owner).await
    }
}

impl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
    ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
where
    Rpo: ScheduledActionRepo + SubRoutines,
    Targets: TaskTargetValidator,
    Github: GithubInstallationClaims,
    Code: RoutineCode,
    Upgrades: CodeUpgrades,
    Rollout: EventRoutineRollout,
{
    /// The routine run in progress that a create comes from, when its
    /// credential proves one: a code step's token is signed for its routine,
    /// and an Ask AI step's session is the one its run opened. Only a run of
    /// the creator's own routine counts.
    pub(super) async fn creating_run(
        &self,
        principal: &CreationPrincipal,
        caller: RunCaller,
    ) -> Result<Option<RunningRun>> {
        let run = match (caller.routine, caller.session) {
            (Some(routine), _) => self.repo.running_run(&routine).await?,
            (None, Some(session)) => self.repo.running_run_of_session(&session).await?,
            (None, None) => None,
        };
        Ok(run.filter(|run| run.owner == principal.owner()))
    }

    /// Create `run`'s routine's sub-routine, or update the one its parent
    /// already has under `key`.
    pub(super) async fn create_sub_routine(
        &self,
        principal: &CreationPrincipal,
        input: ActionConfiguration,
        run: RunningRun,
        key: Option<SubRoutineKey>,
        requester: Requester,
    ) -> Result<SavedAction> {
        // One level: a sub-routine's creations follow its own parent.
        let parent_id = run.parent_id.unwrap_or(run.routine_id);
        record_run(&run, parent_id);
        let parent = self
            .repo
            .get_action(&parent_id)
            .await?
            .ok_or(ActionPolicyError::NotFound)?;
        self.create_under(principal, input, run, &parent, key, requester)
            .await
    }

    /// Create `run`'s sub-routine under `parent`, the top-level routine
    /// it follows, or update the one `parent` already has under `key`.
    async fn create_under(
        &self,
        principal: &CreationPrincipal,
        mut input: ActionConfiguration,
        run: RunningRun,
        parent: &ScheduledAction,
        key: Option<SubRoutineKey>,
        requester: Requester,
    ) -> Result<SavedAction> {
        let parent_id = parent.id.ok_or(ActionPolicyError::NotFound)?;

        // A parent that is off keeps what its runs create or update off
        // with it.
        let paused_by_parent = input.enabled && !parent.enabled;
        if paused_by_parent {
            input.enabled = false;
        }

        if let Some(key) = &key
            && let Some(existing) = self.repo.child_by_key(&parent_id, key).await?
        {
            return self.update_keyed(existing, input, paused_by_parent).await;
        }
        let link = SubRoutine {
            parent_id,
            created_by_run_id: run.run_id,
            key: key.clone(),
            paused_by_parent,
        };
        let created = self
            .create(
                principal,
                input.clone(),
                None,
                EntityAppearance::default(),
                None,
                Some(link),
                requester,
            )
            .await;

        match (created, &key) {
            (Ok(created), _) => Ok(SavedAction::Created(created)),
            // Another create took the key first: update what it made.
            (Err(error), Some(key)) if lost_key(&error) => {
                let existing = self
                    .repo
                    .child_by_key(&parent_id, key)
                    .await?
                    .ok_or(error)?;
                self.update_keyed(existing, input, paused_by_parent).await
            }
            (Err(error), _) => Err(error),
        }
    }

    async fn update_keyed(
        &self,
        existing: ScheduledAction,
        input: ActionConfiguration,
        paused_by_parent: bool,
    ) -> Result<SavedAction> {
        // A key names a copy or a routine with steps of its own, and stays
        // one: scheduling again updates a copy's trigger and inputs.
        if SubRoutineCopy::from_task(&existing.task).is_some()
            != SubRoutineCopy::from_task(&input.task).is_some()
        {
            return Err(ActionPolicyError::CopyTaskFixed.into());
        }
        if defines_sub_routines(&input.task) {
            return Err(ActionPolicyError::NestedSubRoutines.into());
        }
        self.replace_one(existing, input, paused_by_parent)
            .await
            .map(SavedAction::Updated)
    }

    /// Schedule a copy of one of the sub-routines the routine `caller` is
    /// running defines: its parent's, when that routine is a copy itself.
    pub(super) async fn schedule(
        &self,
        principal: &CreationPrincipal,
        request: ScheduleSubRoutine,
        caller: RunCaller,
    ) -> Result<SavedAction> {
        let run = self
            .creating_run(principal, caller)
            .await?
            .ok_or(ActionPolicyError::ScheduleOutsideRun)?;
        // Before anything can refuse it, so every refusal names the run.
        let parent_id = run.parent_id.unwrap_or(run.routine_id);
        record_run(&run, parent_id);
        let key = request.key.as_deref().map(SubRoutineKey::new).transpose()?;
        // Postgres can't store a NUL, and its refusal would quote the text
        // into a logged error. A trigger's filters hold the caller's text.
        let trigger_nul = serde_json::to_value(&request.trigger)
            .is_ok_and(|trigger| routine_program::holds_nul(&trigger));
        if trigger_nul
            || request
                .name
                .as_deref()
                .is_some_and(|name| name.contains('\0'))
        {
            return Err(ActionPolicyError::ScheduledTextNul.into());
        }
        // The caller's text is never repeated back: it could be anything.
        let name = SubRoutineName::try_from(request.sub_routine.clone())
            .map_err(|_| ActionPolicyError::InvalidSubRoutineName)?;
        let parent = self
            .repo
            .get_action(&parent_id)
            .await?
            .ok_or(ActionPolicyError::NotFound)?;
        let unknown = || ActionPolicyError::UnknownSubRoutine;
        let program = RoutineProgram::from_task(&parent.task).map_err(|_| unknown())?;
        let definition = program.sub_routine(&name).ok_or_else(unknown)?;
        definition
            .given(&request.inputs)
            .map_err(|error| ActionPolicyError::SubRoutineInputs(error.to_string()))?;
        let copy = SubRoutineCopy {
            sub_routine: definition.name.clone(),
            inputs: request.inputs,
        };
        // Whether it makes a copy or moves the one under its key, even to
        // the same inputs: with the rollout off, runs schedule nothing.
        let owner = parent.owner_user()?;
        self.check_sub_routines(&copy.task(), owner).await?;
        let input = ActionConfiguration {
            name: request
                .name
                .map(|name| name.trim().to_owned())
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| definition.title.clone()),
            trigger: request.trigger,
            kind: parent.kind.clone(),
            task: copy.task(),
            enabled: true,
            run_visibility: parent.run_visibility,
            description: String::new(),
        };
        self.create_under(principal, input, run, &parent, key, caller.requester)
            .await
    }

    /// Make `parent`'s sub-routines follow it off or back on. Switching it
    /// off pauses the ones that are on; switching it on resumes only those.
    /// One sub-routine that can't follow doesn't stop the rest.
    /// A program switching the parent on leaves the sub-routines that write as
    /// their owner off: only a person switches those on.
    pub(super) async fn follow_parent(&self, parent: &ScheduledAction, requester: Requester) {
        let Some(parent_id) = parent.id else {
            return;
        };
        let span = tracing::info_span!(
            "routine.follow_parent",
            routine.parent_id = %parent_id,
            routine.enabled = parent.enabled,
            routine.sub_routines = tracing::field::Empty,
            routine.sub_routines.changed = tracing::field::Empty,
            routine.sub_routines.failed = tracing::field::Empty,
        );
        async {
            let children = match self.repo.active_children(&[parent_id]).await {
                Ok(children) => children,
                Err(error) => {
                    tracing::warn!(?error, "could not read a routine's sub-routines");
                    return;
                }
            };
            let (mut changed, mut failed) = (0u32, 0u32);
            let total = children.len();

            // A copy never writes as its owner (`RoutineProgram::copy_program`).
            for child in children {
                let child_writes_as_owner = writes_as_owner(&child.task);
                let follows = match (&child.sub_routine, parent.enabled) {
                    (Some(link), true) => {
                        link.paused_by_parent
                            && (requester == Requester::Person || !child_writes_as_owner)
                    }
                    (Some(_), false) => child.enabled,
                    (None, _) => false,
                };
                if !follows {
                    continue;
                }
                let input = ActionConfiguration {
                    name: child.name.clone(),
                    trigger: child.trigger.clone(),
                    kind: child.kind.clone(),
                    task: child.task.clone(),
                    enabled: parent.enabled,
                    run_visibility: child.run_visibility,
                    description: child.description.clone(),
                };
                let child_id = child.id;
                match self.replace_one(child, input, true).await {
                    Ok(_) => changed += 1,
                    Err(error) => {
                        failed += 1;
                        tracing::warn!(
                            ?error,
                            ?child_id,
                            "a sub-routine could not follow its parent"
                        );
                    }
                }
            }
            let span = tracing::Span::current();
            span.record("routine.sub_routines", total);
            span.record("routine.sub_routines.changed", changed);
            span.record("routine.sub_routines.failed", failed);
        }
        .instrument(span)
        .await
    }

    /// `user`'s routines within `scope`, each scope bounded: finished
    /// one-time sub-routines accumulate, so only one parent's list reads
    /// them, and only its newest.
    pub(super) async fn list_in<G: ScheduledActionGrants>(
        &self,
        grants: &G,
        user: &MacroUserIdStr<'static>,
        scope: ListScope,
    ) -> Result<Vec<ScheduledAction>> {
        if let ListScope::ChildrenOf(parent) = scope {
            let mut children = self.repo.children(&parent).await?;
            children.retain(|action| action.owner.is_user(user));
            return Ok(children);
        }
        let mut actions = list_accessible_actions(self.repo.as_ref(), grants, user).await?;

        if scope == ListScope::WithChildren {
            let parents: Vec<Uuid> = actions.iter().filter_map(|action| action.id).collect();
            let mut children = self.repo.active_children(&parents).await?;
            children.retain(|action| action.owner.is_user(user));
            actions.append(&mut children);
        }
        Ok(actions)
    }

    /// Make a sub-routine a top-level routine. A copy first gets its
    /// definition's steps as its parent holds them now, with its inputs'
    /// values: what its next run would have done.
    #[tracing::instrument(name = "routine.detach", skip_all, fields(
        routine.id = tracing::field::Empty,
        routine.parent_id = tracing::field::Empty,
        routine.copy = tracing::field::Empty,
    ), err)]
    pub(super) async fn detach(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let (Some(id), Some(link)) = (action.id, &action.sub_routine) else {
            return Err(ActionPolicyError::NotSubRoutine.into());
        };
        let span = tracing::Span::current();
        span.record("routine.id", tracing::field::display(id));
        span.record("routine.parent_id", tracing::field::display(link.parent_id));

        let parent_id = link.parent_id;
        let program = self.copy_program(&action.task, Some(parent_id)).await?;
        span.record("routine.copy", program.is_some());
        if let Some(program) = program {
            let input = ActionConfiguration {
                name: action.name.clone(),
                trigger: action.trigger.clone(),
                kind: action.kind.clone(),
                task: serde_json::to_value(&program)?,
                enabled: action.enabled,
                run_visibility: action.run_visibility,
                description: action.description.clone(),
            };
            // Checked like any edit, then written and detached at once, so a
            // failure leaves it a copy. It keeps the code Macro wrote in its
            // parent, so that code can't write as its owner before they
            // change it.
            if let Replacement::Changed(action) = self.replacement(action, input, false).await? {
                let sources = code_sources(&action.task);
                // A copy without code keeps nothing, so its parent's
                // upgrades aren't read.
                let mut rewritten: Vec<String> = if sources.is_empty() {
                    Vec::new()
                } else {
                    let mut written = self.rewritten_sources(parent_id).await?;
                    written.extend(self.upgrades.inherited_rewrites(parent_id).await?);
                    sources
                        .into_iter()
                        .filter(|source| written.contains(source))
                        .collect()
                };
                rewritten.sort();
                rewritten.dedup();
                // Reserved before the write, as delete does: a stopped
                // dispatcher fails the request with the copy still a copy,
                // so a retry detaches it rather than finding it top-level.
                let permit = self.dispatcher_tx.reserve().await?;
                let detached = self
                    .repo
                    .detach_copy(action, &parent_id, &rewritten)
                    .await?;
                permit.send(DispatchEvent::Update(detached.clone()));
                return Ok(detached);
            }
        }

        // Detached by another request meanwhile: it is top-level already.
        match self.repo.detach(&id).await? {
            Some(detached) => Ok(detached),
            None => self
                .repo
                .get_action(&id)
                .await?
                .ok_or_else(|| ActionPolicyError::NotFound.into()),
        }
    }

    /// `action`'s runs, each with the routines it created that still follow
    /// `action` or its parent.
    pub(super) async fn with_created(
        &self,
        action: &ScheduledAction,
        records: Vec<ActionExecutionRecord>,
    ) -> Result<Vec<ListedRun>> {
        let runs: Vec<Uuid> = records.iter().filter_map(|record| record.id).collect();
        let mut created: HashMap<Uuid, Vec<CreatedRoutine>> = HashMap::new();
        let parent = action.parent_id().or(action.id);

        if let (Some(parent), false) = (parent, runs.is_empty()) {
            for (run, routine) in self.repo.created_by_runs(&parent, &runs).await? {
                created.entry(run).or_default().push(routine);
            }
        }
        Ok(records
            .into_iter()
            .map(|record| ListedRun {
                created: record
                    .id
                    .and_then(|id| created.remove(&id))
                    .unwrap_or_default(),
                record,
            })
            .collect())
    }
}

/// Whether `task` defines sub-routines. A single agent task's stray
/// `sub_routines` define none: its parser skips them, and a save drops them.
pub(super) fn defines_sub_routines(task: &serde_json::Value) -> bool {
    defines_steps(task)
        && task
            .get("sub_routines")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|definitions| !definitions.is_empty())
}

/// Name the run a create comes from on the request's span, before anything
/// can refuse it.
fn record_run(run: &RunningRun, parent_id: Uuid) {
    let span = tracing::Span::current();
    span.record("routine.parent_id", tracing::field::display(parent_id));
    span.record(
        "routine.created_by_run_id",
        tracing::field::display(run.run_id),
    );
    span.record(
        "routine.creating_routine_id",
        tracing::field::display(run.routine_id),
    );
}

fn lost_key(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<ActionPolicyError>(),
        Some(ActionPolicyError::UpdateConflict)
    )
}
