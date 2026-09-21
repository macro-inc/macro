use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_links_limits_results_in_postgres(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let definition = insert_definition(&pool, "Related").await;
    let column = repo
        .create_column(
            table.id,
            definition,
            &CreateColumn {
                infer_type: false,
                table_id: table.id,
                binding: ColumnBinding::ExistingDefinition(definition),
                config: Some(ColumnConfig::Link {
                    database_id: table.database_id,
                    table_id: table.id,
                }),
            },
        )
        .await
        .unwrap();
    let inserts: Vec<_> = (0..3)
        .map(|_| RowChange::Insert {
            row_id: Uuid::now_v7(),
            table_id: table.id,
            cells: HashMap::new(),
        })
        .collect();
    let (rows, _) = repo
        .apply_changes(&viewer(), &inserts, &HashMap::new())
        .await
        .unwrap()
        .applied()
        .unwrap();
    let edges = [(rows[0], rows[1]), (rows[1], rows[2]), (rows[2], rows[0])];
    let changes: Vec<_> = edges
        .iter()
        .map(|&(source_row_id, target_row_id)| RowChange::Link {
            column_id: column,
            source_row_id,
            target_row_id,
        })
        .collect();
    repo.apply_changes(&viewer(), &changes, &HashMap::new())
        .await
        .unwrap()
        .applied()
        .unwrap();

    for limit in 0..=4 {
        let fetched = repo.fetch_links(column, limit).await.unwrap();
        assert_eq!(fetched.len(), limit.min(edges.len()));
        assert!(fetched.iter().all(|edge| edges.contains(edge)));
    }
    assert!(
        repo.fetch_links(Uuid::now_v7(), 1)
            .await
            .unwrap()
            .is_empty()
    );
}
