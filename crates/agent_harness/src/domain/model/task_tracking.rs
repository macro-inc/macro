//! The task-tracking workflow a user may opt their coding sessions into.

#[cfg(test)]
mod test;

/// Instructions that have a coding agent research prior work, link its session
/// to a Macro task, and deliver a pull request registered against that task.
pub const TASK_TRACKING_INSTRUCTIONS: &str = include_str!("task_tracking/instructions.md");

/// `instructions` with the task-tracking workflow appended after everything
/// already in them.
#[must_use]
pub fn with_task_tracking(instructions: Option<String>) -> String {
    let workflow = TASK_TRACKING_INSTRUCTIONS.trim();
    match instructions {
        Some(instructions) => format!("{instructions}\n\n{workflow}"),
        None => workflow.to_owned(),
    }
}
