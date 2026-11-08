//! Code steps are type-checked against the SDK and the step contract
//! before a routine is saved, and the saved task records the version they
//! checked against.

use macro_user_id::user_id::MacroUserIdStr;
use routine_program::{CATALOG, CODE_STEPS, RoutineProgram, STEP_CONTEXT, Step};
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::ports::{RoutineCode, StepProblems};

#[cfg(test)]
pub(crate) mod test;

/// Problems reported per failing step, so the author gets the first ones
/// rather than a wall of cascading errors.
const MAX_PROBLEMS: usize = 10;
/// Characters kept of each reported problem.
const MAX_PROBLEM_CHARS: usize = 2_000;

/// A routine's code doesn't type-check, or can't be checked right now.
/// Messages are written for the person or model building the routine.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CodeCheckError {
    /// The type checker found problems in some steps.
    #[error("{}", describe(.steps))]
    DoesNotCheck {
        /// Each failing step, with its first problems.
        steps: Vec<StepProblems>,
    },
    /// There's no checker here, or it failed to run.
    #[error("{0}")]
    Unavailable(String),
}

fn describe(steps: &[StepProblems]) -> String {
    steps
        .iter()
        .map(|step| {
            format!(
                "code step \"{}\" doesn't type-check against Macro's SDK; fix these problems and save again:\n\n{}",
                step.title,
                step.problems.join("\n\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// `task` with every code step named, as saving stores it
/// ([`RoutineProgram::assign_step_ids`]), so validation, change detection
/// and the checker all see the same ids. Malformed programs come
/// back as they are, for target validation to report, and a single agent
/// task has no steps to name.
pub fn named_steps(task: &Value) -> Value {
    let mut named = task.clone();
    let (Ok(mut program), Value::Object(fields)) = (RoutineProgram::from_task(task), &mut named)
    else {
        return named;
    };
    if fields.contains_key("steps") {
        program.assign_step_ids();
        if let Ok(steps) = serde_json::to_value(&program.steps) {
            fields.insert("steps".into(), steps);
        }
    }
    named
}

/// `task` with an id on every code step, and its `sdk` set to the
/// version every code step now checks against. A routine's code steps are
/// checked together, each against the outputs of the steps before it, unless
/// `previous`, the task as stored, held the same code checked against the
/// same version. A task without code steps is returned without an `sdk`.
pub async fn checked_task(
    code: &impl RoutineCode,
    task: &Value,
    previous: Option<&Value>,
) -> Result<Value, CodeCheckError> {
    let mut checked = named_steps(task);
    let (Ok(program), Value::Object(fields)) = (RoutineProgram::from_task(&checked), &mut checked)
    else {
        return Ok(checked);
    };
    if !fields.contains_key("steps") {
        return Ok(checked);
    }
    if program.code_steps().is_empty() {
        fields.remove("sdk");
        return Ok(checked);
    }
    let version = code.sdk().ok_or_else(|| {
        CodeCheckError::Unavailable(
            "Code steps can't be saved here: no code executor is configured.".to_owned(),
        )
    })?;
    let unchanged = previous
        .and_then(|task| RoutineProgram::from_task(task).ok())
        .is_some_and(|stored| {
            stored.sdk.as_ref() == Some(&version) && stored.check_files() == program.check_files()
        });
    if !unchanged {
        let failing = code
            .check_program(&program)
            .await
            .map_err(|unavailable| CodeCheckError::Unavailable(unavailable.0))?;
        if !failing.is_empty() {
            return Err(CodeCheckError::DoesNotCheck {
                steps: failing.into_iter().map(bounded_step).collect(),
            });
        }
    }
    fields.insert("sdk".into(), Value::String(version.into()));
    Ok(checked)
}

/// Longest task description a guide is chosen for, in characters.
pub const MAX_TASK_CHARS: usize = 4_000;

/// How to write a code step for a described task.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeGuide {
    /// The version code is checked against: the SDK and the step contract.
    pub sdk: String,
    /// How to write a code step, the same text the routine agent tools read.
    pub steps: String,
    /// TypeScript declaring `StepContext`, what `main` receives.
    pub contract: String,
    /// The SDK's entities relevant to the task, with method signatures.
    pub reference: String,
    /// Starter routines, as worked examples of code steps.
    pub examples: Vec<StarterRoutine>,
}

/// A catalog routine whose step is code, shown to the drafter as a worked
/// example.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StarterRoutine {
    /// Names it, e.g. `inbox`.
    pub key: String,
    /// What someone asks for, with when it runs.
    pub request: String,
    /// Its steps, in the shape a routine's task holds them.
    #[schema(value_type = Vec<routine_program::Step>)]
    pub steps: Vec<Value>,
}

/// The catalog routines whose step is code; none where code can't be saved.
pub fn starters(code: &impl RoutineCode) -> Vec<StarterRoutine> {
    if code.sdk().is_none() {
        return Vec::new();
    }
    CATALOG
        .iter()
        .filter_map(|routine| {
            let step = serde_json::to_value(Step::Code(routine.code.clone()?)).ok()?;
            Some(StarterRoutine {
                key: routine.key.to_owned(),
                request: routine.request.to_owned(),
                steps: vec![step],
            })
        })
        .collect()
}

/// What type-checking a routine's code steps found.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeCheck {
    /// The version the code was checked against.
    pub sdk: String,
    /// Each code step with problems; empty when every step checks.
    pub steps: Vec<CodeStepCheck>,
}

/// A code step's problems, and what to fix them with.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeStepCheck {
    /// Which code step, counted in program order from zero.
    pub index: usize,
    /// Its title.
    pub title: String,
    /// The first problems, as the type checker reported them.
    pub problems: Vec<String>,
    /// The SDK declarations the problems name.
    pub declarations: String,
}

/// A task to write code for that is empty or too long.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("describe the code in 1 to {MAX_TASK_CHARS} characters")]
pub struct InvalidCodeTask;

/// Steps to check that don't form a routine program.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("these steps aren't a routine program: {0}")]
pub struct InvalidCodeSteps(pub String);

/// [`CodeGuide`] for `task`.
pub async fn guide(
    code: &impl RoutineCode,
    user: &MacroUserIdStr<'static>,
    task: &str,
) -> anyhow::Result<CodeGuide> {
    let task = task.trim();
    if task.is_empty() || task.chars().count() > MAX_TASK_CHARS {
        anyhow::bail!(InvalidCodeTask);
    }
    let sdk = code.sdk().ok_or_else(unavailable)?;
    let reference = code
        .reference(user, task)
        .await
        .map_err(|error| CodeCheckError::Unavailable(error.0))?;
    Ok(CodeGuide {
        sdk: sdk.into(),
        steps: CODE_STEPS.to_owned(),
        contract: STEP_CONTEXT.to_owned(),
        reference,
        examples: starters(code),
    })
}

/// [`CodeCheck`] for a routine's `steps`, as saving would check them.
pub async fn check(code: &impl RoutineCode, steps: &Value) -> anyhow::Result<CodeCheck> {
    let mut program = RoutineProgram::from_task(&serde_json::json!({ "steps": steps }))
        .map_err(|error| InvalidCodeSteps(error.to_string()))?;
    program.assign_step_ids();
    let sdk = code.sdk().ok_or_else(unavailable)?;
    let failing = if program.code_steps().is_empty() {
        Vec::new()
    } else {
        code.check_program(&program)
            .await
            .map_err(|error| CodeCheckError::Unavailable(error.0))?
    };
    let mut steps: Vec<CodeStepCheck> = failing
        .into_iter()
        .map(bounded_step)
        .map(|step| CodeStepCheck {
            declarations: code.declarations(&step.problems),
            index: step.index,
            title: step.title,
            problems: step.problems,
        })
        .collect();
    // Saving would also refuse a step whose knobs or sentence break the
    // rules, so the author gets those here too, first.
    for (index, step) in program.code_steps().into_iter().enumerate() {
        let Err(error) = step.validate() else {
            continue;
        };
        match steps.iter_mut().find(|checked| checked.index == index) {
            Some(checked) => checked.problems.insert(0, error.to_string()),
            None => steps.push(CodeStepCheck {
                index,
                title: step.title.trim().to_owned(),
                problems: vec![error.to_string()],
                declarations: String::new(),
            }),
        }
    }
    steps.sort_by_key(|step| step.index);
    Ok(CodeCheck {
        sdk: sdk.into(),
        steps,
    })
}

fn unavailable() -> CodeCheckError {
    CodeCheckError::Unavailable(
        "Code steps can't be checked here: no code executor is configured.".to_owned(),
    )
}

fn bounded_step(step: StepProblems) -> StepProblems {
    StepProblems {
        problems: step
            .problems
            .into_iter()
            .take(MAX_PROBLEMS)
            .map(
                |problem| match problem.char_indices().nth(MAX_PROBLEM_CHARS) {
                    Some((end, _)) => format!("{}…", &problem[..end]),
                    None => problem,
                },
            )
            .collect(),
        ..step
    }
}

/// Whether two stored tasks configure the same routine; the SDK they were
/// checked against is bookkeeping, not configuration.
pub fn same_task(left: &Value, right: &Value) -> bool {
    let without_sdk = |task: &Value| match task {
        Value::Object(fields) => {
            let mut fields = fields.clone();
            fields.remove("sdk");
            Value::Object(fields)
        }
        other => other.clone(),
    };
    without_sdk(left) == without_sdk(right)
}
