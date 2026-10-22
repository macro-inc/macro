use import::domain::models::{ImportSource, ImportState, ImportStatus};
use serde_json::json;

use super::*;
use crate::test_support::{linear_issue, notion_page, row, user};

#[test]
fn counts_split_failed_rows_from_fresh_candidates() {
    let mut failed = notion_page(2, "Q3 OKRs", ImportStatus::Staged);
    failed.last_error = Some("timed out".to_owned());
    let state = ImportState {
        runs: Vec::new(),
        entities: vec![
            notion_page(1, "Roadmap", ImportStatus::Staged),
            failed,
            notion_page(3, "Wiki", ImportStatus::Importing),
            notion_page(4, "Team", ImportStatus::Imported),
            notion_page(5, "Old", ImportStatus::Discarded),
            linear_issue(6, "ENG-1", "Bug", ImportStatus::Staged),
        ],
    };

    let counts = SourceView::of(&state, &user(), ImportSource::Notion).counts();

    assert_eq!(
        counts,
        Counts {
            candidates: 1,
            importing: 1,
            imported: 1,
            failed: 1,
        }
    );
}

#[test]
fn titles_read_like_the_source_app() {
    assert_eq!(
        title(&linear_issue(
            1,
            "ENG-12",
            "Fix login",
            ImportStatus::Staged
        )),
        "ENG-12 Fix login"
    );
    assert_eq!(
        title(&notion_page(2, "Roadmap", ImportStatus::Staged)),
        "Roadmap"
    );
    assert_eq!(
        title(&row(
            ImportSource::Slack,
            3,
            ImportStatus::Staged,
            json!({ "name": "general" })
        )),
        "#general"
    );
    assert_eq!(
        title(&row(
            ImportSource::Notion,
            4,
            ImportStatus::Staged,
            json!({})
        )),
        "Untitled page"
    );
}

#[test]
fn linear_candidates_group_by_team_and_describe_without_content() {
    let state = ImportState {
        runs: Vec::new(),
        entities: vec![
            linear_issue(1, "ENG-1", "One", ImportStatus::Staged),
            linear_issue(2, "ENG-2", "Two", ImportStatus::Staged),
            linear_issue(3, "OPS-1", "Three", ImportStatus::Staged),
        ],
    };
    let view = SourceView::of(&state, &user(), ImportSource::Linear);

    let groups = view.groups();
    assert_eq!(groups[0].label, "ENG");
    assert_eq!(groups[0].count, 2);
    assert_eq!(groups[1].label, "OPS");

    let candidates = view.candidates();
    assert_eq!(
        candidates[0].detail.as_deref(),
        Some("ENG · In Progress · Ada")
    );
    assert_eq!(candidates[0].reference.len(), REF_LEN);
}

#[test]
fn long_failure_reasons_are_trimmed() {
    let long = "x".repeat(500);
    let trimmed = reason(&long);
    assert!(trimmed.chars().count() <= 201);
    assert!(trimmed.ends_with('…'));
}
