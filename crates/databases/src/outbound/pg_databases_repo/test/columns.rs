use super::*;
use chrono::Utc;
use models_properties::service::property_value::PropertyValue;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn column_replacement_preserves_shared_definition_and_other_table_cells(pool: PgPool) {
    let (repo, mut table, old) = fixture(&pool).await;
    let column = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    let other = repo
        .create_table(&CreateTable {
            database_id: table.database_id,
            name: "Other".into(),
        })
        .await
        .unwrap()
        .unwrap();
    repo.create_column(
        other.id,
        old,
        &CreateColumn {
            table_id: other.id,
            infer_type: false,
            binding: ColumnBinding::ExistingDefinition(old),
            config: None,
        },
    )
    .await
    .unwrap();
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    let versions = repo.table_versions(&[table.id, other.id]).await.unwrap();
    repo.apply_changes(
        &viewer(),
        &[
            RowChange::Insert {
                row_id: first,
                table_id: table.id,
                cells: cells(vec![(old, text("2"))]),
            },
            RowChange::Insert {
                row_id: second,
                table_id: other.id,
                cells: cells(vec![(old, text("other"))]),
            },
        ],
        &versions,
    )
    .await
    .unwrap();
    table.version = repo.table_versions(&[table.id]).await.unwrap()[&table.id];
    let new_id = insert_definition(&pool, "New definition").await;
    let replacement = ColumnReplacement {
        column: column.clone(),
        definition_id: new_id,
        config: None,
        values: vec![(first, PropertyValue::Num(2.0))],
    };
    let version = repo
        .replace_column(&table, &replacement)
        .await
        .unwrap()
        .unwrap();
    let stored = repo.fetch_rows(table.id, 10).await.unwrap().remove(0);
    assert_eq!(stored.cells[&new_id], PropertyValue::Num(2.0));
    assert!(!stored.cells.contains_key(&old));
    assert_eq!(
        repo.fetch_rows(other.id, 10).await.unwrap()[0].cells[&old],
        PropertyValue::Str("other".into())
    );
    assert_eq!(
        repo.columns_for_tables(&[other.id]).await.unwrap()[0].property_definition_id,
        old
    );
    assert_eq!(version, TableVersion(table.version.0 + 1));
    assert!(
        repo.replace_column(&table, &replacement)
            .await
            .unwrap()
            .is_none()
    );
    table.version = version;
    let current = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    repo.delete_column(&table, &current).await.unwrap().unwrap();
    assert!(
        repo.columns_for_tables(&[table.id])
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.fetch_rows(table.id, 10).await.unwrap()[0]
            .cells
            .is_empty()
    );
    assert_eq!(
        repo.fetch_rows(other.id, 10).await.unwrap()[0].cells[&old],
        PropertyValue::Str("other".into())
    );
    // Definitions belong to the properties domain and are never erased by placement deletion.
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM property_definitions WHERE id = ANY($1)",
            &[old, new_id]
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(2)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_column_delete_and_reorder_have_one_winner(pool: PgPool) {
    let (repo, mut table, _) = fixture(&pool).await;
    let column = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    table.version = repo.table_versions(&[table.id]).await.unwrap()[&table.id];
    let ids = [column.id];
    let (deleted, reordered) = tokio::join!(
        repo.delete_column(&table, &column),
        repo.reorder_columns(&table, &ids)
    );
    let deleted = deleted.unwrap();
    let reordered = reordered.unwrap();
    assert_ne!(deleted.is_some(), reordered.is_some());
    assert_eq!(
        repo.table_versions(&[table.id]).await.unwrap()[&table.id],
        TableVersion(table.version.0 + 1)
    );
    repo.trash_database(table.database_id, Utc::now())
        .await
        .unwrap();
    table.version.0 += 1;
    assert!(repo.delete_column(&table, &column).await.unwrap().is_none());
    assert!(repo.reorder_columns(&table, &ids).await.unwrap().is_none());
}
