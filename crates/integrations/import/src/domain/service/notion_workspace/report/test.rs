use chrono::{TimeZone, Utc};

use uuid::Uuid;

use super::*;
use crate::domain::models::{
    ImportSource, Initiator, NotionAlreadyImported, NotionPlanItem, ScanCounts,
};

fn row(
    title: &str,
    kind: ImportKind,
    status: ImportStatus,
    decision: NotionDecision,
    review: Option<Uuid>,
    last_error: Option<&str>,
) -> ImportEntity {
    let plan = NotionPlanItem {
        decision: Some(decision),
        reason: (decision == NotionDecision::Hand).then(|| "Mixed records".to_string()),
        path: Vec::new(),
        rows: (kind == ImportKind::DataSource).then_some(10),
        sample_titles: Vec::new(),
        task_fields: None,
        shared: false,
        shared_reason: None,
        shareable: true,
        already_imported: None,
    };
    ImportEntity {
        id: Uuid::now_v7(),
        user_id: "macro|owner@acme.test".to_string(),
        team_id: None,
        source: ImportSource::Notion,
        kind,
        foreign_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        parent_id: None,
        review_id: review,
        status,
        initiator: Initiator::Chat,
        metadata: serde_json::to_value(NotionDocMeta::for_plan(
            title.to_string(),
            "https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            plan,
        ))
        .unwrap(),
        entity_id: (status == ImportStatus::Imported).then(|| "doc-1".to_string()),
        entity_type: (status == ImportStatus::Imported).then(|| "md".to_string()),
        last_error: last_error.map(str::to_string),
        waiting_on: None,
        created_at: Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap(),
    }
}

#[test]
fn the_report_counts_the_current_plan_and_lists_what_needs_attention() {
    let review = Uuid::now_v7();
    let older_review = Uuid::now_v7();
    let mut older = row(
        "Old import",
        ImportKind::Page,
        ImportStatus::Imported,
        NotionDecision::Copy,
        Some(older_review),
        None,
    );
    older.updated_at = Utc.with_ymd_and_hms(2026, 10, 1, 12, 0, 0).unwrap();
    let rows = vec![
        older,
        row(
            "Roadmap",
            ImportKind::Page,
            ImportStatus::Imported,
            NotionDecision::Copy,
            Some(review),
            None,
        ),
        row(
            "Bugs",
            ImportKind::DataSource,
            ImportStatus::Importing,
            NotionDecision::Tasks,
            Some(review),
            None,
        ),
        row(
            "Specs",
            ImportKind::Page,
            ImportStatus::Staged,
            NotionDecision::Copy,
            Some(review),
            Some("Notion request failed"),
        ),
        row(
            "Untitled",
            ImportKind::Page,
            ImportStatus::Staged,
            NotionDecision::Skip,
            Some(review),
            None,
        ),
        row(
            "CRM",
            ImportKind::DataSource,
            ImportStatus::Staged,
            NotionDecision::Hand,
            Some(review),
            None,
        ),
    ];
    let run = ImportRun {
        source: ImportSource::Notion,
        status: RunStatus::Importing,
        error: None,
        updated_at: Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap(),
        scanned: None,
        review_id: None,
    };

    let report = report(Some(&run), &rows);

    assert_eq!(report.status, Some(RunStatus::Importing));
    assert_eq!(report.review_id, Some(review));
    assert_eq!((report.pages, report.data_sources), (3, 2));
    assert_eq!(
        (report.copy, report.tasks, report.skip, report.hand),
        (2, 1, 1, 1)
    );
    assert_eq!((report.imported, report.writing, report.waiting), (1, 1, 1));
    // Exact numbers: Bugs (tasks, 10 rows); CRM is by hand, so no database
    // is copied.
    assert_eq!(
        (
            report.documents,
            report.databases,
            report.database_rows,
            report.task_rows
        ),
        (2, 0, 0, 10)
    );
    assert_eq!(report.hand_items.len(), 1);
    assert_eq!(report.hand_items[0].title, "CRM");
    assert_eq!(
        report.hand_items[0].reason.as_deref(),
        Some("Mixed records")
    );
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.failures[0].title, "Specs");
    assert_eq!(
        report.failures[0].reason.as_deref(),
        Some("Notion request failed")
    );
}

