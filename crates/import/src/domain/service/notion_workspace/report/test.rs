use chrono::{TimeZone, Utc};

use uuid::Uuid;

use super::*;
use crate::domain::models::{
    FidelityWarning, ImportSource, Initiator, NotionAlreadyImported, NotionPlanItem,
    NotionReviewOmissionKind, NotionViewChangeKind, ScanCounts, ViewWarning,
};

#[test]
fn view_changes_keep_ids_counts_and_impact_and_review_skips_keep_reasons() {
    use import_notion::domain::{
        model::NotionId,
        views::{ViewLossKind, ViewSetting, ViewType},
    };
    let id = |ch: char| NotionId::parse(&ch.to_string().repeat(32)).unwrap();
    let review = Uuid::now_v7();
    let warning = |view_id, kind, setting, properties, count| {
        FidelityWarning::ViewLoss(ViewWarning {
            source_id: id('a'),
            view_id,
            source: "Projects".into(),
            view: "Same title".into(),
            kind,
            setting,
            layout: ViewType::Table,
            properties,
            count,
        })
    };
    let mut database = row(
        "Projects",
        ImportKind::DataSource,
        ImportStatus::Imported,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    database.metadata["warnings"] = serde_json::json!([
        warning(
            id('c'),
            ViewLossKind::Setting,
            ViewSetting::ColumnWidth,
            vec![],
            1
        ),
        warning(
            id('b'),
            ViewLossKind::Setting,
            ViewSetting::HiddenColumn,
            vec!["Meeting".into()],
            1
        ),
        warning(
            id('b'),
            ViewLossKind::Setting,
            ViewSetting::HiddenColumn,
            vec!["Notes".into()],
            1
        ),
        warning(
            id('b'),
            ViewLossKind::FilterIncludesBlankStatus,
            ViewSetting::Other,
            vec!["Status".into()],
            3
        ),
    ]);
    let mut template = row(
        "Template",
        ImportKind::Page,
        ImportStatus::Discarded,
        NotionDecision::Skip,
        Some(review),
        None,
    );
    template.metadata["plan"]["reason"] = serde_json::json!("Empty template");
    let excluded = row(
        "Unselected",
        ImportKind::Page,
        ImportStatus::Discarded,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    let details = report(None, &[database, template, excluded])
        .details
        .unwrap();
    assert_eq!(
        details.not_imported[0].kind,
        NotionReviewOmissionKind::LeftOut
    );
    assert_eq!(
        details.not_imported[0].item.reason.as_deref(),
        Some("Empty template")
    );
    assert_eq!(
        details.not_imported[1].kind,
        NotionReviewOmissionKind::Excluded
    );
    assert_eq!(details.view_changes.len(), 1);
    let views = &details.view_changes[0].views;
    assert_eq!(views.len(), 2, "equal titles do not merge distinct views");
    assert_eq!(views[0].view_id, id('b').to_string());
    assert_eq!(views[0].changes[0].kind, NotionViewChangeKind::Filter);
    assert_eq!(views[0].changes[0].count, 3);
    assert_eq!(views[0].changes[1].count, 2);
    assert_eq!(
        views[0].changes[1].message,
        "Shown here, hidden in Notion: Meeting, Notes."
    );
    assert_eq!(views[1].changes[0].kind, NotionViewChangeKind::Display);
}

fn row(
    title: &str,
    kind: ImportKind,
    status: ImportStatus,
    decision: NotionDecision,
    review: Option<Uuid>,
    last_error: Option<&str>,
) -> ImportEntity {
    let plan = NotionPlanItem {
        dependency_of: Vec::new(),
        inline_on: Vec::new(),
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
        review_session_id: None,
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
        review_session_id: None,
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
        review_session_id: None,
    };

    let report = report(Some(&run), &[imported, decided, undecided]);

    assert_eq!(report.review_id, Some(review));
    assert_eq!((report.pages, report.data_sources), (1, 1));
    assert_eq!(report.deciding, 1);
    assert_eq!((report.copy, report.documents, report.databases), (1, 1, 0));
    assert_eq!((report.imported, report.waiting), (0, 1));
}

#[test]
fn replacing_an_unshared_folder_reports_the_removed_sharing() {
    let mut item = row(
        "Folder",
        ImportKind::Page,
        ImportStatus::Imported,
        NotionDecision::Copy,
        None,
        None,
    );
    item.metadata["separateFolder"] =
        serde_json::json!({"visibility":"shared", "reason":"sharing_removed"});
    let report = report(None, &[item]);
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("sharing was removed"))
    );
    assert!(
        report
            .warnings
            .iter()
            .all(|warning| !warning.contains("holds personal items"))
    );
}

