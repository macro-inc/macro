use super::*;

#[test]
fn batch_tools_have_valid_strict_schemas() {
    use ai_toolset::schema::generate_validated_input_schema;
    assert_eq!(
        generate_validated_input_schema::<AssignTasksToInitiative>()
            .unwrap()
            .name,
        "AssignTasksToInitiative"
    );
    assert_eq!(
        generate_validated_input_schema::<UnassignTasksFromInitiative>()
            .unwrap()
            .name,
        "UnassignTasksFromInitiative"
    );
}

#[test]
fn required_batch_rejects_empty_and_oversized_requests_and_deduplicates_in_order() {
    assert_eq!(
        required_task_batch(vec![]).unwrap_err().description,
        "provide at least one task id"
    );
    assert!(required_task_batch((0..101).map(|id| id.to_string()).collect()).is_err());
    assert_eq!(
        required_task_batch(vec!["b".into(), "a".into(), "b".into()]).unwrap(),
        vec!["b", "a"]
    );
    assert_eq!(
        required_task_batch(vec!["a".into(); 101]).unwrap(),
        vec!["a"]
    );
}

#[test]
fn task_outcome_statuses_preserve_the_wire_contract() {
    use crate::domain::models::AssignTaskStatus;
    for (domain, expected) in [
        (AssignTaskStatus::Assigned, "assigned"),
        (AssignTaskStatus::Moved, "moved"),
        (AssignTaskStatus::NotATask, "not_a_task"),
        (AssignTaskStatus::NotFound, "not_found"),
        (
            AssignTaskStatus::SkippedNoPermission,
            "skipped_no_permission",
        ),
    ] {
        assert_eq!(
            serde_json::to_value(TaskAssignmentStatus::from(domain)).unwrap(),
            expected
        );
    }
    assert_eq!(
        serde_json::to_value(TaskUnassignmentStatus::Unassigned).unwrap(),
        "unassigned"
    );
    assert_eq!(
        serde_json::to_value(TaskUnassignmentStatus::NotAssigned).unwrap(),
        "not_assigned"
    );
}

#[test]
fn invalid_name_length_is_actionable_without_exposing_internal_errors() {
    let error = failure(InitiativeError::NameTooLong { max: 100 });
    assert_eq!(
        error.description,
        "Project names must be at most 100 graphemes long"
    );
    let internal = failure(InitiativeError::Internal(rootcause::report!(
        "private database failure"
    )));
    assert_eq!(internal.description, "The project operation failed");
}
