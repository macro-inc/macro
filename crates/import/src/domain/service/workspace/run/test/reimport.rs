//! A team copy deleted after resolving links must never supply the replacement id.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_personal_replacement_never_claims_or_shares_the_deleted_team_copy(pool: PgPool) {
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
    assert_eq!(imported.team_id, None);
    assert!(writer.shares.lock().unwrap().is_empty());
    let metadata: NotionDocMeta = serde_json::from_value(imported.metadata).unwrap();
    let plan = metadata.plan.unwrap();
    assert_eq!(
        plan.already_imported, None,
        "the review must stop linking the deleted copy"
    );
    assert!(!plan.shared);
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn later_page_writes_use_the_replacement_and_preserve_live_team_destinations(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "references-owner", team).await;
    let importer = teammate(&pool, "references-importer", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let (_, owners) = approved(
        &pool,
        &owner,
        &[
            planned_page('e', "Wiki", true),
            planned_page('a', "Live", true),
        ],
    )
    .await;
    let old_wiki = Uuid::now_v7();
    let live_document = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'Wiki', $3, 'md'), ($2, 'Live', $3, 'md')"#,
        old_wiki.to_string(), live_document.to_string(), owner.as_ref(),
    ).execute(&pool).await.unwrap();
    repo.claim_importing(&owner, &owners, &owners, Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, owners[0], &old_wiki.to_string(), "md", None)
        .await
        .unwrap();
    repo.mark_imported(&owner, owners[1], &live_document.to_string(), "md", None)
        .await
        .unwrap();
    let (review, imports) = approved(
        &pool,
        &importer,
        &[
            planned_page('e', "Wiki", false),
            planned_page('a', "Live", false),
            planned_page('f', "Spec", false),
        ],
    )
    .await;
    let row = repo.get(&importer, imports[0]).await.unwrap().unwrap();
    let mut wiki: NotionDocMeta = serde_json::from_value(row.metadata).unwrap();
    wiki.plan.as_mut().unwrap().already_imported =
        Some(crate::domain::models::NotionAlreadyImported {
            by: "references-owner@example.com".to_string(),
            entity_id: old_wiki.to_string(),
            entity_type: "md".to_string(),
        });
    sqlx::query!(
        "UPDATE import_entity SET metadata = $2 WHERE id = $1",
        imports[0],
        serde_json::to_value(wiki).unwrap()
    )
    .execute(&pool)
    .await
    .unwrap();
    let row = repo.get(&importer, imports[1]).await.unwrap().unwrap();
    let mut live: NotionDocMeta = serde_json::from_value(row.metadata).unwrap();
    live.plan.as_mut().unwrap().already_imported =
        Some(crate::domain::models::NotionAlreadyImported {
            by: "references-owner@example.com".to_string(),
            entity_id: live_document.to_string(),
            entity_type: "md".to_string(),
        });
    sqlx::query!(
        "UPDATE import_entity SET metadata = $2 WHERE id = $1",
        imports[1],
        serde_json::to_value(live).unwrap()
    )
    .execute(&pool)
    .await
    .unwrap();
    planned(&repo, &importer).await;
    let ready = Arc::new(Notify::new());
    let expected_wiki = write::document_id(imports[0]);
    let expected_spec = write::document_id(imports[2]);
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer {
        target_pool: Some(pool.clone()),
        delete_target: Some(old_wiki),
        delete_on_first_read: std::sync::atomic::AtomicBool::new(true),
        notify_on_document: Some((expected_wiki, Arc::clone(&ready))),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(AfterReplacement(ready)))
    .with_job_shutdown(tokio_util::sync::CancellationToken::new(), tracker.clone());

    service
        .start_notion_write(&importer, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tokio::time::timeout(std::time::Duration::from_secs(10), tracker.wait())
        .await
        .unwrap();

    {
        let documents = writer.documents.lock().unwrap();
        assert_eq!(documents.len(), 2);
        let spec = documents
            .iter()
            .find(|(id, _, _)| *id == expected_spec)
            .unwrap();
        assert_eq!(spec.2.pages[&page_id('e')].document_id, expected_wiki);
        assert_ne!(spec.2.pages[&page_id('e')].document_id, old_wiki);
        assert_eq!(spec.2.pages[&page_id('a')].document_id, live_document);
    }
    let live = repo.get(&owner, owners[1]).await.unwrap().unwrap();
    assert_eq!(live.status, ImportStatus::Imported);
    assert_eq!(live.entity_id, Some(live_document.to_string()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_linked_task_folder_requires_a_fresh_plan_instead_of_a_database(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "shape-owner", team).await;
    let importer = teammate(&pool, "shape-importer", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let mut source = planned_page('e', "Tasks", true);
    source.kind = ImportKind::DataSource;
    let mut metadata: NotionDocMeta = serde_json::from_value(source.metadata).unwrap();
    metadata.plan.as_mut().unwrap().decision = Some(NotionDecision::Tasks);
    metadata.plan.as_mut().unwrap().task_fields = Some(Default::default());
    source.metadata = serde_json::to_value(metadata).unwrap();
    let (_, owners) = approved(&pool, &owner, &[source]).await;
    let folder = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Tasks', $2)"#,
        folder.to_string(),
        owner.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&owner, &owners, &owners, Some(team))
        .await
        .unwrap();
    repo.mark_imported(&owner, owners[0], &folder.to_string(), "project", None)
        .await
        .unwrap();
    let mut linked = planned_page('e', "Tasks", false);
    linked.kind = ImportKind::DataSource;
    let mut metadata: NotionDocMeta = serde_json::from_value(linked.metadata).unwrap();
    metadata.plan.as_mut().unwrap().already_imported =
        Some(crate::domain::models::NotionAlreadyImported {
            by: "shape-owner@example.com".to_string(),
            entity_id: folder.to_string(),
            entity_type: "project".to_string(),
        });
    linked.metadata = serde_json::to_value(metadata).unwrap();
    let (review, imports) = approved(&pool, &importer, &[linked]).await;
    planned(&repo, &importer).await;
    sqlx::query!(
        r#"UPDATE "Project" SET "deletedAt" = NOW() WHERE id = $1"#,
        folder.to_string()
    )
    .execute(&pool)
    .await
    .unwrap();
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer {
        target_pool: Some(pool.clone()),
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
    tokio::time::timeout(std::time::Duration::from_secs(10), tracker.wait())
        .await
        .unwrap();

    let deferred = repo.get(&importer, imports[0]).await.unwrap().unwrap();
    assert_eq!(deferred.status, ImportStatus::Staged);
    assert_eq!(deferred.team_id, None);
    assert!(deferred.last_error.is_some());
    let metadata: NotionDocMeta = serde_json::from_value(deferred.metadata).unwrap();
    let plan = metadata.plan.unwrap();
    assert_eq!(plan.decision, Some(NotionDecision::Hand));
    assert_eq!(plan.already_imported, None);
    assert!(writer.documents.lock().unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_deleted_finished_page_is_reported_without_stopping_other_pages(pool: PgPool) {
    let owner = teammate(&pool, "resume-deleted", Uuid::now_v7()).await;
    let repo = PgImportRepo::new(pool.clone());
    let (review, imports) = approved(
        &pool,
        &owner,
        &[
            planned_page('e', "Deleted page", false),
            planned_page('f', "Remaining page", false),
        ],
    )
    .await;
    let deleted = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO "Document" (id,name,owner,"fileType","deletedAt") VALUES ($1,'Deleted page',$2,'md',NOW())"#,
        deleted.to_string(), owner.as_ref()).execute(&pool).await.unwrap();
    repo.claim_importing(&owner, &[imports[0]], &[], None)
        .await
        .unwrap();
    repo.mark_imported(&owner, imports[0], &deleted.to_string(), "md", None)
        .await
        .unwrap();
    planned(&repo, &owner).await;
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer {
        target_pool: Some(pool.clone()),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(CancellationToken::new(), tracker.clone());
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&owner).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Completed));
    assert_eq!(report.failures.len(), 1);
    let remaining = repo.get(&owner, imports[1]).await.unwrap().unwrap();
    assert_eq!(remaining.status, ImportStatus::Imported);
    assert_eq!(writer.documents.lock().unwrap().len(), 1);
    assert!(
        !writer.documents.lock().unwrap()[0]
            .2
            .pages
            .contains_key(&page_id('e'))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_finished_link_is_reported_instead_of_staying_already_imported(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "finished-link-owner", team).await;
    let importer = teammate(&pool, "finished-link-importer", team).await;
    let repo = PgImportRepo::new(pool.clone());
    let (review, imports) = approved(
        &pool,
        &importer,
        &[
            planned_page('e', "Deleted shared link", false),
            planned_page('f', "Remaining page", false),
        ],
    )
    .await;
    let deleted = Uuid::now_v7();
    sqlx::query!(r#"INSERT INTO "Document" (id,name,owner,"fileType","deletedAt") VALUES ($1,'Deleted shared copy',$2,'md',NOW())"#,
        deleted.to_string(), owner.as_ref()).execute(&pool).await.unwrap();
    let row = repo.get(&importer, imports[0]).await.unwrap().unwrap();
    let mut meta: NotionDocMeta = serde_json::from_value(row.metadata).unwrap();
    meta.plan.as_mut().unwrap().already_imported =
        Some(crate::domain::models::NotionAlreadyImported {
            by: "finished-link-owner@example.com".to_string(),
            entity_id: deleted.to_string(),
            entity_type: "md".to_string(),
        });
    sqlx::query!(
        "UPDATE import_entity SET metadata=$2 WHERE id=$1",
        imports[0],
        serde_json::to_value(meta).unwrap()
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.claim_importing(&importer, &[imports[0]], &[], None)
        .await
        .unwrap();
    repo.mark_imported(&importer, imports[0], &deleted.to_string(), "md", None)
        .await
        .unwrap();
    planned(&repo, &importer).await;
    let tracker = TaskTracker::new();
    let writer = Arc::new(Writer {
        target_pool: Some(pool.clone()),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        Arc::new(NoConnector),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected))
    .with_job_shutdown(CancellationToken::new(), tracker.clone());
    service
        .start_notion_write(&importer, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let report = service.notion_import_report(&importer).await.unwrap();
    assert_eq!(report.status, Some(RunStatus::Completed));
    assert_eq!(report.failures.len(), 1);
    assert_eq!(report.already_in_macro, 0);
    assert_eq!(
        repo.get(&importer, imports[1])
            .await
            .unwrap()
            .unwrap()
            .status,
        ImportStatus::Imported
    );
    assert_eq!(writer.documents.lock().unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teamless_shared_replacement_keeps_its_reviewed_verdict(pool: PgPool) {
    let owner = user("teamless-replacement");
    let repo = PgImportRepo::new(pool.clone());
    let (review, ids) = approved(&pool, &owner, &[planned_page('e', "Replacement", true)]).await;
    let row = repo.get(&owner, ids[0]).await.unwrap().unwrap();
    let mut meta: NotionDocMeta = serde_json::from_value(row.metadata).unwrap();
    meta.plan.as_mut().unwrap().already_imported =
        Some(crate::domain::models::NotionAlreadyImported {
            by: "former@example.com".into(),
            entity_id: Uuid::now_v7().to_string(),
            entity_type: "md".into(),
        });
    sqlx::query!(
        "UPDATE import_entity SET metadata = $2 WHERE id = $1",
        ids[0],
        serde_json::to_value(meta).unwrap()
    )
    .execute(&pool)
    .await
    .unwrap();
    planned(&repo, &owner).await;
    let tracker = TaskTracker::new();
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    );
    service
        .start_notion_write(&owner, review, NotionWriteChoices::default())
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;
    let imported = repo.get(&owner, ids[0]).await.unwrap().unwrap();
    assert_eq!(imported.status, ImportStatus::Imported);
    let meta: NotionDocMeta = serde_json::from_value(imported.metadata).unwrap();
    assert!(
        meta.plan.unwrap().shared,
        "team claim availability must not rewrite the reviewed verdict"
    );
}
