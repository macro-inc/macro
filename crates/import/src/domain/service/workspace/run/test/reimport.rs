//! A team copy deleted after resolving links must never supply the replacement id.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_team_copy_after_link_resolution_writes_a_fresh_document(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "snapshot-owner", team).await;
    let importer = teammate(&pool, "snapshot-importer", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let (_, owners) = approved(&pool, &owner, &[planned_page('e', "Wiki", true)]).await;
    let old_document = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'Wiki', $2, 'md')"#,
        old_document.to_string(),
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &owners, &owners, Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, owners[0], &old_document.to_string(), "md", None)
        .await
        .unwrap();
    let (review, imports) = approved(&pool, &importer, &[planned_page('e', "Wiki", false)]).await;
    let row = repo.get(&importer, imports[0]).await.unwrap().unwrap();
    let mut meta: NotionDocMeta = serde_json::from_value(row.metadata).unwrap();
    meta.plan.as_mut().unwrap().already_imported =
        Some(crate::domain::models::NotionAlreadyImported {
            by: "snapshot-owner@example.com".to_string(),
            entity_id: old_document.to_string(),
            entity_type: "md".to_string(),
        });
    sqlx::query!(
        "UPDATE import_entity SET metadata = $2 WHERE id = $1",
        imports[0],
        serde_json::to_value(meta).unwrap()
    )
    .execute(&pool)
    .await
    .unwrap();
    planned(&repo, &importer).await;
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer {
        target_pool: Some(pool.clone()),
        delete_on_first_read: std::sync::atomic::AtomicBool::new(true),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service
        .start_notion_write(&importer, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    let expected = write::document_id(imports[0]);
    assert_ne!(expected, old_document);
    {
        let documents = writer.documents.lock().unwrap();
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].0, expected);
        assert_eq!(documents[0].2.pages[&page_id('e')].document_id, expected);
    }
    let imported = repo.get(&importer, imports[0]).await.unwrap().unwrap();
    assert_eq!(imported.status, ImportStatus::Imported);
    assert_eq!(imported.entity_id, Some(expected.to_string()));
    assert_eq!(imported.team_id, Some(team));
    let metadata: NotionDocMeta = serde_json::from_value(imported.metadata).unwrap();
    let plan = metadata.plan.unwrap();
    assert_eq!(
        plan.already_imported, None,
        "the review must stop linking the deleted copy"
    );
    assert!(plan.shared);
    assert!(
        sqlx::query_scalar!(
            r#"SELECT "deletedAt" IS NOT NULL AS "trashed!" FROM "Document" WHERE id = $1"#,
            old_document.to_string()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "the deleted copy is not restored"
    );
}
