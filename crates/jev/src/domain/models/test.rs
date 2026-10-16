use super::*;

#[test]
fn questions_are_trimmed() {
    let question = YesNoQuestion::try_from("  Is this an invoice?\n").unwrap();
    assert_eq!(question.as_str(), "Is this an invoice?");
}

#[test]
fn blank_questions_are_rejected() {
    assert_eq!(YesNoQuestion::try_from(" \t "), Err(QuestionError::Empty));
}

#[test]
fn question_length_counts_characters_not_bytes() {
    let longest = "é".repeat(MAX_QUESTION_CHARS);
    assert!(YesNoQuestion::try_from(longest.as_str()).is_ok());
    let too_long = "é".repeat(MAX_QUESTION_CHARS + 1);
    assert_eq!(
        YesNoQuestion::try_from(too_long.as_str()),
        Err(QuestionError::TooLong)
    );
}

#[test]
fn questions_deserialize_through_validation() {
    let question: YesNoQuestion = serde_json::from_str(r#"" Urgent? ""#).unwrap();
    assert_eq!(question.as_str(), "Urgent?");
    assert!(serde_json::from_str::<YesNoQuestion>(r#""""#).is_err());
}

#[test]
fn probabilities_must_be_finite_and_between_zero_and_one() {
    assert_eq!(Probability::new(0.0).map(Probability::get), Some(0.0));
    assert_eq!(Probability::new(1.0).map(Probability::get), Some(1.0));
    assert!(Probability::new(-0.01).is_none());
    assert!(Probability::new(1.01).is_none());
    assert!(Probability::new(f32::NAN).is_none());
    assert!(Probability::new(f32::INFINITY).is_none());
}

#[test]
fn only_unavailability_is_transient() {
    assert!(JevError::Unavailable.is_transient());
    for error in [
        JevError::NoQuestions,
        JevError::TooManyQuestions,
        JevError::Rejected,
        JevError::InvalidResponse,
    ] {
        assert!(!error.is_transient(), "{error:?}");
    }
}

#[test]
fn named_decision_validation_bounds_keys_questions_and_the_whole_request() {
    let mut request = DecisionRequest {
        input: serde_json::Value::Null,
        questions: [(
            "é".repeat(MAX_DECISION_KEY_BYTES / 2),
            "é".repeat(MAX_QUESTION_CHARS),
        )]
        .into(),
    };
    assert!(request.validate().is_ok());
    request
        .questions
        .insert("a".repeat(MAX_DECISION_KEY_BYTES + 1), "Valid?".into());
    assert!(request.validate().is_err());
    request.questions = [("named".into(), "x".repeat(MAX_QUESTION_CHARS + 1))].into();
    assert_eq!(
        request.validate(),
        Err(DecisionValidationError::Question(QuestionError::TooLong))
    );
    request.questions = (0..MAX_QUESTIONS)
        .map(|index| (index.to_string(), "Valid?".into()))
        .collect();
    assert!(request.validate().is_ok());
    request.questions.insert("extra".into(), "Valid?".into());
    assert!(request.validate().is_err());

    request.questions = [("named".into(), "Valid?".into())].into();
    request.input = serde_json::Value::String(String::new());
    let envelope_bytes = serde_json::to_vec(&request).unwrap().len();
    request.input =
        serde_json::Value::String("x".repeat(MAX_DECISION_REQUEST_BYTES - envelope_bytes));
    assert_eq!(
        serde_json::to_vec(&request).unwrap().len(),
        MAX_DECISION_REQUEST_BYTES
    );
    assert!(request.validate().is_ok());
    request.input =
        serde_json::Value::String("x".repeat(MAX_DECISION_REQUEST_BYTES - envelope_bytes + 1));
    assert!(request.validate().is_err());
}

#[test]
fn named_decisions_reject_unknown_authority_fields_and_preserve_exact_keys() {
    assert!(
        serde_json::from_value::<DecisionRequest>(serde_json::json!({
            "input": null,
            "questions": {"valid": "Valid?"},
            "owner": "macro|other@example.com"
        }))
        .is_err()
    );
    let request: DecisionRequest = serde_json::from_value(serde_json::json!({
        "input": null,
        "questions": {" named ": " Valid? "}
    }))
    .unwrap();
    let (names, questions) = request.validated_questions().unwrap();
    assert_eq!(names, [" named "]);
    assert_eq!(questions[0].as_str(), "Valid?");
    let response = DecisionResponse {
        probabilities: [(names[0].clone(), 0.75)].into(),
    };
    let roundtrip: DecisionResponse =
        serde_json::from_value(serde_json::to_value(&response).unwrap()).unwrap();
    assert_eq!(roundtrip.probabilities, response.probabilities);
}
