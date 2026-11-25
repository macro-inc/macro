//! Production re-planning, source-local failure budgets and cancellation.

use super::*;
use crate::domain::models::WrittenKind;
use crate::domain::ports::WrittenObjects;
use std::collections::HashMap;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_final_unknown_source_error_survives_replanning_and_is_not_an_outage(pool: PgPool) {
    let owner = user("unexpected-source-replan");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let rows = [planned_page('e', "Project", false), source];
    let mut generation = None;
    for attempt in 1..=6 {
        let consecutive = attempt.min(3);
        let documents_before = service.creator.documents.lock().unwrap().len();
        // The real retry entry point plans again; it cannot approve a Failed review.
        let (review, _) = approved(&pool, &owner, &rows).await;
        let source_id = service
            .repo
            .list(&owner, Some(ImportSource::Notion), None)
            .await
            .unwrap()
            .into_iter()
            .find(|row| row.foreign_id == page_id('d').as_str())
            .unwrap()
            .id;
        planned(&service.repo, &owner).await;
        if attempt == 1 {
            service
                .repo
                .record_written(
                    &owner,
                    &[crate::domain::models::WrittenObject {
                        import_id: source_id,
                        kind: WrittenKind::ViewName,
                        object: "private payload".into(),
                        macro_id: Uuid::now_v7(),
                    }],
                )
                .await
                .unwrap();
        }
        if consecutive > 1 {
            assert_eq!(generation, Some(source_id));
        }
        generation = Some(source_id);
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        let report = service.notion_import_report(&owner).await.unwrap();
        if attempt < 3 {
            assert_eq!(report.status, Some(RunStatus::Failed));
            let error = report.error.as_deref().unwrap();
            assert!(
                error.contains("An unexpected error stopped Work"),
                "{error}"
            );
            assert!(!error.contains("unavailable") && !error.contains("private payload"));
            assert_eq!(
                service.creator.documents.lock().unwrap().len(),
                documents_before
            );
        } else {
            assert_eq!(
                report.status,
                Some(RunStatus::Completed),
                "{:?}",
                report.error
            );
            assert_eq!(report.failures.len(), 1);
            assert!(
                report
                    .error
                    .as_deref()
                    .is_none_or(|line| !line.contains("Plan again to retry"))
            );
            assert!(
                report
                    .warnings
                    .iter()
                    .any(|line| line.contains("Work") && line.contains('3'))
            );
            assert_eq!(service.creator.documents.lock().unwrap().len(), 1);
        }
        let all = service
            .repo
            .list(&owner, Some(ImportSource::Notion), None)
            .await
            .unwrap();
        assert_eq!(
            all.iter()
                .filter(|row| row.foreign_id == page_id('d').as_str())
                .count(),
            1
        );
        let facts = service
            .repo
            .written(&owner, &all.iter().map(|row| row.id).collect::<Vec<_>>())
            .await
            .unwrap();
        let receipts = facts
            .iter()
            .filter(|f| f.kind == WrittenKind::DatabaseReservationFailure)
            .count();
        if attempt < 3 {
            assert_eq!(receipts, attempt);
        } else {
            assert!((1..=7).contains(&receipts));
            assert!(
                report
                    .warnings
                    .iter()
                    .any(|line| line.contains("imported as a link"))
            );
        }
    }
}

