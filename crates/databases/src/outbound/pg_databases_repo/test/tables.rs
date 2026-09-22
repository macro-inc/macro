use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn table_mutations_wait_for_trash_and_return_not_found(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let version = repo.table_versions(&[table.id]).await.unwrap()[&table.id];
    let mut trash = pool.begin().await.unwrap();
    sqlx::query!(
        "UPDATE databases SET trashed_at = now() WHERE id = $1",
        table.database_id,
    )
    .execute(&mut *trash)
    .await
    .unwrap();
    let command = CreateTable {
        database_id: table.database_id,
        name: "Blocked".into(),
    };
    let mut writes = std::pin::pin!(async {
        tokio::join!(
            repo.create_table(&command),
            repo.rename_table(&table, "Blocked rename", "Guests"),
        )
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut writes)
            .await
            .is_err(),
        "table writes must wait for the concurrent parent mutation"
    );
    trash.commit().await.unwrap();
    let (created, renamed) = writes.await;
    assert!(matches!(created.unwrap(), TableMutationOutcome::NotFound));
    assert!(matches!(renamed.unwrap(), TableMutationOutcome::NotFound));
    let (database, tables) = repo.get_database(table.database_id).await.unwrap().unwrap();
    assert!(database.trashed_at.is_some());
    assert_eq!(tables.len(), 2);
    let unchanged = tables
        .iter()
        .find(|candidate| candidate.id == table.id)
        .unwrap();
    assert_eq!(unchanged.name, "Guests");
    assert_eq!(unchanged.version, version);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_parent_is_not_a_name_conflict_or_storage_error(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    repo.delete_database(table.database_id).await.unwrap();
    assert!(matches!(
        repo.create_table(&CreateTable {
            database_id: table.database_id,
            name: "Missing".into(),
        })
        .await
        .unwrap(),
        TableMutationOutcome::NotFound
    ));
    assert!(matches!(
        repo.rename_table(&table, "Missing", "Guests")
            .await
            .unwrap(),
        TableMutationOutcome::NotFound
    ));
}
