use super::*;

struct RowLinkedConnected;
impl NotionConnections for RowLinkedConnected {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline {
            external_rows: 3,
            ..Default::default()
        }))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unreviewed_row_body_sources_keep_named_links_and_one_counted_loss(pool: PgPool) {
    let owner = user("row-reference-loss");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(RowLinkedConnected));
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
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(
        service.creator.databases.lock().unwrap().len(),
        1,
        "unreviewed sources are not imported"
    );
    let documents = service.creator.documents.lock().unwrap();
    let row_references: Vec<_> = documents
        .iter()
        .filter(|(_, name, _)| name == "Row")
        .flat_map(|(_, _, links)| &links.databases)
        .collect();
    assert_eq!(row_references.len(), 3);
    assert!(row_references.iter().all(|reference| matches!(
        reference.target,
        NotionDatabaseTarget::Fallback(NotionDatabaseFallback::NotImported)
    )));
    assert!(report.warnings.iter().any(|loss| loss.contains("3")
        && loss.contains("External plans")
        && loss.contains("not reviewed")));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_personal_database_stops_before_rows_when_its_reserved_folder_gains_a_grant(
    pool: PgPool,
) {
    let owner = user("late-database-grant");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer {
            grant_on_database: true,
            ..Default::default()
        },
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let (review, _) = approved(&pool, &owner, &[source]).await;
    planned(&service.repo, &owner).await;
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert_eq!(
        service
            .creator
            .database_insert_rows
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(report.failures.len(), 1);
    assert!(
        report
            .warnings
            .iter()
            .any(|warning| warning.contains("Work") && warning.contains("sharing changed"))
    );
}

struct TransientConnected(Arc<std::sync::atomic::AtomicBool>);
impl NotionConnections for TransientConnected {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline {
            transient_query: Some(self.0.clone()),
            ..Default::default()
        }))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transient_reservation_then_retry_restores_database_cards(pool: PgPool) {
    for notion_error in [true, false] {
        let owner = user(if notion_error {
            "transient-notion-reservation"
        } else {
            "transient-macro-reservation"
        });
        let tracker = TaskTracker::new();
        let service = service(
            &pool,
            Writer {
                database_error_once: std::sync::atomic::AtomicBool::new(!notion_error),
                ..Default::default()
            },
            CancellationToken::new(),
            tracker.clone(),
        )
        .with_notion_connections(Arc::new(TransientConnected(Arc::new(
            std::sync::atomic::AtomicBool::new(notion_error),
        ))));
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
        tracker.close();
        tracker.wait().await;
        assert!(
            service.creator.documents.lock().unwrap().is_empty(),
            "transient reservations must not persist permanent fallback links"
        );
        assert_eq!(
            service.notion_import_report(&owner).await.unwrap().status,
            Some(RunStatus::Failed)
        );
        let failed = service.notion_import_report(&owner).await.unwrap();
        assert!(
            failed.error.as_deref().is_some_and(
                |error| error.contains("Work") && !error.contains(page_id('d').as_str())
            )
        );
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.wait().await;
        let documents = service.creator.documents.lock().unwrap();
        let page = documents
            .iter()
            .find(|(_, title, _)| title == "Project")
            .unwrap();
        assert!(
            page.2
                .databases
                .iter()
                .all(|link| matches!(link.target, NotionDatabaseTarget::Resolved { .. }))
        );
    }
}

