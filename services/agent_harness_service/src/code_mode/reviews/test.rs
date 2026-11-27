use super::{attach_error, plan_approvable, refused, start_error};
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

#[test]
fn only_a_start_that_changed_nothing_is_approvable_again() {
    let refused = start_error(
        ImportSource::Notion,
        ImportError::RunNotReviewable(UnreviewableRun::StillPlanning),
    );
    assert!(
        matches!(refused, CodeModeError::NotApprovable(_)),
        "{refused:?}"
    );

    let not_started = start_error(
        ImportSource::Notion,
        ImportError::Db(rootcause::report!("pool timed out").into_dynamic()).not_started(),
    );
    let CodeModeError::NotApprovable(message) = not_started else {
        panic!("expected a retry, got {not_started:?}");
    };
    assert_eq!(
        message,
        "The import did not start: something went wrong on Macro's side. Approve it again once that is fixed."
    );

    // After the write was held, its outcome is unknown.
    let later = start_error(
        ImportSource::Notion,
        ImportError::Db(rootcause::report!("pool timed out").into_dynamic()),
    );
    let CodeModeError::Invalid(message) = later else {
        panic!("expected an unknown outcome, got {later:?}");
    };
    assert!(!message.contains("pool timed out"), "{message}");
    assert!(!message.contains("Approve it again"), "{message}");
}

#[test]
fn only_a_ready_plan_the_review_holds_can_be_approved() {
    use import::domain::models::{NotionImportReport, RunStatus};

    let review = uuid::Uuid::now_v7();
    let report = |status, review_id| NotionImportReport {
        status: Some(status),
        review_id,
        ..NotionImportReport::default()
    };

    assert!(plan_approvable(
        &report(RunStatus::Ready, Some(review)),
        review
    ));
    // Still being planned: a yes now approves nothing.
    assert!(!plan_approvable(
        &report(RunStatus::Running, Some(review)),
        review
    ));
    // Planned again under another review, or no longer held by one.
    assert!(!plan_approvable(
        &report(RunStatus::Ready, Some(uuid::Uuid::now_v7())),
        review
    ));
    assert!(!plan_approvable(&report(RunStatus::Ready, None), review));
    assert!(!plan_approvable(
        &report(RunStatus::Failed, Some(review)),
        review
    ));
    assert!(!plan_approvable(&NotionImportReport::default(), review));
}
