//! Required cells are enforced by both Rust write entry points, without SQL triggers.

use super::*;
use crate::domain::ports::DatabaseStorage;
use models_properties::service::property_value::PropertyValue;

fn batch(database_id: DatabaseId, writes: Vec<Write>) -> Writes {
    Writes {
        database_id,
        created_by: user(),
        writes,
        related_rows: vec![],
        expected_versions: vec![],
        journal: crate::domain::journal::JournalPlan::default(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn required_cells_are_checked_for_app_and_core_writes(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let definition = insert_definition(&pool, "Required").await;
    let position =
        models_databases::position::key_between(Some(&"80".parse().unwrap()), None).unwrap();
    let mut create = bind(table.id, definition, position.as_str());
    let Write::CreateColumn { column, .. } = &mut create else {
        unreachable!()
    };
    column.nullable = false;
    let column_id = column.id;
    commit(&pool, table.database_id, vec![create]).await;
    assert!(
        !repo
            .columns_for_tables(&[table.id])
            .await
            .unwrap()
            .iter()
            .find(|c| c.id == column_id)
            .unwrap()
            .nullable
    );
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    for core in [false, true] {
        let missing = batch(
            table.database_id,
            vec![Write::InsertRows {
                table_id: table.id,
                rows: vec![vec![]],
                restored: vec![],
            }],
        );
        let outcome = if core {
            store.apply_storage_writes(&missing).await
        } else {
            store.apply_writes(&missing).await
        }
        .unwrap();
        assert!(
            matches!(outcome, WritesOutcome::MissingRequiredCell { column, .. } if column == column_id)
        );
    }
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM database_rows WHERE table_id = $1",
            table.id.into_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    let inserted = store
        .apply_storage_writes(&batch(
            table.database_id,
            vec![Write::InsertRows {
                table_id: table.id,
                rows: vec![vec![(definition, PropertyValue::Str(String::new()))]],
                restored: vec![],
            }],
        ))
        .await
        .unwrap();
    let WritesOutcome::Applied {
        inserted,
        table_versions,
        ..
    } = inserted
    else {
        panic!("{inserted:?}")
    };
    let row = inserted[0][0];
    for value in [
        None,
        Some(PropertyValue::SelectOption(vec![])),
        Some(PropertyValue::EntityRef(vec![])),
        Some(PropertyValue::Link(vec![])),
    ] {
        let outcome = store
            .apply_storage_writes(&batch(
                table.database_id,
                vec![Write::UpdateRows {
                    table_id: table.id,
                    rows: vec![(row, vec![(definition, value)])],
                }],
            ))
            .await
            .unwrap();
        assert_eq!(
            outcome,
            WritesOutcome::MissingRequiredCell {
                write: 0,
                column: column_id,
                row
            }
        );
    }
    assert_eq!(
        repo.table_versions(&[table.id]).await.unwrap(),
        table_versions
    );
    assert_eq!(
        store.cells(&[row]).await.unwrap()[&row][&definition],
        PropertyValue::Str(String::new())
    );
    // A batch may temporarily clear a value if its final state is valid.
    let outcome = store
        .apply_storage_writes(&batch(
            table.database_id,
            vec![
                Write::UpdateRows {
                    table_id: table.id,
                    rows: vec![(row, vec![(definition, None)])],
                },
                Write::UpdateRows {
                    table_id: table.id,
                    rows: vec![(
                        row,
                        vec![(definition, Some(PropertyValue::Str("Restored".into())))],
                    )],
                },
            ],
        ))
        .await
        .unwrap();
    assert!(matches!(outcome, WritesOutcome::Applied { .. }));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn adding_a_required_column_requires_values_for_existing_rows_in_the_same_batch(
    pool: PgPool,
) {
    let (repo, table, _) = fixture(&pool).await;
    let row = repo.insert_rows(table.id, USER, 1).await.unwrap().unwrap()[0].id;
    let definition = insert_definition(&pool, "Required").await;
    let position =
        models_databases::position::key_between(Some(&"80".parse().unwrap()), None).unwrap();
    let mut create = bind(table.id, definition, position.as_str());
    let Write::CreateColumn { column, .. } = &mut create else {
        unreachable!()
    };
    column.nullable = false;
    let column_id = column.id;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let outcome = store
        .apply_storage_writes(&batch(table.database_id, vec![create.clone()]))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        WritesOutcome::MissingRequiredCell {
            write: 0,
            column: column_id,
            row
        }
    );
    assert!(
        !repo
            .columns_for_tables(&[table.id])
            .await
            .unwrap()
            .iter()
            .any(|c| c.id == column_id)
    );
    let outcome = store
        .apply_storage_writes(&batch(
            table.database_id,
            vec![
                create,
                Write::UpdateRows {
                    table_id: table.id,
                    rows: vec![(
                        row,
                        vec![(definition, Some(PropertyValue::Str("Present".into())))],
                    )],
                },
            ],
        ))
        .await
        .unwrap();
    assert!(matches!(outcome, WritesOutcome::Applied { .. }));
}