struct QueryFailures {
    failures: HashMap<NotionId, u16>,
    reads: Arc<Mutex<Vec<(NotionId, bool)>>>,
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_final_reset_is_owned_idempotent_and_preserves_other_markers(pool: PgPool) {
    let owner = user("reset-owned-budget");
    let other = user("reset-denied-budget");
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let (_, ids) = approved(&pool, &owner, &[source]).await;
    let repo = PgImportRepo::new(pool);
    let receipt = Uuid::now_v7();
    repo.record_written(
        &owner,
        &[
            crate::domain::models::WrittenObject {
                import_id: ids[0],
                kind: WrittenKind::DatabaseReservationFailure,
                object: receipt.to_string(),
                macro_id: receipt,
            },
            crate::domain::models::WrittenObject {
                import_id: ids[0],
                kind: WrittenKind::View,
                object: page_id('b').to_string(),
                macro_id: Uuid::now_v7(),
            },
        ],
    )
    .await
    .unwrap();
    assert!(
        repo.clear_database_reservation_failures(&other, ids[0])
            .await
            .is_err()
    );
    assert_eq!(repo.written(&owner, &ids).await.unwrap().len(), 2);
    repo.clear_database_reservation_failures(&owner, ids[0])
        .await
        .unwrap();
    repo.clear_database_reservation_failures(&owner, ids[0])
        .await
        .unwrap();
    let remaining = repo.written(&owner, &ids).await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].kind, WrittenKind::View);
}
impl NotionConnections for QueryFailures {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline {
            query_failures: self.failures.clone(),
            notion_reads: Some(self.reads.clone()),
            ..Default::default()
        }))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_final_one_poison_source_spends_only_with_a_later_healthy_read(pool: PgPool) {
    let owner = user("poison-source-replan");
    let tracker = TaskTracker::new();
    let reads = Arc::new(Mutex::new(Vec::new()));
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(QueryFailures {
        failures: HashMap::from([(page_id('d'), 503)]),
        reads: reads.clone(),
    }));
    let mut bad = planned_page('d', "Work", false);
    bad.kind = ImportKind::DataSource;
    let mut healthy = planned_page('7', "Healthy", false);
    healthy.kind = ImportKind::DataSource;
    let rows = [planned_page('e', "Project", false), bad, healthy];
    let mut generation = None;
    for attempt in 1..=3 {
        let (review, ids) = approved(&pool, &owner, &rows).await;
        planned(&service.repo, &owner).await;
        if let Some(previous) = generation {
            assert_eq!(ids[1], previous);
        }
        generation = Some(ids[1]);
        reads.lock().unwrap().clear();
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        let report = service.notion_import_report(&owner).await.unwrap();
        assert_eq!(
            report.status,
            Some(if attempt < 3 {
                RunStatus::Failed
            } else {
                RunStatus::Completed
            }),
            "{:?}",
            report.error
        );
        let facts = service.repo.written(&owner, &ids).await.unwrap();
        assert_eq!(
            facts
                .iter()
                .filter(|f| f.kind == WrittenKind::DatabaseReservationFailure)
                .count(),
            if attempt == 3 { 4 } else { attempt }
        );
        let observed = reads.lock().unwrap();
        let failure = observed
            .iter()
            .rposition(|(id, success)| *id == page_id('d') && !success)
            .unwrap();
        assert!(
            observed[failure + 1..]
                .iter()
                .any(|(id, success)| *id == page_id('7') && *success)
        );
        if attempt == 3 {
            assert_eq!(report.failures.len(), 1);
            assert!(!service.creator.documents.lock().unwrap().is_empty());
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_final_workspace_outages_and_rate_limits_never_spend_source_budgets(pool: PgPool) {
    for (name, failures) in [
        (
            "all-sources-down",
            HashMap::from([(page_id('d'), 503), (page_id('7'), 503)]),
        ),
        ("source-rate-limited", HashMap::from([(page_id('d'), 429)])),
    ] {
        let owner = user(name);
        let tracker = TaskTracker::new();
        let service = service(
            &pool,
            Writer::default(),
            CancellationToken::new(),
            tracker.clone(),
        )
        .with_notion_connections(Arc::new(QueryFailures {
            failures,
            reads: Arc::new(Mutex::new(Vec::new())),
        }));
        let mut bad = planned_page('d', "Work", false);
        bad.kind = ImportKind::DataSource;
        let mut other = planned_page('7', "Other", false);
        other.kind = ImportKind::DataSource;
        let (review, ids) = approved(
            &pool,
            &owner,
            &[planned_page('e', "Project", false), bad, other],
        )
        .await;
        planned(&service.repo, &owner).await;
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        let report = service.notion_import_report(&owner).await.unwrap();
        assert_eq!(report.status, Some(RunStatus::Failed));
        assert!(service.creator.documents.lock().unwrap().is_empty());
        assert!(
            service
                .repo
                .written(&owner, &ids)
                .await
                .unwrap()
                .iter()
                .all(|f| f.kind != WrittenKind::DatabaseReservationFailure
                    || Uuid::parse_str(&f.object).is_err())
        );
    }
}

struct ToggleViews(Arc<std::sync::atomic::AtomicBool>);
impl NotionConnections for ToggleViews {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline {
            incomplete_views: self.0.load(std::sync::atomic::Ordering::SeqCst),
            ..Default::default()
        }))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_final_success_clears_the_consecutive_reservation_budget(pool: PgPool) {
    let owner = user("consecutive-source-budget");
    let tracker = TaskTracker::new();
    let fail = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(ToggleViews(fail.clone())));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let rows = [planned_page('e', "Project", false), source];
    for attempt in 0..3 {
        if attempt == 2 {
            fail.store(false, std::sync::atomic::Ordering::SeqCst);
        }
        let (review, ids) = approved(&pool, &owner, &rows).await;
        planned(&service.repo, &owner).await;
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        let count = service
            .repo
            .written(&owner, &ids)
            .await
            .unwrap()
            .iter()
            .filter(|f| f.kind == WrittenKind::DatabaseReservationFailure)
            .count();
        assert_eq!(count, if attempt == 2 { 0 } else { attempt + 1 });
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_final_cancelling_during_reservation_stays_cancelled(pool: PgPool) {
    let owner = user("cancel-source-reservation");
    let tracker = TaskTracker::new();
    let entered = Arc::new(tokio::sync::Semaphore::new(0));
    let release = Arc::new(tokio::sync::Semaphore::new(0));
    let service = service(
        &pool,
        Writer {
            reservation_gate: Some((entered.clone(), release.clone())),
            ..Default::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    planned(&service.repo, &owner).await;
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    entered.acquire().await.unwrap().forget();
    service.cancel_notion_import(&owner).await.unwrap();
    release.add_permits(1);
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(
        report.status,
        Some(RunStatus::Dismissed),
        "{:?}",
        report.error
    );
    assert!(
        report
            .error
            .as_deref()
            .is_none_or(|e| !e.contains("unavailable") && !e.contains("could not be persisted"))
    );
    assert!(service.creator.documents.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_final_folder_access_is_rechecked_instead_of_writing_permanent_links(pool: PgPool) {
    let owner = user("folder-access-retry");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer {
            folder_access_error: std::sync::atomic::AtomicBool::new(true),
            ..Default::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let rows = [planned_page('e', "Project", false), source];
    let (review, ids) = approved(&pool, &owner, &rows).await;
    planned(&service.repo, &owner).await;
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Failed));
    assert!(service.creator.documents.lock().unwrap().is_empty());
    assert!(
        service
            .repo
            .written(&owner, &ids)
            .await
            .unwrap()
            .iter()
            .all(|f| f.kind != WrittenKind::DatabaseReservationFailure)
    );
    service
        .creator
        .folder_access_error
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let (review, _) = approved(&pool, &owner, &rows).await;
    planned(&service.repo, &owner).await;
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(
        report.status,
        Some(RunStatus::Completed),
        "{:?}",
        report.error
    );
    assert!(!service.creator.documents.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_terminal_projects_outage_never_spends_personal_source_budgets(pool: PgPool) {
    for failure in ["create", "exists", "database"] {
        let owner = user(&format!("projects-outage-{failure}"));
        let tracker = TaskTracker::new();
        let service = service(
            &pool,
            Writer {
                mirror_service_error: (failure != "database").then_some(failure),
                unknown_database: (failure == "database").then_some("Work"),
                ..Default::default()
            },
            CancellationToken::new(),
            tracker.clone(),
        )
        .with_notion_connections(Arc::new(InlineConnected));
        let mut first = planned_page('d', "Work", false);
        first.kind = ImportKind::DataSource;
        let mut second = planned_page('7', "Projects", false);
        second.kind = ImportKind::DataSource;
        for _ in 0..3 {
            let (review, _) = approved(&pool, &owner, &[first.clone(), second.clone()]).await;
            planned(&service.repo, &owner).await;
            if failure == "exists" {
                service
                    .repo
                    .set_personal_root_folder(&owner, Uuid::now_v7())
                    .await
                    .unwrap();
            }
            service
                .start_notion_write(&owner, review, NotionWriteChoices::default())
                .await
                .unwrap();
            tracker.close();
            tracker.wait().await;
            let report = service.notion_import_report(&owner).await.unwrap();
            assert_eq!(report.status, Some(RunStatus::Failed), "{:?}", report.error);
            let rows = service
                .repo
                .list(&owner, Some(ImportSource::Notion), None)
                .await
                .unwrap();
            let facts = service
                .repo
                .written(&owner, &rows.iter().map(|r| r.id).collect::<Vec<_>>())
                .await
                .unwrap();
            assert!(
                !facts
                    .iter()
                    .any(|f| f.kind == WrittenKind::DatabaseReservationFailure),
                "a projects outage spent a source budget"
            );
            assert!(service.creator.documents.lock().unwrap().is_empty());
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_terminal_no_peer_outage_requires_three_observations_and_twenty_four_hours(
    pool: PgPool,
) {
    for (name, status, schedule, terminal_at) in [
        ("outage-blips", 503, vec![0, 300, 25 * 3600], usize::MAX),
        (
            "outage-window",
            503,
            vec![0, 12 * 3600, 24 * 3600, 36 * 3600, 48 * 3600],
            2,
        ),
        (
            "outage-gap-reset",
            503,
            vec![0, 48 * 3600, 49 * 3600, 60 * 3600, 72 * 3600, 84 * 3600],
            4,
        ),
        (
            "outage-rate-limit",
            429,
            vec![0, 12 * 3600, 24 * 3600, 36 * 3600],
            2,
        ),
    ] {
        let owner = user(name);
        let tracker = TaskTracker::new();
        let reads = Arc::new(Mutex::new(Vec::new()));
        let now = Arc::new(std::sync::atomic::AtomicI64::new(0));
        let mut service = service(
            &pool,
            Writer::default(),
            CancellationToken::new(),
            tracker.clone(),
        )
        .with_notion_connections(Arc::new(QueryFailures {
            failures: HashMap::from([(page_id('d'), status)]),
            reads: reads.clone(),
        }));
        let clock = now.clone();
        service.reservation_clock = Arc::new(move || {
            chrono::DateTime::from_timestamp(
                1_800_000_000 + clock.load(std::sync::atomic::Ordering::SeqCst),
                0,
            )
            .unwrap()
        });
        let mut source = planned_page('d', "Work", false);
        source.kind = ImportKind::DataSource;
        let rows = [planned_page('e', "Project", false), source];
        let mut terminal_reads = None;
        for (attempt, seconds) in schedule.into_iter().enumerate() {
            now.store(seconds, std::sync::atomic::Ordering::SeqCst);
            let (review, _) = approved(&pool, &owner, &rows).await;
            planned(&service.repo, &owner).await;
            service
                .start_notion_write(&owner, review, NotionWriteChoices::default())
                .await
                .unwrap();
            tracker.close();
            tracker.wait().await;
            let report = service.notion_import_report(&owner).await.unwrap();
            let degraded = status == 503 && attempt >= terminal_at;
            assert_eq!(
                report.status,
                Some(if degraded {
                    RunStatus::Completed
                } else {
                    RunStatus::Failed
                }),
                "{:?}",
                report.error
            );
            if degraded {
                assert!(
                    report
                        .error
                        .as_deref()
                        .is_none_or(|line| !line.contains("Plan again to retry"))
                );
                assert!(report.warnings.iter().any(|line| {
                    line.contains("Notion kept failing for Work, so it was imported as a link")
                }));
                let read_count = reads.lock().unwrap().len();
                if let Some(previous) = terminal_reads {
                    assert_eq!(read_count, previous);
                }
                terminal_reads = Some(read_count);
            } else {
                assert!(report.error.as_deref().unwrap().contains("Work"));
            }
            let entities = service
                .repo
                .list(&owner, Some(ImportSource::Notion), None)
                .await
                .unwrap();
            let facts = service
                .repo
                .written(
                    &owner,
                    &entities.iter().map(|row| row.id).collect::<Vec<_>>(),
                )
                .await
                .unwrap();
            let count = facts
                .iter()
                .filter(|f| f.kind == WrittenKind::DatabaseReservationFailure)
                .count();
            assert!(count <= 7);
            if status == 429 {
                assert_eq!(count, 0);
            }
        }
    }
}
