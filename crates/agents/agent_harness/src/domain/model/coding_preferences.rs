//! The workflows a user's coding preferences add to new coding sessions.

use agent_session::domain::coding_preferences::CodingPreferences;

#[cfg(test)]
mod test;

/// Research prior work, then link the session to a Macro task.
pub const CREATE_TASKS_INSTRUCTIONS: &str = include_str!("coding_preferences/create_tasks.md");

/// Deliver the work as a pull request registered with the session.
pub const OPEN_PULL_REQUESTS_INSTRUCTIONS: &str =
    include_str!("coding_preferences/open_pull_requests.md");

/// `instructions` followed by each enabled preference's workflow: tasks
/// first, then pull requests.
#[must_use]
pub fn with_coding_preferences(
    instructions: Option<String>,
    preferences: CodingPreferences,
) -> Option<String> {
    let CodingPreferences {
        create_tasks,
        open_pull_requests,
    } = preferences;
    let workflows = [
        (create_tasks, CREATE_TASKS_INSTRUCTIONS),
        (open_pull_requests, OPEN_PULL_REQUESTS_INSTRUCTIONS),
    ]
    .into_iter()
    .filter(|(enabled, _)| *enabled)
    .map(|(_, workflow)| workflow.trim());
    let sections: Vec<&str> = instructions
        .as_deref()
        .into_iter()
        .chain(workflows)
        .collect();
    (!sections.is_empty()).then(|| sections.join("\n\n"))
}
