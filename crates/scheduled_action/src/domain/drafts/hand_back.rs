//! Turn the session's final check into the requested draft.

use anyhow::Result;
use bots::domain::models::AgentMcpServer;
use routine_program::{RoutineProgram, Step};
use serde_json::Value;

use super::definitions::{checked_sub_routines, task_sub_routines};
use super::{
    CHANGE_FAILED, Draft, DraftCreated, DraftRequest, DraftedRoutine, DraftedStep, STEP_FAILED,
    StepKind, StepProblem, failed, failed_with,
};
use crate::domain::models::{ActionPolicyError, RoutineCheck};

#[cfg(test)]
mod test;

/// The owner's rollout refused the draft's sub-routines when it was checked.
const SUB_ROUTINES_OFF: &str = "Scheduling work per item isn’t available to you right now. Try again later, or describe the routine without it.";

/// The steps of a checked routine's task. A single agent task, which the
/// SDK still accepts and a draft's session sometimes checks, becomes one
/// agent step holding its prompt and user prompt, if that step passes a
/// program's rules: the editor saves the draft as steps. Its apps are the
/// draft's ([`draft_apps`]). `None` for anything else.
fn task_steps(task: &Value) -> Option<Vec<Value>> {
    if let Some(steps) = task.get("steps").and_then(Value::as_array) {
        return Some(steps.clone());
    }
    let steps = agent_task_steps(task);
    tracing::Span::current().record("routine.draft.agent_task", steps.is_some());
    steps
}

/// A single agent task as a program's one agent step, if it is one and the
/// step passes a program's rules.
fn agent_task_steps(task: &Value) -> Option<Vec<Value>> {
    let task = RoutineProgram::from_task(task).ok()?;
    let program = RoutineProgram::new(task.steps);
    program.validate().ok()?;
    program
        .steps
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .ok()
}

/// The apps a drafted routine of `steps` requires, and the ones it needs
/// that its owner hasn't connected: the apps its `check` requires or names
/// as missing, each slug once, sorted by whether its owner `connected` them
/// (as connected, by the name listed). Without that list, the ones it
/// requires stay required. None without an Ask AI step of its own, the only
/// step its apps reach: a sub-routine's runs with its definition's apps,
/// which a draft can't set.
fn draft_apps(
    steps: &[Value],
    check: &RoutineCheck,
    connected: Option<&[AgentMcpServer]>,
) -> (Vec<AgentMcpServer>, Vec<AgentMcpServer>) {
    let mut apps: Vec<AgentMcpServer> = Vec::new();
    let mut missing: Vec<AgentMcpServer> = Vec::new();
    if !steps
        .iter()
        .any(|step| step.get("type").and_then(Value::as_str) == Some("agent"))
    {
        return (apps, missing);
    }
    let required = RoutineProgram::from_task(&check.routine.task)
        .map(|program| program.mcp_servers)
        .unwrap_or_default();
    let named = required
        .into_iter()
        .map(|app| (app, true))
        .chain(check.missing_apps.iter().cloned().map(|app| (app, false)));
    for (app, is_required) in named {
        if apps
            .iter()
            .chain(&missing)
            .any(|seen| seen.app_slug == app.app_slug)
        {
            continue;
        }
        match connected.map(|connected| {
            connected
                .iter()
                .find(|listed| listed.app_slug == app.app_slug)
        }) {
            Some(Some(listed)) => apps.push(listed.clone()),
            Some(None) => missing.push(app),
            None if is_required => apps.push(app),
            None => missing.push(app),
        }
    }
    (apps, missing)
}

