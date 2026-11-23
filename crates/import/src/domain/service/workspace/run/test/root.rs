//! The host writer replaces a deleted root and the ledger remembers its replacement.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_trashed_root_is_recreated_once_by_the_host_writer(pool: PgPool) {
    let owner = user("root-trash");
    let macro_user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        macro_user,
        "root-trash",
        "root-trash@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'root-trash@example.com', $2)"#,
        owner.as_ref(), macro_user,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgImportRepo::new(pool.clone());
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let root = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId", "deletedAt") VALUES ($1, 'Notion', $2, NOW())"#,
        root.to_string(), owner.as_ref(),
    ).execute(&pool).await.unwrap();
    repo.set_root_folder(&owner, root).await.unwrap();
    let writer = Arc::new(Writer {
        folder_pool: Some(pool.clone()),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        no_connections(),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected));

    let replacement = service.root_folder(&owner).await.unwrap();

    assert_ne!(replacement, root);
    assert_eq!(repo.root_folder(&owner).await.unwrap(), Some(replacement));
    assert_eq!(service.root_folder(&owner).await.unwrap(), replacement);
    assert_eq!(*writer.folders.lock().unwrap(), vec!["Notion"]);
    assert!(
        sqlx::query_scalar!(
            r#"SELECT "deletedAt" IS NOT NULL AS "trashed!" FROM "Project" WHERE id = $1"#,
            root.to_string()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "re-import leaves the old copy in trash"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_purged_root_is_recreated_once_by_the_host_writer(pool: PgPool) {
    let owner = user("root-purge");
    let macro_user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        macro_user,
        "root-purge",
        "root-purge@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'root-purge@example.com', $2)"#,
        owner.as_ref(), macro_user,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgImportRepo::new(pool.clone());
    repo.start_run(&owner, ImportSource::Notion, &[])
        .await
        .unwrap();
    let root = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Notion', $2)"#,
        root.to_string(),
        owner.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.set_root_folder(&owner, root).await.unwrap();
    sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, root.to_string())
        .execute(&pool)
        .await
        .unwrap();
    let writer = Arc::new(Writer {
        folder_pool: Some(pool.clone()),
        ..Default::default()
    });
    let service = ImportServiceImpl::new(
        repo.clone(),
        no_connections(),
        Arc::clone(&writer),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_notion_connections(Arc::new(Connected));

    let replacement = service.root_folder(&owner).await.unwrap();

    assert_ne!(replacement, root);
    assert_eq!(repo.root_folder(&owner).await.unwrap(), Some(replacement));
    assert_eq!(service.root_folder(&owner).await.unwrap(), replacement);
    assert_eq!(*writer.folders.lock().unwrap(), vec!["Notion"]);
}
