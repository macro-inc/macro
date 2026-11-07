use super::*;

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
    }
}
