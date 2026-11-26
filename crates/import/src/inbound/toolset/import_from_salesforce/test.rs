use super::*;

#[test]
fn a_ready_plan_is_presented_with_its_counts() {
    let report = NotionImportReport {
        status: Some(RunStatus::Ready),
        skip: 1,
        salesforce: Some(CrmReport {
            pipelines: 1,
            companies: 40,
            contacts: 120,
            deals: 25,
            owners: 3,
            owners_matched: 2,
            ..CrmReport::default()
        }),
        ..NotionImportReport::default()
    };
    let text = message(NotionImportAction::Plan, &report);
    assert!(text.contains("\"source\":\"salesforce\""), "{text}");
    assert!(
        text.contains("1 pipeline, 40 accounts, 120 contacts and 25 opportunities"),
        "{text}"
    );
    assert!(text.contains("2 of 3 owners"), "{text}");
    assert!(text.contains("Should I kick it off?"), "{text}");
    assert!(!text.contains("sharing"), "{text}");
}

#[test]
fn a_running_plan_is_presented_without_polling_or_an_early_offer() {
    let report = NotionImportReport {
        status: Some(RunStatus::Running),
        ..NotionImportReport::default()
    };
    let text = message(NotionImportAction::Plan, &report);
    assert!(text.contains("Present the review now"), "{text}");
    assert!(text.contains("Do not wait or poll"), "{text}");
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
    let schema = serde_json::to_string(&schemars::schema_for!(ImportFromSalesforce)).unwrap();
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
