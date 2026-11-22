use super::{attach_error, refused};
use agent_code_mode::domain::CodeModeError;
use import::domain::models::{ImportSource, RunErrorKind};
use import::domain::ports::{ImportError, UnreviewableRun};

#[test]
fn a_review_on_a_failed_plan_is_refused_with_its_kind_not_the_raw_error() {
    let review = uuid::Uuid::now_v7();
    let error = attach_error(
        review,
        ImportSource::Notion,
        ImportError::RunNotReviewable(UnreviewableRun::Failed {
            error_kind: Some(RunErrorKind::AccessLost),
        }),
    );
    let CodeModeError::Unpresentable(message) = error else {
        panic!("expected a refusal that settles the review, got {error:?}");
    };
    assert_eq!(
        message,
        format!(
            "Review {review} was not presented: the import plan failed (Notion no longer accepts Macro's connection (it was revoked or expired), so the user needs to reconnect Notion); nothing can be reviewed until it is planned again. Tell the user why instead of presenting it again."
        )
    );
}

#[test]
fn a_review_without_a_plan_is_refused() {
    let review = uuid::Uuid::now_v7();
    let CodeModeError::Unpresentable(message) = attach_error(
        review,
        ImportSource::Notion,
        ImportError::RunNotReviewable(UnreviewableRun::Missing),
    ) else {
        panic!("expected a refusal the agent reads");
    };
    assert!(
        message.contains("there is no import plan to review"),
        "{message}"
    );
}

#[test]
fn a_review_refused_before_it_is_saved_names_no_review() {
    let CodeModeError::Invalid(message) = refused(
        ImportSource::Linear,
        &UnreviewableRun::Failed {
            error_kind: Some(RunErrorKind::Unreachable),
        },
    ) else {
        panic!("expected a refusal the agent reads");
    };
    assert_eq!(
        message,
        "The import review was not created: the import plan failed (Linear couldn't be reached); nothing can be reviewed until it is planned again. Tell the user why instead of presenting it again."
    );
}
