use super::*;

const FOLDER: &str = "0190f5a0-0000-7000-8000-000000000001";
const SUBFOLDER: &str = "0190f5a0-0000-7000-8000-000000000002";

/// A folder shared with a channel, and a subfolder inside it.
async fn shared_folders(pool: &PgPool) {
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Clients', $3), ($2, 'Acme', $3)"#,
        FOLDER,
        SUBFOLDER,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE "Project" SET "parentId" = $1 WHERE id = $2"#,
        FOLDER,
        SUBFOLDER
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'project', 'channel-1', 'channel', 'view')",
        Uuid::parse_str(FOLDER).unwrap(),
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn grants(pool: &PgPool, database_id: DatabaseId) -> Vec<(String, Option<String>)> {
    sqlx::query!(
        "SELECT source_id, granted_from_project_id FROM entity_access WHERE entity_id = $1 AND entity_type = 'database' ORDER BY source_id",
        database_id.into_uuid(),
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.source_id, row.granted_from_project_id))
    .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_database_in_a_folder_holds_the_grants_of_every_folder_above_it(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    shared_folders(&pool).await;
    let database_id = table.database_id;

    assert!(
        repo.move_database(database_id, Some(SUBFOLDER))
            .await
            .unwrap()
    );
    let (database, _) = repo.get_database(database_id).await.unwrap().unwrap();
    assert_eq!(database.project_id.as_deref(), Some(SUBFOLDER));
    assert_eq!(
        grants(&pool, database_id).await,
        vec![
            ("channel-1".to_string(), Some(FOLDER.to_string())),
            (USER.to_string(), None),
        ]
    );

    assert!(repo.move_database(database_id, None).await.unwrap());
    let (database, _) = repo.get_database(database_id).await.unwrap().unwrap();
    assert_eq!(database.project_id, None);
    assert_eq!(
        grants(&pool, database_id).await,
        vec![(USER.to_string(), None)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_trashed_or_missing_database_stays_where_it_was(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    shared_folders(&pool).await;
    let database_id = table.database_id;
    repo.trash_database(database_id, chrono::Utc::now())
        .await
        .unwrap();

    assert!(!repo.move_database(database_id, Some(FOLDER)).await.unwrap());
    assert!(
        !repo
            .move_database(DatabaseId::from_uuid(Uuid::nil()), Some(FOLDER))
            .await
            .unwrap()
    );
    let (database, _) = repo.get_database(database_id).await.unwrap().unwrap();
    assert_eq!(database.project_id, None);
    assert_eq!(
        grants(&pool, database_id).await,
        vec![(USER.to_string(), None)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn purging_its_folder_returns_a_database_to_the_root(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    shared_folders(&pool).await;
    let database_id = table.database_id;
    repo.move_database(database_id, Some(SUBFOLDER))
        .await
        .unwrap();

    sqlx::query!(r#"DELETE FROM "Project" WHERE id = $1"#, SUBFOLDER)
        .execute(&pool)
        .await
        .unwrap();

    let (database, _) = repo.get_database(database_id).await.unwrap().unwrap();
    assert_eq!(database.project_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn trashing_its_folder_returns_a_database_to_the_root_without_its_grants(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    shared_folders(&pool).await;
    let database_id = table.database_id;
    repo.move_database(database_id, Some(SUBFOLDER))
        .await
        .unwrap();

    PgDatabaseFolders::new(pool.clone())
        .unfile_from_projects(&[SUBFOLDER.to_string()])
        .await
        .unwrap();

    let (database, _) = repo.get_database(database_id).await.unwrap().unwrap();
    assert_eq!(database.project_id, None);
    assert_eq!(
        grants(&pool, database_id).await,
        vec![(USER.to_string(), None)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn trashing_another_folder_leaves_a_database_filed(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    shared_folders(&pool).await;
    let database_id = table.database_id;
    repo.move_database(database_id, Some(SUBFOLDER))
        .await
        .unwrap();

    PgDatabaseFolders::new(pool.clone())
        .unfile_from_projects(&[FOLDER.to_string()])
        .await
        .unwrap();

    let (database, _) = repo.get_database(database_id).await.unwrap().unwrap();
    assert_eq!(database.project_id.as_deref(), Some(SUBFOLDER));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn moving_a_database_marks_the_folders_it_left_and_joined_edited(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    shared_folders(&pool).await;
    let database_id = table.database_id;
    let long_ago = chrono::DateTime::parse_from_rfc3339("2020-01-01T00:00:00Z")
        .unwrap()
        .naive_utc();
    let reset = || async {
        sqlx::query!(r#"UPDATE "Project" SET "updatedAt" = $1"#, long_ago)
            .execute(&pool)
            .await
            .unwrap();
    };
    let edited = || async {
        sqlx::query_scalar!(
            r#"SELECT id FROM "Project" WHERE "updatedAt" > $1 ORDER BY id"#,
            long_ago
        )
        .fetch_all(&pool)
        .await
        .unwrap()
    };

    reset().await;
    repo.move_database(database_id, Some(FOLDER)).await.unwrap();
    assert_eq!(edited().await, vec![FOLDER.to_string()]);

    reset().await;
    repo.move_database(database_id, Some(SUBFOLDER))
        .await
        .unwrap();
    assert_eq!(
        edited().await,
        vec![FOLDER.to_string(), SUBFOLDER.to_string()]
    );

    reset().await;
    repo.move_database(database_id, None).await.unwrap();
    assert_eq!(edited().await, vec![SUBFOLDER.to_string()]);
}
