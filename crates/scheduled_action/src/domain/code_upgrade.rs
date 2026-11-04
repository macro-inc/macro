//! Bring a routine's code to the SDK the executor has now, before a run uses
//! it. Code is type-checked as it is first; most SDK releases change nothing
//! it calls, and then only the recorded SDK changes. When the check fails, a
//! model rewrites the failing steps, once per routine and SDK. The rewrite is
//! checked, dry-run on this run's trigger, and saved; if any of that fails,
//! the routine is paused for its owner with the reason and the rewrite.

use anyhow::{Result, anyhow, bail};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::{RoutineProgram, SdkFingerprint};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::models::ScheduledAction;
use super::ports::{CodeRun, CodeUpgrades, RoutineCode, ScheduledActionRepo, StepProblems};

#[cfg(test)]
mod test;

/// Longest reason kept for the owner.
const MAX_REASON_CHARS: usize = 2_000;

/// One time a routine's code was brought to a new SDK.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeUpgrade {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    /// The SDK the code was checked against before; none when it never was.
    pub from_sdk: Option<String>,
    /// The SDK it was brought to.
    pub to_sdk: String,
    pub outcome: UpgradeOutcome,
    /// Why the routine needs its owner.
    pub reason: Option<String>,
    /// The task before.
    #[schema(value_type = Object)]
    pub previous_task: Value,
    /// The saved rewrite, or the rewrite that failed its checks.
    #[schema(value_type = Option<Object>)]
    pub task: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// How an upgrade went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum UpgradeOutcome {
    /// A run is rewriting the code.
    Running,
    /// The code checked as it was.
    Checked,
    /// A model's rewrite passed its checks and was saved.
    Rewritten,
    /// The routine was paused for its owner.
    NeedsUpdate,
}

/// The routine's code doesn't work with the current SDK and needs its owner.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct NeedsUpdate(pub String);

/// `program`, with its code working against the current SDK and step
/// contract: as it was, or rewritten and saved. Fails with [`NeedsUpdate`]
/// when it can't be. `context` is what the run's code receives (`run`,
/// `routine`, `trigger`); a rewrite is dry-run with it.
#[tracing::instrument(name = "routine.code_upgrade", skip_all, fields(
    action_id = %action.id.map(|id| id.to_string()).unwrap_or_default(),
    outcome = tracing::field::Empty,
))]
pub async fn current_code(
    code: &impl RoutineCode,
    upgrades: &impl CodeUpgrades,
    owner: &MacroUserIdStr<'static>,
    action: &ScheduledAction,
    mut program: RoutineProgram,
    context: &Value,
) -> Result<RoutineProgram> {
    let Some(version) = code.sdk() else {
        // Code steps fail on their own with the executor's reason.
        return Ok(program);
    };
    if program.code_steps().is_empty() || program.sdk.as_ref() == Some(&version) {
        return Ok(program);
    }
    let span = tracing::Span::current();
    let failing = code
        .check_program(&program)
        .await
        .map_err(|unavailable| anyhow!(unavailable.0))?;
    if failing.is_empty() {
        upgrades.record_checked(action, &version).await?;
        span.record("outcome", "checked");
        program.sdk = Some(version);
        return Ok(program);
    }
    if !upgrades.claim_rewrite(action, &version).await? {
        span.record("outcome", "waiting");
        bail!(NeedsUpdate(
            "This routine's code doesn't work with Macro's current SDK. It is being updated, or is waiting for review on the routine's page.".to_owned()
        ));
    }
    match rewrite(code, owner, action, program, &failing, context, &version).await {
        Ok((program, task)) => {
            upgrades.save_rewrite(action, &version, &task).await?;
            span.record("outcome", "rewritten");
            Ok(program)
        }
        Err((reason, proposal)) => {
            let reason = bounded(reason);
            upgrades
                .needs_update(action, &version, &reason, proposal.as_ref())
                .await?;
            span.record("outcome", "needs_update");
            bail!(NeedsUpdate(reason))
        }
    }
}

