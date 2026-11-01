//! Bring a routine's code to the SDK the executor has now, before a run uses
//! it. Code is type-checked as it is first; most SDK releases change nothing
//! it calls, and then only the recorded SDK changes. When the check fails, a
//! model rewrites the failing steps, once per routine and SDK. The rewrite is
//! checked, dry-run on this run's trigger, and saved; if any of that fails,
//! the routine is paused for its owner with the reason and the rewrite.

use std::collections::HashSet;

use anyhow::{Result, anyhow, bail};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::{RoutineProgram, SdkFingerprint};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::models::ScheduledAction;
use super::ports::{CodeRun, CodeUpgrades, RoutineCode};

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

/// `program`, with its code working against the current SDK: as it was, or
/// rewritten and saved. Fails with [`NeedsUpdate`] when it can't be.
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
    trigger: Option<&Value>,
) -> Result<RoutineProgram> {
    let Some(sdk) = code.sdk() else {
        // Code steps fail on their own with the executor's reason.
        return Ok(program);
    };
    if program.code_steps().is_empty() || program.sdk.as_ref() == Some(&sdk) {
        return Ok(program);
    }
    let span = tracing::Span::current();
    let mut failing: Vec<(String, Vec<String>)> = Vec::new();
    let mut seen = HashSet::new();
    for step in program.code_steps() {
        if !seen.insert(step.source.clone()) {
            continue;
        }
        let problems = code
            .check(&step.source)
            .await
            .map_err(|unavailable| anyhow!(unavailable.0))?;
        if !problems.is_empty() {
            failing.push((step.source.clone(), problems));
        }
    }
    if failing.is_empty() {
        upgrades.record_checked(action, &sdk).await?;
        span.record("outcome", "checked");
        program.sdk = Some(sdk);
        return Ok(program);
    }
    if !upgrades.claim_rewrite(action, &sdk).await? {
        span.record("outcome", "waiting");
        bail!(NeedsUpdate(
            "This routine's code doesn't work with Macro's current SDK. It is being updated, or is waiting for review on the routine's page.".to_owned()
        ));
    }
    match rewrite(code, owner, action, program, &failing, trigger, &sdk).await {
        Ok((program, task)) => {
            upgrades.save_rewrite(action, &sdk, &task).await?;
            span.record("outcome", "rewritten");
            Ok(program)
        }
        Err((reason, proposal)) => {
            let reason = bounded(reason);
            upgrades
                .needs_update(action, &sdk, &reason, proposal.as_ref())
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
    failing: &[(String, Vec<String>)],
    trigger: Option<&Value>,
    sdk: &SdkFingerprint,
) -> std::result::Result<(RoutineProgram, Value), (String, Option<Value>)> {
    // Which code steps, in program order, were rewritten.
    let mut rewritten = Vec::new();
    for step in program.code_steps_mut() {
        let Some((_, problems)) = failing.iter().find(|(source, _)| *source == step.source) else {
            rewritten.push(false);
            continue;
        };
        let source = code.rewrite(owner, step, problems).await.map_err(|reason| {
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
    program.sdk = Some(sdk.clone());
    let task = task_with(&action.task, &program).map_err(|error| (error.to_string(), None))?;
    let failed = |reason: String| (reason, Some(task.clone()));
    for (step, rewritten) in program.code_steps().into_iter().zip(rewritten) {
        if !rewritten {
            continue;
        }
        let problems = code
            .check(&step.source)
            .await
            .map_err(|unavailable| failed(unavailable.0))?;
        if let Some(problem) = problems.first() {
            return Err(failed(format!(
                "\"{}\" was updated for Macro's current SDK, but the update doesn't type-check:\n{problem}",
                step.title.trim()
            )));
        }
        // Earlier steps' outputs aren't known before the run; the dry run
        // shows the step works on this trigger and changes nothing.
        let outcome = code
            .run(
                owner,
                CodeRun {
                    step,
                    trigger,
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

    async fn list_upgrades(&self, _: Uuid) -> Result<Vec<CodeUpgrade>> {
        Ok(Vec::new())
    }
}
