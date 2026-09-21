use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn column_label_roundtrip_preserves_other_placements_and_requires_current_version(
    pool: PgPool,
) {
    let (repo, mut table, definition_id) = fixture(&pool).await;
    let column = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    table.version = repo.table_versions(&[table.id]).await.unwrap()[&table.id];
    let other = applied_table(
        repo.create_table(&CreateTable {
            database_id: table.database_id,
            name: "Other".into(),
        })
        .await
        .unwrap(),
    );
    repo.create_column(
        other.id,
        definition_id,
        &CreateColumn {
            infer_type: false,
            table_id: other.id,
            binding: ColumnBinding::ExistingDefinition(definition_id),
            config: None,
        },
    )
    .await
    .unwrap();
    let renamed = repo
        .rename_column(&table, &column, "Task")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(renamed.table_version, TableVersion(table.version.0 + 1));
    assert_eq!(renamed.column.property_definition_id, definition_id);
    let stored = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    assert_eq!(stored.display_name.as_deref(), Some("Task"));
    assert!(
        repo.columns_for_tables(&[other.id]).await.unwrap()[0]
            .display_name
            .is_none()
    );
    assert!(
        repo.rename_column(&table, &column, "Stale")
            .await
            .unwrap()
            .is_none()
    );
    table.version = renamed.table_version;
    // Matching table version alone does not authorize overwriting an old label.
    assert!(
        repo.rename_column(&table, &column, "Wrong previous")
            .await
            .unwrap()
            .is_none()
    );
    let next = repo
        .rename_column(&table, &stored, "Work item")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(next.column.display_name.as_deref(), Some("Work item"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_column_renames_have_exactly_one_winner(pool: PgPool) {
    let (repo, mut table, _) = fixture(&pool).await;
    let column = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    table.version = repo.table_versions(&[table.id]).await.unwrap()[&table.id];
    let (first, second) = tokio::join!(
        repo.rename_column(&table, &column, "Task"),
        repo.rename_column(&table, &column, "Work item")
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert_ne!(first.is_some(), second.is_some());
    let winner = first.or(second).unwrap();
    let stored = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    assert_eq!(stored.display_name, winner.column.display_name);
    assert_eq!(
        repo.table_versions(&[table.id]).await.unwrap()[&table.id],
        TableVersion(table.version.0 + 1)
    );
    repo.trash_database(table.database_id, chrono::Utc::now())
        .await
        .unwrap();
    table.version = winner.table_version;
    assert!(
        repo.rename_column(&table, &stored, "Hidden")
            .await
            .unwrap()
            .is_none()
    );
}