#[test]
fn before_any_plan_the_report_is_empty() {
    assert_eq!(report(None, &[]), NotionImportReport::default());
}

#[test]
fn while_planning_the_report_carries_what_notion_has_shown_so_far() {
    let mut run = ImportRun {
        source: ImportSource::Notion,
        status: RunStatus::Running,
        error: None,
        updated_at: Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap(),
        scanned: Some(ScanCounts {
            pages: 40,
            data_sources: 12,
        }),
        review_id: None,
    };

    assert_eq!(
        report(Some(&run), &[]).scanned,
        Some(ScanCounts {
            pages: 40,
            data_sources: 12,
        })
    );

    run.status = RunStatus::Ready;
    assert_eq!(report(Some(&run), &[]).scanned, None);
}

#[test]
fn objects_already_in_macro_are_counted_apart_with_who_imported_them() {
    let review = Uuid::now_v7();
    let mut handbook = row(
        "Handbook",
        ImportKind::Page,
        ImportStatus::Staged,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    let mut meta: NotionDocMeta = serde_json::from_value(handbook.metadata.clone()).unwrap();
    if let Some(plan) = meta.plan.as_mut() {
        plan.already_imported = Some(NotionAlreadyImported {
            by: "ana@acme.test".to_string(),
            entity_id: "doc-handbook".to_string(),
            entity_type: "md".to_string(),
        });
    }
    handbook.metadata = serde_json::to_value(meta).unwrap();
    let mut wiki = row(
        "Wiki",
        ImportKind::Page,
        ImportStatus::Importing,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    let mut meta: NotionDocMeta = serde_json::from_value(wiki.metadata.clone()).unwrap();
    if let Some(plan) = meta.plan.as_mut() {
        plan.shared = true;
    }
    wiki.metadata = serde_json::to_value(meta).unwrap();
    wiki.waiting_on = Some(Uuid::now_v7());
    let notes = row(
        "Notes",
        ImportKind::Page,
        ImportStatus::Staged,
        NotionDecision::Copy,
        Some(review),
        None,
    );

    let report = report(None, &[handbook, wiki, notes]);

    assert_eq!(report.pages, 3, "Notion shared all three");
    assert_eq!(report.already_in_macro, 1);
    assert_eq!(
        report.already_imported_by,
        [NotionImporter {
            by: "ana@acme.test".to_string(),
            count: 1
        }]
    );
    assert_eq!(
        (report.copy, report.documents),
        (2, 2),
        "the Handbook is not copied"
    );
    assert_eq!(report.shared_with_team, 1);
    assert_eq!(report.waiting_on_teammates, 1);
    assert_eq!((report.writing, report.waiting), (0, 1));
}

#[test]
fn a_plan_presented_while_it_is_decided_counts_what_is_undecided_under_the_runs_review() {
    let earlier_review = Uuid::now_v7();
    let review = Uuid::now_v7();
    // Imported by an earlier plan and review.
    let imported = row(
        "Old notes",
        ImportKind::Page,
        ImportStatus::Imported,
        NotionDecision::Copy,
        Some(earlier_review),
        None,
    );
    let decided = row(
        "Handbook",
        ImportKind::Page,
        ImportStatus::Staged,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    let mut undecided = row(
        "Roadmap",
        ImportKind::DataSource,
        ImportStatus::Staged,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    let mut meta: NotionDocMeta = serde_json::from_value(undecided.metadata.clone()).unwrap();
    if let Some(plan) = meta.plan.as_mut() {
        plan.decision = None;
    }
    undecided.metadata = serde_json::to_value(meta).unwrap();
    let run = ImportRun {
        source: ImportSource::Notion,
        status: RunStatus::Running,
        error: None,
        updated_at: Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap(),
        scanned: None,
        review_id: Some(review),
    };

    let report = report(Some(&run), &[imported, decided, undecided]);

    assert_eq!(report.review_id, Some(review));
    assert_eq!((report.pages, report.data_sources), (1, 1));
    assert_eq!(report.deciding, 1);
    assert_eq!((report.copy, report.documents, report.databases), (1, 1, 0));
    assert_eq!((report.imported, report.waiting), (0, 1));
}
