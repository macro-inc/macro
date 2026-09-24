use super::*;
use ai_billing::domain::DenyReason;

fn candidates() -> Vec<String> {
    vec![
        "https://github.com/macro-inc/macro".to_owned(),
        "https://github.com/macro-inc/infra".to_owned(),
    ]
}

#[test]
fn the_user_message_carries_candidates_recent_sessions_and_the_prompt() {
    let message = user_message("rename the button", &candidates(), &[]);
    assert!(message.contains("<candidate_repositories>\nhttps://github.com/macro-inc/macro\n"));
    assert!(message.contains("<recent_sessions>\nnone\n</recent_sessions>"));
    assert!(message.contains("<prompt>\nrename the button\n</prompt>"));
}

#[test]
fn the_schema_allows_only_the_candidates_and_null() {
    let schema = choice_schema(&candidates());
    let allowed = schema.schema["properties"]["repository"]["enum"]
        .as_array()
        .expect("an enum of allowed answers")
        .clone();
    assert_eq!(
        allowed,
        vec![
            serde_json::json!("https://github.com/macro-inc/macro"),
            serde_json::json!("https://github.com/macro-inc/infra"),
            serde_json::Value::Null,
        ]
    );
}

#[test]
fn admission_failures_keep_public_codes_and_hide_billing_details() {
    for admission in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Denied(DenyReason::OverageLimitReached),
        AiAdmissionError::Denied(DenyReason::OveragePaymentFailed),
        AiAdmissionError::Unavailable(rootcause::report!("private database failure")),
    ] {
        let expected_code = match &admission {
            AiAdmissionError::Denied(reason) => reason.code(),
            AiAdmissionError::Unavailable(_) => "ai_billing_unavailable",
        };
        let message = admission.to_string();
        let error = startup_failure(rootcause::Report::new(admission).into_dynamic());
        let refusal = error.downcast_current_context::<PromptRefusal>().unwrap();
        assert_eq!(refusal.code.as_deref(), Some(expected_code));
        assert_eq!(refusal.message, message);
        assert!(!format!("{error:?}").contains("private database failure"));
    }
}

#[test]
fn other_failures_are_not_reclassified_as_admission() {
    let error = startup_failure(rootcause::report!("repository listing unavailable"));
    assert!(error.downcast_current_context::<PromptRefusal>().is_none());
    assert!(error.to_string().contains("repository listing unavailable"));
}
