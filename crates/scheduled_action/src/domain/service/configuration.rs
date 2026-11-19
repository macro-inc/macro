//! Applying and checking changes to a routine's configuration.

use super::*;
use crate::domain::{code_upgrade::UpgradeOutcome, target_validation::require_explicit_selection};

impl<Rpo: ScheduledActionRepo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
    ScheduledActionServiceImpl<Rpo, Exe, Grants, Targets, Github, Code, Upgrades, Rollout>
{
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
        // A copy made standalone keeps what Macro wrote in its parent.
        let mut written = self.rewritten_sources(id).await?;
        written.extend(self.upgrades.inherited_rewrites(id).await?);
        if next
            .code_steps()
            .into_iter()
            .any(|step| written.contains(&step.source))
        {
            return Err(ActionPolicyError::UnreviewedRewrite.into());
        }
        Ok(())
    }

    /// The sources Macro's rewrites of `id` wrote: the steps each rewrite
    /// holds whose code differs from the task it rewrote.
    pub(super) async fn rewritten_sources(
        &self,
        id: Uuid,
    ) -> Result<std::collections::HashSet<String>>
    where
        Upgrades: CodeUpgrades,
    {
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
        Ok(written)
    }

    /// Replace one routine's configuration. `with_parent` marks a
    /// sub-routine switched off because its parent was.
    pub(super) async fn replace_one(
        &self,
        action: ScheduledAction,
        input: ActionConfiguration,
        with_parent: bool,
    ) -> Result<ScheduledAction>
    where
        Targets: TaskTargetValidator,
        Github: GithubInstallationClaims,
        Code: RoutineCode,
        Upgrades: CodeUpgrades,
        Rollout: EventRoutineRollout,
    {
        match self.replacement(action, input, with_parent).await? {
            Replacement::Unchanged(action) => Ok(action),
            Replacement::Changed(action) => {
                let updated = self.repo.update_action(action).await?;
                self.dispatcher_tx
                    .send(DispatchEvent::Update(updated.clone()))
                    .await
                    .map_err(|e| anyhow::anyhow!("failed to dispatch update event: {e}"))?;
                Ok(updated)
            }
        }
    }

    /// `action` with `input` in place of its configuration, checked as
    /// every save is; nothing is written.
    pub(super) async fn replacement(
        &self,
        mut action: ScheduledAction,
        mut input: ActionConfiguration,
        with_parent: bool,
    ) -> Result<Replacement>
    where
        Targets: TaskTargetValidator,
        Github: GithubInstallationClaims,
        Code: RoutineCode,
        Upgrades: CodeUpgrades,
        Rollout: EventRoutineRollout,
    {
        require_explicit_selection(&action.task, &input.task)?;
        input.task = without_fields_beside_agent(&named_steps(&input.task));
        // Clients don't echo the SDK the stored code was checked against. A
        // stored single agent keeps fields its parser skips until its task
        // changes; sending them back, or not, changes nothing.
        if same_task(&without_fields_beside_agent(&action.task), &input.task) {
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
            // Every way a task changes needs the rollout for definitions and
            // inputs: an edit, a run's keyed create. A copy's task changes
            // only when a run schedules it again, which read the rollout
            // already, or when it is made standalone, which needs none, so
            // switching the rollout off strands no copy.
            let from_copy = SubRoutineCopy::from_task(&action.task).is_some();
            if !same_task(&action.task, &input.task) && !from_copy {
                self.check_sub_routines(&input.task, action.owner_user()?)
                    .await?;
            }
            self.validate_targets(&input.task, action.owner_user()?)
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
            return Ok(Replacement::Unchanged(action));
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
        Ok(Replacement::Changed(action))
    }
}

/// A routine as a replacement leaves it.
pub(super) enum Replacement {
    /// Nothing about it changes: it is the routine as stored.
    Unchanged(ScheduledAction),
    /// To be written, its revision already the next.
    Changed(ScheduledAction),
}
