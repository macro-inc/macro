//! Sub-routines: a routine one of another routine's runs created follows
//! that routine. It is listed under it, paused and deleted with it, and
//! capped per parent.

use std::collections::HashMap;

use tracing::Instrument;

use super::*;
use crate::domain::models::{ActionExecutionRecord, CreatedRoutine};

impl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades>
    ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades>
where
    Rpo: ScheduledActionRepo + SubRoutines,
    Targets: TaskTargetValidator,
    Github: GithubInstallationClaims,
    Code: RoutineCode,
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
        let run = match (caller.routine, caller.correlation, &self.run_sessions) {
            (Some(routine), _, _) => self.repo.running_run(&routine).await?,
            (None, Some(correlation), Some(sessions)) => {
                match sessions.session_of(correlation).await? {
                    Some(session) => self.repo.running_run_of_session(&session).await?,
                    None => None,
                }
            }
            _ => None,
        };
        Ok(run.filter(|run| run.owner == principal.owner()))
    }

    /// Create `run`'s routine's sub-routine, or update the one its parent
    /// already has under `key`.
    pub(super) async fn create_sub_routine(
        &self,
        principal: &CreationPrincipal,
        mut input: ActionConfiguration,
        run: RunningRun,
        key: Option<SubRoutineKey>,
    ) -> Result<SavedAction> {
        // One level: a sub-routine's creations follow its own parent.
        let parent_id = run.parent_id.unwrap_or(run.routine_id);
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

        // A parent that is off keeps what its runs create or update off
        // with it.
        let parent = self
            .repo
            .get_action(&parent_id)
            .await?
            .ok_or(ActionPolicyError::NotFound)?;
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
        self.replace_one(existing, input, paused_by_parent)
            .await
            .map(SavedAction::Updated)
    }

    /// Make `parent`'s sub-routines follow it off or back on. Switching it
    /// off pauses the ones that are on; switching it on resumes only those.
    /// One sub-routine that can't follow doesn't stop the rest.
    pub(super) async fn follow_parent(&self, parent: &ScheduledAction) {
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

            for child in children {
                let follows = match (&child.sub_routine, parent.enabled) {
                    (Some(link), true) => link.paused_by_parent,
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

    /// Make a sub-routine a top-level routine.
    #[tracing::instrument(name = "routine.detach", skip_all, fields(
        routine.id = tracing::field::Empty,
        routine.parent_id = tracing::field::Empty,
    ), err)]
    pub(super) async fn detach(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let (Some(id), Some(link)) = (action.id, &action.sub_routine) else {
            return Err(ActionPolicyError::NotSubRoutine.into());
        };
        let span = tracing::Span::current();
        span.record("routine.id", tracing::field::display(id));
        span.record("routine.parent_id", tracing::field::display(link.parent_id));

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

fn lost_key(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<ActionPolicyError>(),
        Some(ActionPolicyError::UpdateConflict)
    )
}
