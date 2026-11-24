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

#[test]
fn the_tool_asks_to_start_only_a_ready_plan() {
    let schema = serde_json::to_string(&schemars::schema_for!(ImportFromHubspot)).unwrap();
    assert!(
        schema.contains("Once the plan is ready, ask Should I kick it off?"),
        "{schema}"
    );
    assert!(
        schema.contains(
            "While it is still being planned, do not ask or approve: the user approves it on the card once it is ready."
        ),
        "{schema}"
    );
}
