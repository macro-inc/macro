//! Reservation failure scope and durable, generation-local retry limits.

use super::*;
use crate::domain::models::WrittenKind;
use crate::domain::ports::{DatabaseWriteFailure, WrittenObjects};
use std::collections::HashMap;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_delta_a_changed_approved_review_replaces_prior_dependency_inclusion(pool: PgPool) {
    let owner = user("replaced-dependency-consent");
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
    source.metadata["plan"]["dependencyOf"] = serde_json::json!([page_id('e')]);
    let (review, ids) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    planned(&service.repo, &owner).await;
    service
        .review_dependencies(&owner, review, &[ids[1]], true)
        .await
        .unwrap();
    service
        .approve_review_dependencies(&owner, review, &[])
        .await
        .unwrap();
    let facts = service.repo.written(&owner, &ids).await.unwrap();
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == WrittenKind::DependencyIncluded
                && fact.object == review.to_string()
                && fact.macro_id == review)
    );
    let other_review = Uuid::now_v7();
    service
        .repo
        .record_written(
            &owner,
            &[crate::domain::models::WrittenObject {
                import_id: ids[1],
                kind: WrittenKind::DependencyIncluded,
                object: other_review.to_string(),
                macro_id: other_review,
            }],
        )
        .await
        .unwrap();
    // A changed draft is saved, then approved again with this source excluded.
    service
        .review_dependencies(&owner, review, &[ids[1]], true)
        .await
        .unwrap();
    service
        .approve_review_dependencies(&owner, review, &[ids[1]])
        .await
        .unwrap();
    let facts = service.repo.written(&owner, &ids).await.unwrap();
    assert!(
        facts
            .iter()
            .all(|fact| fact.kind != WrittenKind::DependencyIncluded
                || fact.object != review.to_string())
    );
    assert!(
        facts
            .iter()
            .any(|fact| fact.kind == WrittenKind::DependencyIncluded
                && fact.object == other_review.to_string())
    );
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert!(service.creator.databases.lock().unwrap().is_empty());
    assert_eq!(service.creator.documents.lock().unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_delta_a_permanent_source_failure_does_not_block_other_objects(pool: PgPool) {
    let owner = user("permanent-source-error");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer {
            database_failures: HashMap::from([(
                "Broken".into(),
                DatabaseWriteFailure::InvalidSchema,
            )]),
            ..Default::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let mut broken = planned_page('d', "Broken", false);
    broken.kind = ImportKind::DataSource;
    let mut healthy = planned_page('7', "Healthy", false);
    healthy.kind = ImportKind::DataSource;
    let (review, _) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), broken, healthy],
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
    assert_eq!(
        report.status,
        Some(RunStatus::Completed),
        "{:?}",
        report.error
    );
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.failures[0].title, "Broken");
    assert_eq!(service.creator.databases.lock().unwrap().len(), 1);
    let documents = service.creator.documents.lock().unwrap();
    let page = documents
        .iter()
        .find(|(_, name, _)| name == "Project")
        .unwrap();
    assert_eq!(page.2.databases.len(), 2);
    assert!(
        page.2
            .databases
            .iter()
            .all(|link| matches!(link.target, NotionDatabaseTarget::Fallback(_)))
    );
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("Broken"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_delta_run_wide_failures_never_spend_source_retries_or_write_links(pool: PgPool) {
    for failure in [
        DatabaseWriteFailure::Authentication,
        DatabaseWriteFailure::Unavailable,
    ] {
        let owner = user(match failure {
            DatabaseWriteFailure::Authentication => "run-wide-auth-error",
            _ => "run-wide-service-error",
        });
        let tracker = TaskTracker::new();
        let service = service(
            &pool,
            Writer {
                database_failures: HashMap::from([
                    ("Work".into(), failure),
                    ("Other work".into(), failure),
                ]),
                ..Default::default()
            },
            CancellationToken::new(),
            tracker.clone(),
        )
        .with_notion_connections(Arc::new(InlineConnected));
        let mut first = planned_page('d', "Work", false);
        first.kind = ImportKind::DataSource;
        let mut second = planned_page('7', "Other work", false);
        second.kind = ImportKind::DataSource;
        let (review, ids) = approved(
            &pool,
            &owner,
            &[planned_page('e', "Project", false), first, second],
        )
        .await;
        planned(&service.repo, &owner).await;
        for _ in 0..3 {
            service
                .start_notion_write(&owner, review, NotionWriteChoices::default())
                .await
                .unwrap();
            tracker.close();
            tracker.wait().await;
            let report = service.notion_import_report(&owner).await.unwrap();
            assert_eq!(report.status, Some(RunStatus::Failed));
            assert!(
                report
                    .error
                    .as_deref()
                    .is_some_and(|error| error.contains("Work") || error.contains("Other work"))
            );
            assert!(service.creator.documents.lock().unwrap().is_empty());
            let written = service.repo.written(&owner, &ids).await.unwrap();
            assert!(
                written
                    .iter()
                    .all(|fact| fact.kind != WrittenKind::DatabaseReservationFailure)
            );
        }
    }
}

struct IncompleteViewsConnected;
impl NotionConnections for IncompleteViewsConnected {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline {
            incomplete_views: true,
            ..Default::default()
        }))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_delta_incomplete_views_fall_back_after_three_source_attempts(pool: PgPool) {
    let owner = user("bounded-source-view-retries");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(IncompleteViewsConnected));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let (review, ids) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    planned(&service.repo, &owner).await;
    for attempt in 1..=3 {
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        let report = service.notion_import_report(&owner).await.unwrap();
        if attempt < 3 {
            assert_eq!(report.status, Some(RunStatus::Failed));
            assert!(service.creator.documents.lock().unwrap().is_empty());
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
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("Work") && warning.contains('3'))
            );
            let documents = service.creator.documents.lock().unwrap();
            let page = documents
                .iter()
                .find(|(_, name, _)| name == "Project")
                .unwrap();
            assert!(
                page.2
                    .databases
                    .iter()
                    .all(|link| matches!(link.target, NotionDatabaseTarget::Fallback(_)))
            );
        }
    }
    let written = service.repo.written(&owner, &ids).await.unwrap();
    assert_eq!(
        written
            .iter()
            .filter(|fact| fact.kind == WrittenKind::DatabaseReservationFailure)
            .count(),
        4
    );
}