/// The rewritten program and the task to save, or why not and the rewrite
/// that failed, for the owner to review.
async fn rewrite(
    code: &impl RoutineCode,
    owner: &MacroUserIdStr<'static>,
    action: &ScheduledAction,
    mut program: RoutineProgram,
    failing: &[StepProblems],
    context: &Value,
    version: &SdkFingerprint,
) -> std::result::Result<(RoutineProgram, Value), (String, Option<Value>)> {
    // Each step's own view of the outputs before it, for the model.
    let outputs: Vec<String> = program
        .check_files()
        .into_iter()
        .map(|file| {
            file.source
                .lines()
                .rev()
                .find(|line| line.starts_with("type StepContext = "))
                .unwrap_or_default()
                .to_owned()
        })
        .collect();
    // Which code steps, in program order, were rewritten.
    let mut rewritten = Vec::new();
    for (index, step) in program.code_steps_mut().into_iter().enumerate() {
        let Some(failure) = failing.iter().find(|failure| failure.index == index) else {
            rewritten.push(false);
            continue;
        };
        let steps = outputs.get(index).map(String::as_str).unwrap_or_default();
        let source = code
            .rewrite(owner, step, steps, &failure.problems)
            .await
            .map_err(|reason| {
                (
                    format!(
                        "\"{}\" doesn't work with Macro's current SDK, and it couldn't be updated: {reason}",
                        step.title.trim()
                    ),
                    None,
                )
            })?;
        step.source = source;
        rewritten.push(true);
    }
    program.assign_step_ids();
    program.sdk = Some(version.clone());
    let task = task_with(&action.task, &program).map_err(|error| (error.to_string(), None))?;
    let failed = |reason: String| (reason, Some(task.clone()));
    // A rewrite keeps the step's knobs, so it must still read every one.
    if let Err(error) = program.validate() {
        return Err(failed(format!(
            "The routine's code was updated for Macro's current SDK, but the update {error}"
        )));
    }
    // Checked together: a rewrite that changes what one step returns must
    // still suit the steps that read it.
    let still = code
        .check_program(&program)
        .await
        .map_err(|unavailable| failed(unavailable.0))?;
    if let Some(step) = still.first() {
        return Err(failed(format!(
            "\"{}\" was updated for Macro's current SDK, but the update doesn't type-check:\n{}",
            step.title,
            step.problems
                .first()
                .map(String::as_str)
                .unwrap_or_default()
        )));
    }
    let mut dry = context.clone();
    if let Some(run) = dry.get_mut("run").and_then(Value::as_object_mut) {
        run.insert("dryRun".into(), Value::Bool(true));
    }
    // Only the first code step can run now: later ones read earlier steps'
    // outputs, which aren't known before the run, so the check stands for them.
    for (step, rewritten) in program.code_steps().into_iter().zip(rewritten).take(1) {
        if !rewritten {
            continue;
        }
        // The dry run shows the step works on this trigger and changes nothing.
        let outcome = code
            .run(
                owner,
                CodeRun {
                    step,
                    context: &dry,
                    steps: &json!({}),
                    dry_run: true,
                },
            )
            .await;
        if let Err(error) = outcome.result {
            return Err(failed(format!(
                "\"{}\" was updated for Macro's current SDK, but the update failed a dry run: {error}",
                step.title.trim()
            )));
        }
    }
    Ok((program, task))
}

/// `task` with `program`'s steps and recorded SDK, keeping everything else.
fn task_with(task: &Value, program: &RoutineProgram) -> Result<Value> {
    let mut task = task.clone();
    let Value::Object(fields) = &mut task else {
        bail!("a routine with code steps has an object task");
    };
    fields.insert("steps".into(), serde_json::to_value(&program.steps)?);
    fields.insert("sdk".into(), serde_json::to_value(&program.sdk)?);
    Ok(task)
}

