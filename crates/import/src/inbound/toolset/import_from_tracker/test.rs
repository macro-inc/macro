use super::*;
use crate::domain::models::RunErrorKind;

#[test]
fn each_source_presents_its_own_review_before_writing() {
    for source in [ImportSource::Linear, ImportSource::Jira] {
        let report = NotionImportReport {
            status: Some(RunStatus::Ready),
            issues: 7,
            projects: 2,
            task_rows: 7,
            copy: 2,
            ..Default::default()
        };
        let text = message(source, NotionImportAction::Plan, &report);
        assert!(text.contains(&format!("\"source\":\"{}\"", source.as_ref())));
        assert!(text.contains("7 issues and 2 groups"));
        assert!(text.contains("Should I kick it off?"));
        assert!(text.contains("DecideReview"));
        assert!(text.contains("everything is personal"));
        let running = NotionImportReport {
            status: Some(RunStatus::Running),
            ..Default::default()
        };
        let text = message(source, NotionImportAction::Plan, &running);
        assert!(text.contains("Present the review now"));
        assert!(text.contains("Do not wait or poll"));
        // A yes before the plan exists cannot approve it, and nothing acts on
        // it once the plan is ready: never offer to start it later.
        assert!(!text.contains("once it's ready?"), "{text}");
        assert!(
            text.contains("approve it on the card once it is ready"),
            "{text}"
        );
        assert!(
            text.contains("do not call DecideReview while it is still being planned"),
            "{text}"
        );
    }
}

#[test]
fn a_failed_tracker_plan_is_explained_and_not_planned_again() {
    let report = NotionImportReport {
        status: Some(RunStatus::Failed),
        error: Some("Linear rate limited the import".into()),
        error_kind: Some(RunErrorKind::RateLimited),
        ..NotionImportReport::default()
    };

    assert_eq!(
        message(ImportSource::Linear, NotionImportAction::Plan, &report),
        "The Linear import failed: Linear kept rate limiting the import; it can be tried again later. Tell the user in one sentence why it failed and what they can do about it. Do not plan again, check its status, or present a review until the user asks you to try again."
    );
}
