//! Code steps are type-checked against the SDK before a routine is saved,
//! and the saved task records the SDK they checked against.

use std::collections::HashSet;

use routine_program::RoutineProgram;
use serde_json::Value;

use super::ports::RoutineCode;

#[cfg(test)]
mod test;

/// Problems reported per failing step, so the author gets the first ones
/// rather than a wall of cascading errors.
const MAX_PROBLEMS: usize = 10;
/// Characters kept of each reported problem.
const MAX_PROBLEM_CHARS: usize = 2_000;

/// A routine's code doesn't type-check, or can't be checked right now.
/// Messages are written for the person or model building the routine.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CodeCheckError {
    /// The type checker found problems in a step.
    #[error(
        "code step \"{step}\" doesn't type-check against Macro's SDK; fix these problems and save again:\n\n{}",
        .problems.join("\n\n")
    )]
    DoesNotCheck {
        /// The step's title.
        step: String,
        /// The first problems, as the type checker reported them.
        problems: Vec<String>,
    },
    /// There's no checker here, or it failed to run.
    #[error("{0}")]
    Unavailable(String),
}

/// `task` with its `sdk` set to the SDK every code step now checks against.
/// Each step's source is checked unless `previous`, the task as stored,
/// already held the same source checked against the same SDK. A task
/// without code steps is returned without an `sdk`.
pub async fn checked_task(
    code: &impl RoutineCode,
    task: &Value,
    previous: Option<&Value>,
) -> Result<Value, CodeCheckError> {
    let mut checked = task.clone();
    // Malformed programs are reported by target validation.
    let Ok(program) = RoutineProgram::from_task(task) else {
        return Ok(checked);
    };
    let steps = program.code_steps();
    if steps.is_empty() {
        if let Value::Object(fields) = &mut checked {
            fields.remove("sdk");
        }
        return Ok(checked);
    }
    let sdk = code.sdk().ok_or_else(|| {
        CodeCheckError::Unavailable(
            "Code steps can't be saved here: no code executor is configured.".to_owned(),
        )
    })?;
    let mut done: HashSet<&str> = HashSet::new();
    let stored = previous.and_then(|task| RoutineProgram::from_task(task).ok());
    if let Some(stored) = &stored
        && stored.sdk.as_ref() == Some(&sdk)
    {
        done.extend(stored.code_steps().iter().map(|step| step.source.as_str()));
    }
    for step in steps {
        if !done.insert(step.source.as_str()) {
            continue;
        }
        let problems = code
            .check(&step.source)
            .await
            .map_err(|unavailable| CodeCheckError::Unavailable(unavailable.0))?;
        if !problems.is_empty() {
            return Err(CodeCheckError::DoesNotCheck {
                step: step.title.trim().to_owned(),
                problems: problems
                    .into_iter()
                    .take(MAX_PROBLEMS)
                    .map(
                        |problem| match problem.char_indices().nth(MAX_PROBLEM_CHARS) {
                            Some((end, _)) => format!("{}…", &problem[..end]),
                            None => problem,
                        },
                    )
                    .collect(),
            });
        }
    }
    if let Value::Object(fields) = &mut checked {
        fields.insert("sdk".into(), Value::String(sdk.into()));
    }
    Ok(checked)
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
