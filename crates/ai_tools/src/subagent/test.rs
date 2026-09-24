use super::*;
use ai_billing::domain::{AiAdmissionError, DenyReason};

#[test]
fn admission_failure_remains_typed_through_tool_adapter() {
    let error = subagent_error(AiAdmissionError::Denied(DenyReason::AllowanceExhausted).into());
    assert_eq!(error.description, DenyReason::AllowanceExhausted.message());
    assert!(matches!(
        error.internal_error.downcast_ref::<AiAdmissionError>(),
        Some(AiAdmissionError::Denied(DenyReason::AllowanceExhausted))
    ));
}

#[test]
fn unavailable_failure_hides_internal_details() {
    let error = subagent_error(
        AiAdmissionError::Unavailable(rootcause::report!("private billing details")).into(),
    );
    assert_eq!(
        error.description,
        "AI billing is unavailable. Please try again."
    );
    assert!(
        error
            .internal_error
            .downcast_ref::<AiAdmissionError>()
            .is_some()
    );
}

#[test]
fn provider_failure_keeps_existing_generic_description() {
    let error = subagent_error(anyhow::anyhow!("private provider details"));
    assert_eq!(error.description, "subagent encountered an error");
}
