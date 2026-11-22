use super::attach_error;
use agent_code_mode::domain::CodeModeError;
use import::domain::ports::{ImportError, UnreviewableRun};

#[test]
fn a_review_on_a_failed_plan_is_refused_with_its_reason() {
    let review = uuid::Uuid::now_v7();
    let error = attach_error(
        review,
        ImportError::RunNotReviewable(UnreviewableRun::Failed {
            error: Some("Notion object not found or not shared with the connection".into()),
        }),
    );
    let CodeModeError::Invalid(message) = error else {
        panic!("expected a refusal the agent reads, got {error:?}");
    };
    assert_eq!(
        message,
        format!(
            "Review {review} was not presented: the import plan failed: Notion object not found or not shared with the connection; nothing can be reviewed until it is planned again. Tell the user why instead of presenting it again."
        )
    );
}

#[test]
fn a_review_without_a_plan_is_refused() {
    let review = uuid::Uuid::now_v7();
    let CodeModeError::Invalid(message) = attach_error(
        review,
        ImportError::RunNotReviewable(UnreviewableRun::Missing),
    ) else {
        panic!("expected a refusal the agent reads");
    };
    assert!(
        message.contains("there is no import plan to review"),
        "{message}"
    );
}
