use super::*;

#[test]
fn a_ready_plan_tells_the_agent_to_present_it_for_review() {
    let report = NotionImportReport {
        status: Some(RunStatus::Ready),
        pages: 40,
        data_sources: 3,
        copy: 38,
        tasks: 1,
        skip: 3,
        hand: 1,
        documents: 36,
        databases: 2,
        database_rows: 412,
        task_rows: 33,
        shared_with_team: 30,
        on_team: true,
        hand_items: vec![crate::domain::models::NotionReportItem {
            import_id: uuid::Uuid::nil(),
            title: "CRM".to_string(),
            kind: crate::domain::models::ImportKind::DataSource,
            url: None,
            reason: Some("Mixed records".to_string()),
        }],
        ..NotionImportReport::default()
    };

    assert_eq!(
        message(NotionImportAction::Plan, &report),
        "The plan is ready: of the 40 pages and 3 databases Notion shared, it imports 36 pages as documents, 2 databases with 412 rows, 1 task lists as 33 tasks; 30 of them shared with the user's team, 9 visible only to the user; 3 skipped, 1 to handle by hand. Tell the user these numbers as they are, then present the plan now with PresentReview (kind \"import\", a short title such as \"Import from Notion\", drafts [{\"source\":\"notion\"}]). Nothing is written until they approve it; they can change who sees each object on the card. End your message by asking \"Should I kick it off?\"; if they say yes, approve it with DecideReview (a submit decision). Objects to handle by hand (with your own tools, after the import): \"CRM\" (Mixed records)."
    );
}

#[test]
fn roots_parse_from_notion_urls_and_an_empty_list_means_everything() {
    assert_eq!(scope(&[]).unwrap(), ImportScope::Everything);
    assert_eq!(scope(&["  ".to_string()]).unwrap(), ImportScope::Everything);
    assert_eq!(
        scope(&["https://www.notion.so/Q3-plan-3fb607323e2e80629886fc0c028d50a7".to_string()])
            .unwrap(),
        ImportScope::Roots {
            ids: vec![NotionId::parse("3fb607323e2e80629886fc0c028d50a7").unwrap()],
        }
    );
    assert!(scope(&["not a page".to_string()]).is_err());
}

#[test]
fn while_notion_is_read_the_agent_presents_the_plan_at_once_with_what_is_found_so_far() {
    let report = NotionImportReport {
        status: Some(RunStatus::Running),
        on_team: true,
        scanned: Some(crate::domain::models::ScanCounts {
            pages: 40,
            data_sources: 12,
        }),
        ..NotionImportReport::default()
    };

    assert_eq!(
        message(NotionImportAction::Plan, &report),
        "Planning has started and goes on in the background (40 pages and 12 databases found in Notion so far). Present the plan now with PresentReview (kind \"import\", a short title such as \"Import from Notion\", drafts [{\"source\":\"notion\"}]) and tell the user in a sentence that the review fills in as Notion is read and each object is decided, and that they approve it there once it is ready. Do not wait for planning or check `status` in a loop. End your message by asking \"Should I kick it off once it's ready?\". If they say yes, approve it with DecideReview (a submit decision); while the plan is still being made it refuses, so tell them it is not ready yet and that they can say so again, or approve it on the card, once it is."
    );
}

#[test]
fn a_presented_plan_still_being_decided_says_how_far_it_got_and_not_to_wait() {
    let report = NotionImportReport {
        status: Some(RunStatus::Running),
        on_team: true,
        review_id: Some(uuid::Uuid::nil()),
        pages: 60,
        data_sources: 24,
        deciding: 44,
        ..NotionImportReport::default()
    };

    assert_eq!(
        message(NotionImportAction::Status, &report),
        "The plan is presented and still being made (40 of 84 objects decided so far). The review fills in as planning goes, and the user approves it there once it is ready. Do not wait for planning or check `status` in a loop."
    );
}

#[test]
fn without_a_team_the_agent_hears_the_import_is_personal_and_offers_no_team_sharing() {
    let report = NotionImportReport {
        status: Some(RunStatus::Ready),
        pages: 2,
        copy: 2,
        documents: 2,
        ..NotionImportReport::default()
    };

    assert_eq!(
        message(NotionImportAction::Plan, &report),
        "The plan is ready: of the 2 pages and 0 databases Notion shared, it imports 2 pages as documents; all of it visible only to the user; 0 skipped, 0 to handle by hand. The user is not on a team, so everything this import writes is visible only to them; do not offer to share it with a team. Tell the user these numbers as they are, then present the plan now with PresentReview (kind \"import\", a short title such as \"Import from Notion\", drafts [{\"source\":\"notion\"}]). Nothing is written until they approve it. End your message by asking \"Should I kick it off?\"; if they say yes, approve it with DecideReview (a submit decision)."
    );
}

#[test]
fn the_agent_hears_how_much_is_already_in_macro_and_by_whom() {
    let report = NotionImportReport {
        status: Some(RunStatus::Ready),
        on_team: true,
        pages: 12,
        copy: 2,
        documents: 2,
        already_in_macro: 10,
        already_imported_by: vec![
            crate::domain::models::NotionImporter {
                by: "ana@acme.test".to_string(),
                count: 7,
            },
            crate::domain::models::NotionImporter {
                by: "bo@acme.test".to_string(),
                count: 3,
            },
        ],
        ..NotionImportReport::default()
    };

    assert_eq!(
        message(NotionImportAction::Plan, &report),
        "The plan is ready: of the 12 pages and 0 databases Notion shared, it imports 2 pages as documents; 0 of them shared with the user's team, 2 visible only to the user; 0 skipped, 0 to handle by hand. 10 more are already in Macro, imported and shared with the team by ana@acme.test (7), bo@acme.test (3); they link to those copies and are not imported again. Tell the user these numbers as they are, then present the plan now with PresentReview (kind \"import\", a short title such as \"Import from Notion\", drafts [{\"source\":\"notion\"}]). Nothing is written until they approve it; they can change who sees each object on the card. End your message by asking \"Should I kick it off?\"; if they say yes, approve it with DecideReview (a submit decision)."
    );
}

#[test]
fn objects_waiting_on_a_teammate_are_explained_while_and_after_importing() {
    let report = NotionImportReport {
        status: Some(RunStatus::Completed),
        imported: 4,
        waiting_on_teammates: 2,
        ..NotionImportReport::default()
    };

    assert_eq!(
        message(NotionImportAction::Status, &report),
        "The import finished: 4 objects imported. 2 are being imported by a teammate at the same time and link to their copies once those are written."
    );
}
