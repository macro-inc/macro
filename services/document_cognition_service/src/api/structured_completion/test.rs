use super::*;

#[test]
fn completion_failure_retains_committed_activity() {
    let response = partial_completion_or_error(
        vec![StructuredToolActivity {
            name: "AddColumn".into(),
            success: true,
            changes_applied: None,
        }],
        StructuredCompletionError {
            error: "provider interrupted".into(),
            status: StatusCode::BAD_GATEWAY,
        },
        true,
    )
    .unwrap()
    .0;
    assert_eq!(response.tool_activity.len(), 1);
    assert_eq!(response.result["answerable"], false);
    assert_eq!(response.result["sql"], "");
    assert!(
        response.result["explanation"]
            .as_str()
            .unwrap()
            .contains("changes were saved")
    );
}

#[test]
fn completion_failure_without_changes_preserves_error_status() {
    let error = partial_completion_or_error(
        vec![StructuredToolActivity {
            name: "QueryDatabase".into(),
            success: true,
            changes_applied: Some(0),
        }],
        StructuredCompletionError {
            error: "provider interrupted".into(),
            status: StatusCode::BAD_GATEWAY,
        },
        true,
    )
    .unwrap_err();
    assert_eq!(error.status, StatusCode::BAD_GATEWAY);
    assert_eq!(error.error, "provider interrupted");
}

#[test]
fn unrelated_completion_schemas_are_not_replaced_with_database_answers() {
    let error = partial_completion_or_error(
        vec![StructuredToolActivity {
            name: "CreateTable".into(),
            success: true,
            changes_applied: None,
        }],
        StructuredCompletionError {
            error: "provider interrupted".into(),
            status: StatusCode::BAD_GATEWAY,
        },
        false,
    )
    .unwrap_err();
    assert_eq!(error.status, StatusCode::BAD_GATEWAY);
}
