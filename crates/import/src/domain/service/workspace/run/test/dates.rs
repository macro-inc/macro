use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn written_pages_keep_their_notion_dates(pool: PgPool) {
    let owner = user("dates");
    let mut spec = page('f', "Spec");
    spec.parent_foreign_id = Some(page_id('e').as_str().to_string());
    let (review, rows) = approved(&pool, &owner, &[page('e', "Wiki"), spec]).await;
    let repo = PgImportRepo::new(pool.clone());
    planned(&repo, &owner).await;
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer::default());
    let service = ImportServiceImpl::new(
        PgImportRepo::new(pool.clone()),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    let at = |month| Utc.with_ymd_and_hms(2024, month, 1, 0, 0, 0).unwrap();
    let mut documents = writer.document_dates.lock().unwrap().clone();
    documents.sort_by_key(|(id, _)| *id);
    let mut expected = vec![
        (
            write::document_id(rows[0]),
            Some(SourceDates {
                created: at(1),
                last_edited: at(3),
            }),
        ),
        (
            write::document_id(rows[1]),
            Some(SourceDates {
                created: at(2),
                last_edited: at(6),
            }),
        ),
    ];
    expected.sort_by_key(|(id, _)| *id);
    assert_eq!(documents, expected, "each page keeps its own dates");
}
