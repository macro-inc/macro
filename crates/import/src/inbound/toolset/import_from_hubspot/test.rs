use super::*;

#[test]
fn a_ready_plan_is_presented_with_its_counts() {
    let report = NotionImportReport {
        status: Some(RunStatus::Ready),
        skip: 1,
        hubspot: Some(HubspotReport {
            pipelines: 2,
            companies: 196,
            contacts: 792,
            deals: 98,
            owners: 2,
            owners_matched: 1,
            ..HubspotReport::default()
        }),
        ..NotionImportReport::default()
    };
    let text = message(NotionImportAction::Plan, &report);
    assert!(text.contains("\"source\":\"hubspot\""));
    assert!(text.contains("2 pipelines, 196 companies, 792 contacts and 98 deals"));
    assert!(text.contains("1 of 2 owners"));
    assert!(text.contains("Should I kick it off?"));
    assert!(!text.contains("sharing"));
}

#[test]
fn a_running_plan_is_presented_without_polling() {
    let report = NotionImportReport {
        status: Some(RunStatus::Running),
        ..NotionImportReport::default()
    };
    let text = message(NotionImportAction::Plan, &report);
    assert!(text.contains("Present the review now"));
    assert!(text.contains("Do not wait or poll"));
}