#[test]
fn the_report_counts_assignees_omitted_to_keep_tasks_personal() {
    let item = row(
        "Tasks",
        ImportKind::DataSource,
        ImportStatus::Imported,
        NotionDecision::Tasks,
        None,
        None,
    );
    let count = TaskImportNoticeCount {
        import_id: item.id,
        reason: TaskImportNoticeReason::PersonalAssigneeOmitted,
        count: 2,
    };
    let report = super::report(None, &[item], &[count]).unwrap();
    assert!(
        report.warnings.iter().any(
            |warning| warning.contains("2 teammate assignees omitted to keep tasks owner-only")
        )
    );
}

#[test]
fn tracker_omissions_are_one_source_warning() {
    let rows: Vec<_> = (0..300)
        .map(|_| {
            let mut item = row(
                "Issue",
                ImportKind::Issue,
                ImportStatus::Imported,
                NotionDecision::Copy,
                None,
                None,
            );
            item.source = ImportSource::Linear;
            item
        })
        .collect();
    let counts: Vec<_> = rows
        .iter()
        .map(|item| TaskImportNoticeCount {
            import_id: item.id,
            reason: TaskImportNoticeReason::PersonalAssigneeOmitted,
            count: 1,
        })
        .collect();
    let report = super::report(None, &rows, &counts).unwrap();
    assert_eq!(report.warnings.len(), 1);
    assert!(report.warnings[0].contains("300 teammate assignees omitted"));
}

#[test]
fn shared_re_reviews_clear_the_owner_only_omission_warning() {
    let mut item = row(
        "Tasks",
        ImportKind::DataSource,
        ImportStatus::Importing,
        NotionDecision::Tasks,
        None,
        None,
    );
    item.metadata["plan"]["shared"] = true.into();
    let count = TaskImportNoticeCount {
        import_id: item.id,
        reason: TaskImportNoticeReason::PersonalAssigneeOmitted,
        count: 1,
    };
    let report = super::report(None, &[item], &[count]).unwrap();
    assert!(
        report
            .warnings
            .iter()
            .all(|warning| !warning.contains("omitted to keep tasks owner-only"))
    );
}

fn report(run: Option<&ImportRun>, rows: &[ImportEntity]) -> NotionImportReport {
    super::report(run, rows, &[]).unwrap()
}

#[test]
fn invalid_folder_separation_reasons_fail_loudly() {
    let mut item = row(
        "Folder",
        ImportKind::Page,
        ImportStatus::Imported,
        NotionDecision::Copy,
        None,
        None,
    );
    item.metadata["separateFolder"] =
        serde_json::json!({"visibility":"shared", "reason":"unknown"});
    assert!(super::report(None, &[item], &[]).is_err());
}

#[test]
fn notice_reads_exclude_shared_items_and_older_reviews() {
    let old_review = Uuid::now_v7();
    let review = Uuid::now_v7();
    let mut old = row(
        "Old",
        ImportKind::Issue,
        ImportStatus::Imported,
        NotionDecision::Copy,
        Some(old_review),
        None,
    );
    old.updated_at = Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap();
    let personal = row(
        "Personal",
        ImportKind::Issue,
        ImportStatus::Imported,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    let mut shared = row(
        "Shared",
        ImportKind::Issue,
        ImportStatus::Imported,
        NotionDecision::Copy,
        Some(review),
        None,
    );
    shared.metadata["plan"]["shared"] = true.into();
    let expected = personal.id;
    assert_eq!(
        super::notice_import_ids(None, &[old, personal, shared]),
        vec![expected]
    );
}

#[test]
fn shared_re_reviews_hide_historical_personal_relocations() {
    let mut item = row(
        "Tasks",
        ImportKind::DataSource,
        ImportStatus::Importing,
        NotionDecision::Tasks,
        None,
        None,
    );
    item.metadata["plan"]["shared"] = true.into();
    item.metadata["personalFolderId"] = Uuid::now_v7().to_string().into();
    assert!(
        report(None, &[item])
            .warnings
            .iter()
            .all(|warning| !warning.contains("kept in Notion (personal)"))
    );
}

#[test]
fn resumed_warning_snapshots_keep_counts_without_adding_them_twice() {
    use crate::domain::models::{FidelityWarning, ReferenceLossReason};
    let mut source = row(
        "Work",
        ImportKind::DataSource,
        ImportStatus::Imported,
        NotionDecision::Copy,
        None,
        None,
    );
    source.metadata["warnings"] = serde_json::json!([
        FidelityWarning::References {
            reason: ReferenceLossReason::NotReviewed,
            title: "External plans".into(),
            count: 3
        },
        FidelityWarning::References {
            reason: ReferenceLossReason::NotReviewed,
            title: "External plans".into(),
            count: 8
        },
        FidelityWarning::Text("A saved sort was omitted".into()),
    ]);
    let report = report(None, &[source]);
    assert_eq!(report.warnings.len(), 2);
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("8 references") && warning.contains("External plans"))
    );
}

