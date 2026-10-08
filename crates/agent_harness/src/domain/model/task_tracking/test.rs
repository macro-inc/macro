use super::*;

#[test]
fn the_workflow_follows_existing_instructions() {
    let instructions = with_task_tracking(Some("Persona.\n\nAssignment.".to_owned()));

    assert_eq!(
        instructions,
        format!(
            "Persona.\n\nAssignment.\n\n{}",
            TASK_TRACKING_INSTRUCTIONS.trim()
        )
    );
}

#[test]
fn the_workflow_stands_alone_without_other_instructions() {
    assert_eq!(with_task_tracking(None), TASK_TRACKING_INSTRUCTIONS.trim());
}

#[test]
fn the_workflow_names_the_tools_it_relies_on() {
    for tool in [
        "macro.NameSearch",
        "macro.ContentSearch",
        "macro.CreateDocument",
        "macro_internal.task_pull_requests",
        "macro_internal.link_task",
        "macro_internal.set_pull_request",
    ] {
        assert!(TASK_TRACKING_INSTRUCTIONS.contains(tool), "{tool}");
    }
}