/// The draft `request` asks for, from the session's last check, given the
/// apps its owner `connected` when its prompt listed them. A new routine
/// defines sub-routines only when `may_define`; a step added to a routine,
/// or changed in it, was checked with the routine's own sub-routines, or its
/// code may not run with them.
pub(super) fn drafted(
    request: &DraftRequest,
    program: &[Step],
    check: RoutineCheck,
    created: Vec<DraftCreated>,
    may_define: bool,
    connected: Option<&[AgentMcpServer]>,
) -> Draft {
    let span = tracing::Span::current();
    span.record("routine.draft.code_failing", check.steps.len());
    let Some(steps) = task_steps(&check.routine.task) else {
        return failed_with(request.failed(), created);
    };
    let checked_with = task_sub_routines(&check.routine.task);
    let defines_others = match request {
        DraftRequest::Routine { .. } => !may_define && !checked_with.is_empty(),
        DraftRequest::AddStep { routine, .. } | DraftRequest::ChangeStep { routine, .. } => {
            checked_sub_routines(&checked_with) != checked_sub_routines(&routine.sub_routines)
        }
    };
    // A rollout refusal is one the session can't fix: creating the routine,
    // or saving a change to a stored routine's task that keeps sub-routines
    // or inputs, is refused the same way while it holds, so the draft isn't
    // handed back as ready.
    let rollout_off = check
        .problems
        .contains(&ActionPolicyError::SubRoutinesDisabled.to_string());
    if defines_others || rollout_off {
        span.record("routine.draft.sub_routines_refused", true);
        let message = if rollout_off {
            SUB_ROUTINES_OFF
        } else {
            request.failed()
        };
        return failed_with(message, created);
    }
    // A step drafted into a routine is one of its own steps, never one of
    // its sub-routines'.
    let problems_at = |index: usize| -> Vec<String> {
        check
            .steps
            .iter()
            .filter(|step| step.sub_routine.is_none() && step.index == index)
            .flat_map(|step| step.problems.clone())
            .collect()
    };
    match request {
        DraftRequest::Routine { .. } => {
            let sub_routines = task_sub_routines(&check.routine.task);
            span.record("routine.draft.steps", steps.len());
            span.record("routine.draft.sub_routines", sub_routines.len());
            let (apps, missing_apps) = draft_apps(&steps, &check, connected);
            span.record("routine.draft.apps", apps.len());
            Draft::Routine(DraftedRoutine {
                name: check.routine.name.trim().to_owned(),
                trigger: Some(check.routine.trigger.clone()),
                problems: check
                    .steps
                    .iter()
                    .map(|step| StepProblem {
                        sub_routine: step.sub_routine.clone(),
                        index: step.index,
                        problems: step.problems.clone(),
                    })
                    .collect(),
                steps,
                sub_routines,
                created,
                apps,
                missing_apps,
            })
        }
        DraftRequest::AddStep { kind, .. } => {
            let at = program.len();
            let Some(step) = steps.get(at).filter(|_| steps.len() == at + 1) else {
                return failed(STEP_FAILED);
            };
            let Ok(parsed) = serde_json::from_value::<Step>(step.clone()) else {
                return failed(STEP_FAILED);
            };
            let drafted_kind = match parsed {
                Step::Code(_) => StepKind::Code,
                Step::Agent(_) => StepKind::Agent,
            };
            if kind.is_some_and(|kind| kind != drafted_kind) {
                return failed(STEP_FAILED);
            }
            span.record(
                "routine.draft.step",
                match drafted_kind {
                    StepKind::Code => "code",
                    StepKind::Agent => "agent",
                },
            );
            Draft::Step(DraftedStep {
                step: step.clone(),
                reason: String::new(),
                problems: problems_at(at),
                created,
            })
        }
        DraftRequest::ChangeStep { index, .. } => {
            let (Some(Step::Code(was)), Some(step)) = (program.get(*index), steps.get(*index))
            else {
                return failed(CHANGE_FAILED);
            };
            let Ok(Step::Code(mut changed)) = serde_json::from_value::<Step>(step.clone()) else {
                return failed(CHANGE_FAILED);
            };
            // The editor and later steps know it by its output name.
            changed.id = was.id.clone();
            match serde_json::to_value(Step::Code(changed)) {
                Ok(step) => Draft::Step(DraftedStep {
                    step,
                    reason: String::new(),
                    problems: problems_at(*index),
                    created,
                }),
                Err(_) => failed(CHANGE_FAILED),
            }
        }
    }
}