fn bounded(reason: String) -> String {
    match reason.char_indices().nth(MAX_REASON_CHARS - 1) {
        Some((end, _)) => format!("{}…", &reason[..end]),
        None => reason,
    }
}

/// Hosts that don't record upgrades; with no executor nothing is upgraded.
pub struct NoCodeUpgrades;

impl CodeUpgrades for NoCodeUpgrades {
    async fn record_checked(&self, _: &ScheduledAction, _: &SdkFingerprint) -> Result<()> {
        Ok(())
    }

    async fn claim_rewrite(&self, _: &ScheduledAction, _: &SdkFingerprint) -> Result<bool> {
        Ok(false)
    }

    async fn save_rewrite(&self, _: &ScheduledAction, _: &SdkFingerprint, _: &Value) -> Result<()> {
        Ok(())
    }

    async fn needs_update(
        &self,
        _: &ScheduledAction,
        _: &SdkFingerprint,
        _: &str,
        _: Option<&Value>,
    ) -> Result<()> {
        Ok(())
    }

    async fn stale_routines(
        &self,
        _: &SdkFingerprint,
        _: Option<Uuid>,
        _: u16,
    ) -> Result<Vec<Uuid>> {
        Ok(Vec::new())
    }

    async fn list_upgrades(&self, _: Uuid) -> Result<Vec<CodeUpgrade>> {
        Ok(Vec::new())
    }
}

/// What a sweep's dry run of a rewrite tells the code: no trigger, now, as
/// if its owner ran it by hand.
fn sweep_context(action: &ScheduledAction, owner: &MacroUserIdStr<'static>) -> Value {
    json!({
        "run": {
            "id": macro_uuid::generate_uuid_v7(),
            "at": Utc::now(),
            "timezone": "UTC",
            "dryRun": true,
            "previous": null,
            "lastSucceededAt": null,
        },
        "routine": { "id": action.id, "name": action.name },
        "trigger": { "kind": "manual", "by": owner.as_ref() },
    })
}

/// Routines one sweep page reads.
const SWEEP_PAGE: u16 = 50;

/// What a sweep did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Sweep {
    /// Routines now on the current SDK, as they were or rewritten.
    pub upgraded: usize,
    /// Routines left for their owner or for a run already upgrading them.
    pub waiting: usize,
}

/// Bring every enabled routine whose code was checked against an older SDK
/// to the current one, so the first run after a release doesn't pay for
/// it; the run-time upgrade stays the fallback. Each routine is visited
/// once, with no trigger, so a rewrite's dry run has nothing to read.
#[tracing::instrument(name = "routine.code_sweep", skip_all, fields(
    upgraded = tracing::field::Empty,
    waiting = tracing::field::Empty,
), err)]
pub async fn sweep(
    code: &impl RoutineCode,
    upgrades: &impl CodeUpgrades,
    repo: &impl ScheduledActionRepo,
    stop: &tokio_util::sync::CancellationToken,
) -> Result<Sweep> {
    let mut done = Sweep::default();
    let Some(sdk) = code.sdk() else {
        return Ok(done);
    };
    let mut after = None;
    while !stop.is_cancelled() {
        let page = upgrades.stale_routines(&sdk, after, SWEEP_PAGE).await?;
        let Some(last) = page.last() else { break };
        after = Some(*last);
        for id in page {
            if stop.is_cancelled() {
                break;
            }
            let Some(action) = repo.get_action(&id).await? else {
                continue;
            };
            let Ok(program) = RoutineProgram::from_task(&action.task) else {
                continue;
            };
            let owner = action.owner_user()?.clone();
            let context = sweep_context(&action, &owner);
            match current_code(code, upgrades, &owner, &action, program, &context).await {
                Ok(_) => done.upgraded += 1,
                Err(error) if error.downcast_ref::<NeedsUpdate>().is_some() => done.waiting += 1,
                Err(error) => return Err(error),
            }
        }
    }
    let span = tracing::Span::current();
    span.record("upgraded", done.upgraded);
    span.record("waiting", done.waiting);
    Ok(done)
}
