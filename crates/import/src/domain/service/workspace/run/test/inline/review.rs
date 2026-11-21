use super::*;

struct RowLinkedConnected;
impl NotionConnections for RowLinkedConnected {
    type Api = Inline;
    async fn for_user(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Option<Inline>, NotionError> {
        Ok(Some(Inline { external_rows: 3 }))
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
