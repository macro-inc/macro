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
