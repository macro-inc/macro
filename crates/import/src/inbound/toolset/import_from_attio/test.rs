use super::*;

#[test]
fn a_ready_plan_is_presented_with_its_counts() {
    let report = NotionImportReport {
        status: Some(RunStatus::Ready),
        skip: 1,
        attio: Some(CrmReport {
            pipelines: 1,
            companies: 40,
            contacts: 120,
            deals: 12,
            owners: 3,
            owners_matched: 2,
            ..CrmReport::default()
        }),
        ..NotionImportReport::default()
    };
    let text = message(NotionImportAction::Plan, &report);
    assert!(text.contains("\"source\":\"attio\""), "{text}");
    assert!(
        text.contains("1 pipelines, 40 companies, 120 people and 12 deals"),
        "{text}"
    );
    assert!(text.contains("2 of 3 owners"), "{text}");
    assert!(text.contains("Should I kick it off?"));
    assert!(!text.contains("HubSpot"), "{text}");
}

#[test]
fn a_hubspot_section_is_not_read_as_attio_counts() {
    let report = NotionImportReport {
        status: Some(RunStatus::Ready),
        hubspot: Some(CrmReport {
            companies: 5,
            ..CrmReport::default()
        }),
        ..NotionImportReport::default()
    };
    assert!(message(NotionImportAction::Plan, &report).contains("no records"));
}

#[test]
fn the_tool_asks_to_start_only_a_ready_plan() {
    let schema = serde_json::to_string(&schemars::schema_for!(ImportFromAttio)).unwrap();
    assert!(
        schema.contains("Once the plan is ready, ask Should I kick it off?"),
        "{schema}"
    );
    assert!(schema.contains("drafts [{source: attio}]"), "{schema}");
}

#[test]
fn a_user_the_attio_rollout_leaves_out_is_refused_calmly() {
    let text = super::super::not_rolled_out_message(ImportSource::Attio);

    assert!(
        text.starts_with(
            "The Attio import is in early access and not turned on for this account yet."
        ),
        "{text}"
    );
    assert!(
        text.contains("Nothing is wrong with the user's Attio connection"),
        "{text}"
    );
    assert!(text.contains("do not retry"), "{text}");
}

#[test]
fn the_tool_says_it_works_only_where_the_attio_import_is_turned_on() {
    let schema = serde_json::to_string(&schemars::schema_for!(ImportFromAttio)).unwrap();
    assert!(
        schema.contains("only where the Attio import is turned on for the account"),
        "{schema}"
    );
}
