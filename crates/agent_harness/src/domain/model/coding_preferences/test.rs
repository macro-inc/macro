use super::*;

const TASKS: CodingPreferences = CodingPreferences {
    create_tasks: true,
    open_pull_requests: false,
};
const PULL_REQUESTS: CodingPreferences = CodingPreferences {
    create_tasks: false,
    open_pull_requests: true,
};
const BOTH: CodingPreferences = CodingPreferences {
    create_tasks: true,
    open_pull_requests: true,
};

fn tasks() -> &'static str {
    CREATE_TASKS_INSTRUCTIONS.trim()
}

fn pull_requests() -> &'static str {
    OPEN_PULL_REQUESTS_INSTRUCTIONS.trim()
}

#[test]
fn no_preferences_leave_instructions_unchanged() {
    assert_eq!(
        with_coding_preferences(Some("Persona.".to_owned()), CodingPreferences::default()),
        Some("Persona.".to_owned())
    );
    assert_eq!(
        with_coding_preferences(None, CodingPreferences::default()),
        None
    );
}

#[test]
fn tasks_alone_follow_existing_instructions() {
    assert_eq!(
        with_coding_preferences(Some("Persona.\n\nAssignment.".to_owned()), TASKS),
        Some(format!("Persona.\n\nAssignment.\n\n{}", tasks()))
    );
}

#[test]
fn pull_requests_alone_stand_without_other_instructions() {
    assert_eq!(
        with_coding_preferences(None, PULL_REQUESTS),
        Some(pull_requests().to_owned())
    );
}

#[test]
fn both_put_tasks_before_pull_requests() {
    assert_eq!(
        with_coding_preferences(Some("Persona.".to_owned()), BOTH),
        Some(format!("Persona.\n\n{}\n\n{}", tasks(), pull_requests()))
    );
}

#[test]
fn tasks_name_the_tools_they_rely_on() {
    for tool in [
        "macro.NameSearch",
        "macro.ContentSearch",
        "macro.CreateDocument",
        "macro_internal.task_pull_requests",
        "macro_internal.link_task",
    ] {
        assert!(CREATE_TASKS_INSTRUCTIONS.contains(tool), "{tool}");
    }
}

#[test]
fn tasks_put_their_reference_in_any_pull_request() {
    assert!(CREATE_TASKS_INSTRUCTIONS.contains(
        "When you open a pull request, put the task reference link_task returns in its description."
    ));
}

#[test]
fn pull_requests_are_registered_with_the_session() {
    assert!(OPEN_PULL_REQUESTS_INSTRUCTIONS.contains("macro_internal.set_pull_request"));
}
