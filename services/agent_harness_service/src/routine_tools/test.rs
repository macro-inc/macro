use ai_toolset::ToolCallError;
use serde_json::json;

use super::*;

#[test]
fn completed_outputs_are_returned_until_they_are_too_large() {
    let small = json!({ "documentId": "doc" });
    assert_eq!(
        outcome("CreateDocument", Ok(Ok(small.clone()))),
        RoutineToolOutcome::Completed { output: small }
    );
    let large = json!({ "content": "x".repeat(MAX_OUTPUT_BYTES) });
    assert_eq!(
        outcome("CreateDocument", Ok(Ok(large))),
        RoutineToolOutcome::Completed {
            output: Value::Null
        }
    );
}

#[test]
fn tool_refusals_and_bad_arguments_become_bounded_messages() {
    let refusal = ToolCallError {
        description: "y".repeat(MAX_MESSAGE_CHARS + 10),
        internal_error: anyhow::anyhow!("internal detail"),
    };
    let RoutineToolOutcome::Failed { message } = outcome("UpdateThreadLabels", Ok(Err(refusal)))
    else {
        panic!("expected a failure");
    };
    assert_eq!(message.chars().count(), MAX_MESSAGE_CHARS + 1);
    assert!(!message.contains("internal detail"));

    let error = serde_json::from_value::<bool>(json!("nope")).unwrap_err();
    let RoutineToolOutcome::Failed { message } = outcome(
        "UpdateThreadLabels",
        Err(ToolSetError::Deserialization(error)),
    ) else {
        panic!("expected a failure");
    };
    assert!(message.starts_with("The arguments don't match UpdateThreadLabels"));
    assert_eq!(
        outcome("Nope", Err(ToolSetError::NotFound("Nope".into()))),
        RoutineToolOutcome::Failed {
            message: "Nope isn't available.".into()
        }
    );
}