struct LongLinkedConnected;
impl NotionConnections for LongLinkedConnected {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        let title: String = (0..1800)
            .map(|n| char::from_u32(0x4e00 + (n * 1949) % 20992).unwrap())
            .collect();
        Ok(Some(Inline {
            external_rows: 1,
            external_title: Some(title),
            ..Default::default()
        }))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_long_link_titles_do_not_prevent_durable_body_and_loss_markers(pool: PgPool) {
    let owner = user("long-inline-title");
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_notion_connections(Arc::new(LongLinkedConnected));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    let (review, rows) = approved(
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
    tracker.close();
    tracker.wait().await;
    let markers = service.repo.written(&owner, &[rows[1]]).await.unwrap();
    assert!(
        markers
            .iter()
            .any(|marker| marker.kind == crate::domain::models::WrittenKind::Body),
        "long user labels must not break the body marker batch"
    );
    assert!(
        markers
            .iter()
            .any(|marker| marker.kind == crate::domain::models::WrittenKind::Loss)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_external_dependencies_need_explicit_review_scoped_consent(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    for other_review_marker in [false, true] {
        let owner = user(if other_review_marker {
            "dependency-old-review"
        } else {
            "dependency-legacy-draft"
        });
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
        source.metadata["plan"]["dependencyOf"] = serde_json::json!([page_id('e').as_str()]);
        let (review, ids) = approved(
            &pool,
            &owner,
            &[planned_page('e', "Project", false), source],
        )
        .await;
        if other_review_marker {
            let other_review = Uuid::now_v7();
            service
                .repo
                .record_written(
                    &owner,
                    &[
                        WrittenObject {
                            import_id: ids[1],
                            kind: WrittenKind::DependencyReviewed,
                            object: other_review.to_string(),
                            macro_id: other_review,
                        },
                        WrittenObject {
                            import_id: ids[1],
                            kind: WrittenKind::DependencyIncluded,
                            object: other_review.to_string(),
                            macro_id: other_review,
                        },
                    ],
                )
                .await
                .unwrap();
        }
        planned(&service.repo, &owner).await;
        service
            .approve_review_dependencies(&owner, review, &[])
            .await
            .unwrap();
        service
            .start_notion_write(&owner, review, NotionWriteChoices::default())
            .await
            .unwrap();
        tracker.close();
        tracker.wait().await;
        assert!(
            service.creator.databases.lock().unwrap().is_empty(),
            "no draft or a different review cannot opt in a dependency"
        );
        let docs = service.creator.documents.lock().unwrap();
        assert!(
            docs.iter()
                .flat_map(|(_, _, links)| &links.databases)
                .all(|occurrence| matches!(
                    occurrence.target,
                    NotionDatabaseTarget::Fallback(NotionDatabaseFallback::NotImported)
                ))
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_reservations_run_four_sources_at_once_with_a_fixed_bound(pool: PgPool) {
    use crate::domain::service::notion_workspace::write::WriteItem;
    let owner = user("parallel-reservations");
    let started = Arc::new(tokio::sync::Semaphore::new(0));
    let gate = Arc::new(tokio::sync::Semaphore::new(0));
    let service = service(
        &pool,
        Writer {
            reservation_gate: Some((started.clone(), gate.clone())),
            ..Default::default()
        },
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let rows: Vec<_> = ['1', '2', '3', '4', '5', '6']
        .into_iter()
        .map(|id| {
            let mut row = planned_page(id, "Work", false);
            row.kind = ImportKind::DataSource;
            row
        })
        .collect();
    let rows = service
        .repo
        .replace_plan(&owner, ImportSource::Notion, &rows)
        .await
        .unwrap();
    let all: Vec<_> = rows.iter().filter_map(WriteItem::from_entity).collect();
    let ids: Vec<_> = all.iter().map(|item| item.import_id).collect();
    service.repo.mark_importing(&owner, &ids).await.unwrap();
    let set = WriteSet {
        review_id: Uuid::now_v7(),
        pending: all.clone(),
        all,
    };
    let control = JobControl::new(CancellationToken::new());
    let (result, ()) = tokio::join!(service.try_write_plan(&owner, &set, &control), async {
        // A timeout detects deadlock under the old serial scheduler; no sleep or polling.
        tokio::time::timeout(Duration::from_secs(20), started.acquire_many(4))
            .await
            .expect("four independent sources should reach reservation concurrently")
            .unwrap()
            .forget();
        assert_eq!(
            started.available_permits(),
            0,
            "the remaining sources must wait for the bound"
        );
        gate.add_permits(6);
    });
    assert_eq!(result.unwrap(), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_ticking_an_offered_external_dependency_imports_its_cards(pool: PgPool) {
    let owner = user("dependency-opt-in");
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
    source.metadata["plan"]["dependencyOf"] = serde_json::json!([page_id('e').as_str()]);
    let (review, ids) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    planned(&service.repo, &owner).await;
    let initial = service
        .review_dependencies(&owner, review, &[], false)
        .await
        .unwrap();
    assert_eq!(initial.excluded, vec![ids[1]]);
    assert!(initial.included.is_empty());
    service
        .review_dependencies(&owner, review, &initial.excluded, true)
        .await
        .unwrap();
    // A later saved draft ticks the dependency by removing it from excluded.
    let included = service
        .review_dependencies(&owner, review, &[], false)
        .await
        .unwrap();
    assert_eq!(included.included, vec![ids[1]]);
    service
        .approve_review_dependencies(&owner, review, &[])
        .await
        .unwrap();
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    assert_eq!(service.creator.databases.lock().unwrap().len(), 1);
    let docs = service.creator.documents.lock().unwrap();
    assert!(
        docs.iter()
            .flat_map(|(_, _, links)| &links.databases)
            .all(|occurrence| matches!(occurrence.target, NotionDatabaseTarget::Resolved { .. }))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn audit_adopted_dependency_cannot_use_another_reviews_inclusion_marker(pool: PgPool) {
    use crate::domain::models::{WrittenKind, WrittenObject};
    use crate::domain::service::notion_workspace::write::WriteItem;
    let owner = user("dependency-adoption-scope");
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_notion_connections(Arc::new(InlineConnected));
    let mut source = planned_page('d', "Work", false);
    source.kind = ImportKind::DataSource;
    source.metadata["plan"]["dependencyOf"] = serde_json::json!([page_id('e').as_str()]);
    let (review, ids) = approved(
        &pool,
        &owner,
        &[planned_page('e', "Project", false), source],
    )
    .await;
    let other_review = Uuid::now_v7();
    service
        .repo
        .record_written(
            &owner,
            &[WrittenObject {
                import_id: ids[1],
                kind: WrittenKind::DependencyIncluded,
                object: other_review.to_string(),
                macro_id: other_review,
            }],
        )
        .await
        .unwrap();
    let mut all = Vec::new();
    for id in &ids {
        all.push(
            WriteItem::from_entity(&service.repo.get(&owner, *id).await.unwrap().unwrap()).unwrap(),
        );
    }
    service.repo.mark_importing(&owner, &ids).await.unwrap();
    let set = WriteSet {
        review_id: review,
        pending: all.clone(),
        all,
    };
    let failed = service
        .try_write_plan(&owner, &set, &JobControl::new(CancellationToken::new()))
        .await
        .unwrap();
    assert_eq!(failed, 1);
    assert!(service.creator.databases.lock().unwrap().is_empty());
    let docs = service.creator.documents.lock().unwrap();
    assert_eq!(docs.len(), 1);
    assert!(docs[0].2.databases.iter().all(|occurrence| matches!(
        occurrence.target,
        NotionDatabaseTarget::Fallback(NotionDatabaseFallback::NotImported)
    )));
}