#[test]
fn review_counted_warnings_remain_scoped_to_their_containing_sources() {
    use crate::domain::models::{FidelityWarning, ReferenceLossReason};
    let mut source = row(
        "Work",
        ImportKind::DataSource,
        ImportStatus::Imported,
        NotionDecision::Copy,
        None,
        None,
    );
    source.metadata["warnings"] = serde_json::json!([FidelityWarning::References {
        reason: ReferenceLossReason::NotReviewed,
        title: "External plans".into(),
        count: 3
    }]);
    let mut other = source.clone();
    other.id = Uuid::now_v7();
    other.foreign_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into();
    other.metadata["title"] = serde_json::json!("Roadmap");
    let report = report(None, &[source, other]);
    assert_eq!(
        report.warnings.len(),
        2,
        "distinct source counts must not collapse into one line"
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("Work") && warning.contains("3 references"))
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("Roadmap") && warning.contains("3 references"))
    );
}

#[test]
fn typed_people_counts_from_identically_named_sources_stay_distinct() {
    use crate::domain::models::FidelityWarning;
    let mut source = row(
        "Tasks",
        ImportKind::DataSource,
        ImportStatus::Imported,
        NotionDecision::Copy,
        None,
        None,
    );
    source.metadata["warnings"] = serde_json::json!([FidelityWarning::UnmappedPeople {
        source: "Tasks".into(),
        property: "Owner".into(),
        count: 2
    }]);
    let mut other = source.clone();
    other.id = Uuid::now_v7();
    other.foreign_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into();
    let report = report(None, &[source, other]);
    assert_eq!(
        report.warnings,
        vec![
            "2 people assignments in database “Tasks”, property “Owner”, could not be matched to Macro users and were omitted.",
            "2 people assignments in database “Tasks”, property “Owner”, could not be matched to Macro users and were omitted.",
        ]
    );
}

#[test]
fn unknown_warning_entries_do_not_hide_known_report_losses() {
    let mut source = row(
        "Work",
        ImportKind::DataSource,
        ImportStatus::Imported,
        NotionDecision::Copy,
        None,
        None,
    );
    source.metadata["warnings"] = serde_json::json!([
        "A saved sort was omitted",
        {"future_warning_kind": "not understood"},
        {"another_future_kind": true}
    ]);
    let report = report(None, &[source]);
    assert_eq!(report.warnings.len(), 2);
    assert!(
        report
            .warnings
            .iter()
            .any(|line| line == "A saved sort was omitted")
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|line| line.contains("2 unsupported warning entries"))
    );
}

#[test]
fn identical_missing_container_notices_are_reported_once() {
    use crate::domain::models::{FidelityWarning, ImportNotice, ImportNoticeKind};
    use import_notion::domain::model::NotionId;
    let mut source = row(
        "Work",
        ImportKind::Page,
        ImportStatus::Imported,
        NotionDecision::Copy,
        None,
        None,
    );
    let object = NotionId::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
    source.metadata["warnings"] = serde_json::json!([
        FidelityWarning::Notice {
            notice: ImportNotice::new(&object, "First", ImportNoticeKind::MissingContainerIdentity)
        },
        FidelityWarning::Notice {
            notice: ImportNotice::new(
                &object,
                "Second",
                ImportNoticeKind::MissingContainerIdentity
            )
        }
    ]);
    let report = report(None, &[source]);
    assert_eq!(report.warnings.len(), 1);
}
