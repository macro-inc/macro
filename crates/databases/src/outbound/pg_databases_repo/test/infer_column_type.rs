use super::*;

async fn inference_fixture(pool: &PgPool) -> (PgDatabasesRepo, Table, Column, Uuid) {
    let (repo, mut table, old) = fixture(pool).await;
    let old_column = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    sqlx::query!(
        "UPDATE database_columns SET infer_type = TRUE WHERE id = $1",
        old_column.id
    )
    .execute(pool)
    .await
    .unwrap();
    let column = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    let replacement = insert_definition(pool, "Replacement").await;
    assert_eq!(column.property_definition_id, old);
    table.version = repo.table_versions(&[table.id]).await.unwrap()[&table.id];
    (repo, table, column, replacement)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_inference_has_one_winner_and_preserves_column_identity(pool: PgPool) {
    let (repo, table, column, replacement) = inference_fixture(&pool).await;
    let second = insert_definition(&pool, "Second replacement").await;
    let (a, b) = tokio::join!(
        repo.infer_column_type(&table, &column, replacement),
        repo.infer_column_type(&table, &column, second)
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_ne!(a.is_some(), b.is_some());
    assert_eq!(a.or(b), Some(TableVersion(table.version.0 + 1)));
    let stored = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    assert_eq!(stored.id, column.id);
    assert_eq!(stored.position, column.position);
    assert_eq!(
        stored.property_definition_id,
        if a.is_some() { replacement } else { second }
    );
    assert!(!stored.infer_type);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inference_and_first_write_serialize_on_the_same_version(pool: PgPool) {
    let (repo, table, column, replacement) = inference_fixture(&pool).await;
    let changes = [RowChange::Insert {
        row_id: Uuid::now_v7(),
        table_id: table.id,
        cells: HashMap::from([(
            column.property_definition_id,
            SetPropertyValue::String {
                value: "text".into(),
            },
        )]),
    }];
    let versions = HashMap::from([(table.id, table.version)]);
    let actor = viewer();
    let (inferred, write) = tokio::join!(
        repo.infer_column_type(&table, &column, replacement),
        repo.apply_changes(&actor, &changes, &versions)
    );
    let inferred = inferred.unwrap();
    let write = write.unwrap();
    assert_eq!(
        inferred.is_some(),
        matches!(write, ApplyOutcome::VersionConflict { .. })
    );
    let stored = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    assert!(!stored.infer_type);
    let rows = repo.fetch_rows(table.id, 10).await.unwrap();
    if inferred.is_some() {
        assert!(rows.is_empty());
        assert_eq!(stored.property_definition_id, replacement);
    } else {
        assert_eq!(rows.len(), 1);
        assert_eq!(stored.property_definition_id, column.property_definition_id);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn nonempty_column_is_never_rebound_even_with_current_version_and_inference_flag(
    pool: PgPool,
) {
    let (repo, mut table, column, replacement) = inference_fixture(&pool).await;
    repo.apply_changes(
        &viewer(),
        &[RowChange::Insert {
            row_id: Uuid::now_v7(),
            table_id: table.id,
            cells: HashMap::from([(
                column.property_definition_id,
                SetPropertyValue::String {
                    value: "keep".into(),
                },
            )]),
        }],
        &HashMap::from([(table.id, table.version)]),
    )
    .await
    .unwrap();
    assert!(!repo.columns_for_tables(&[table.id]).await.unwrap()[0].infer_type);
    // Simulate a legacy/imported placement that still advertises inference.
    sqlx::query!(
        "UPDATE database_columns SET infer_type = TRUE WHERE id = $1",
        column.id
    )
    .execute(&pool)
    .await
    .unwrap();
    table.version = repo.table_versions(&[table.id]).await.unwrap()[&table.id];
    assert!(
        repo.infer_column_type(&table, &column, replacement)
            .await
            .unwrap()
            .is_none()
    );
    let stored = repo
        .columns_for_tables(&[table.id])
        .await
        .unwrap()
        .remove(0);
    assert_eq!(stored.property_definition_id, column.property_definition_id);
    assert_eq!(
        repo.table_versions(&[table.id]).await.unwrap()[&table.id],
        table.version
    );
    assert_eq!(repo.fetch_rows(table.id, 10).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn empty_row_and_null_cell_do_not_settle_but_first_update_does(pool: PgPool) {
    let (repo, table, column, _) = inference_fixture(&pool).await;
    let created = repo
        .apply_changes(
            &viewer(),
            &[RowChange::Insert {
                row_id: Uuid::now_v7(),
                table_id: table.id,
                cells: HashMap::new(),
            }],
            &HashMap::new(),
        )
        .await
        .unwrap();
    let ApplyOutcome::Applied(applied) = created else {
        panic!("insert succeeds")
    };
    let row_id = applied.0[0];
    repo.apply_changes(
        &viewer(),
        &[RowChange::Update {
            table_id: table.id,
            row_id,
            cells: HashMap::from([(column.property_definition_id, None)]),
        }],
        &HashMap::new(),
    )
    .await
    .unwrap();
    assert!(repo.columns_for_tables(&[table.id]).await.unwrap()[0].infer_type);
    repo.apply_changes(
        &viewer(),
        &[RowChange::Update {
            table_id: table.id,
            row_id,
            cells: HashMap::from([(
                column.property_definition_id,
                Some(SetPropertyValue::String {
                    value: "hello".into(),
                }),
            )]),
        }],
        &HashMap::new(),
    )
    .await
    .unwrap();
    assert!(!repo.columns_for_tables(&[table.id]).await.unwrap()[0].infer_type);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn blind_write_preserves_last_write_wins_but_rejects_a_rebound_definition(pool: PgPool) {
    let (repo, table, column, replacement) = inference_fixture(&pool).await;
    repo.infer_column_type(&table, &column, replacement)
        .await
        .unwrap()
        .unwrap();
    let stale = repo
        .apply_changes(
            &viewer(),
            &[RowChange::Insert {
                row_id: Uuid::now_v7(),
                table_id: table.id,
                cells: HashMap::from([(
                    column.property_definition_id,
                    SetPropertyValue::String {
                        value: "stale".into(),
                    },
                )]),
            }],
            &HashMap::new(),
        )
        .await
        .unwrap();
    assert!(matches!(stale, ApplyOutcome::VersionConflict { table_id } if table_id == table.id));
    assert!(repo.fetch_rows(table.id, 10).await.unwrap().is_empty());
    let created = repo
        .apply_changes(
            &viewer(),
            &[RowChange::Insert {
                row_id: Uuid::now_v7(),
                table_id: table.id,
                cells: HashMap::from([(
                    replacement,
                    SetPropertyValue::String {
                        value: "current".into(),
                    },
                )]),
            }],
            &HashMap::new(),
        )
        .await
        .unwrap()
        .applied()
        .unwrap();
    let row_id = created.0[0];
    for value in ["first writer", "last writer"] {
        repo.apply_changes(
            &viewer(),
            &[RowChange::Update {
                table_id: table.id,
                row_id,
                cells: HashMap::from([(
                    replacement,
                    Some(SetPropertyValue::String {
                        value: value.into(),
                    }),
                )]),
            }],
            &HashMap::new(),
        )
        .await
        .unwrap()
        .applied()
        .unwrap();
    }
    let rows = repo.fetch_rows(table.id, 10).await.unwrap();
    assert!(
        matches!(&rows[0].cells[&replacement], PropertyValue::Str(value) if value == "last writer")
    );
}
