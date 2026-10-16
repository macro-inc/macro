use models_properties::service::property_value::PropertyValue;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use std::collections::BTreeMap;

use super::*;
use crate::domain::ports::CellStore;
use crate::domain::transfer::{
    DatabaseTransferRepo, ImportFingerprint, ImportOutcome, ImportTable,
};
use crate::outbound::pg_cell_store::{PgCellStore, PgCellStoreError};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_import_records_initial_values_in_history(pool: PgPool) {
    let (repo, existing, name) = fixture(&pool).await;
    let postal_code = insert_definition(&pool, "Postal code").await;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let request = ImportTable {
        request_id: macro_uuid::generate_uuid_v7(),
        name: "Imported contacts".into(),
        columns: vec!["Name".into(), "Postal code".into()],
        rows: vec![
            vec!["Ada,\"Lovelace\"\nsecond line".into(), "00123".into()],
            vec![String::new(), String::new()],
        ],
    };
    let ImportOutcome::Created(table) = store
        .import_table(
            existing.database_id,
            &viewer(),
            &request,
            &ImportFingerprint("history".into()),
            &[name, postal_code],
            &[
                vec![
                    (name, PropertyValue::Str(request.rows[0][0].clone())),
                    (postal_code, PropertyValue::Str("00123".into())),
                ],
                vec![],
            ],
        )
        .await
        .unwrap()
    else {
        panic!("the import should create a table")
    };
    let columns = repo.columns_for_tables(&[table.id]).await.unwrap();
    let rows = repo.row_refs(table.id).await.unwrap();
    assert_eq!(columns.len(), 2);
    assert_eq!(rows.len(), 2);
    for (index, row) in rows.iter().enumerate() {
        let changes = repo
            .row_history(table.database_id, table.id, row.id)
            .await
            .unwrap();
        let history = crate::domain::journal::row_history(row.id, changes);
        assert_eq!(history.len(), 1);
        assert_eq!(
            history[0].kind,
            crate::domain::journal::RowChangeKind::Insert
        );
        assert!(history[0].before.is_empty());
        let expected = if index == 0 {
            BTreeMap::from([
                (
                    columns[0].id,
                    models_databases::CellValue::Text(request.rows[0][0].clone()),
                ),
                (
                    columns[1].id,
                    models_databases::CellValue::Text("00123".into()),
                ),
            ])
        } else {
            BTreeMap::new()
        };
        assert_eq!(history[0].after, expected);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imports_are_atomic_and_retries_do_not_duplicate_rows(pool: PgPool) {
    let (repo, existing, definition) = fixture(&pool).await;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let request = ImportTable {
        request_id: macro_uuid::generate_uuid_v7(),
        name: "CSV contacts".into(),
        columns: vec!["Name".into()],
        rows: vec![vec!["00123".into()], vec!["a,\"b\nsecond line".into()]],
    };
    let same = ImportFingerprint("same".into());
    let cells = vec![
        vec![(definition, PropertyValue::Str("00123".into()))],
        vec![(definition, PropertyValue::Str("a,\"b\nsecond line".into()))],
    ];
    let ImportOutcome::Created(table) = store
        .import_table(
            existing.database_id,
            &viewer(),
            &request,
            &same,
            &[definition],
            &cells,
        )
        .await
        .unwrap()
    else {
        panic!("first import should create")
    };
    let rows: Vec<RowId> = repo
        .row_refs(table.id)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect();
    assert_eq!(rows.len(), 2);
    let stored = store.cells(&rows).await.unwrap();
    assert_eq!(
        stored[&rows[0]][&definition],
        PropertyValue::Str("00123".into())
    );
    assert_eq!(
        stored[&rows[1]][&definition],
        PropertyValue::Str("a,\"b\nsecond line".into())
    );
    let ImportOutcome::Replayed(replayed) = store
        .import_table(
            existing.database_id,
            &viewer(),
            &request,
            &same,
            &[definition],
            &cells,
        )
        .await
        .unwrap()
    else {
        panic!("retry should replay")
    };
    assert_eq!(replayed.id, table.id);
    assert_eq!(repo.row_refs(table.id).await.unwrap().len(), 2);
    assert!(matches!(
        store
            .import_table(
                existing.database_id,
                &viewer(),
                &request,
                &ImportFingerprint("changed".into()),
                &[definition],
                &cells,
            )
            .await
            .unwrap(),
        ImportOutcome::KeyConflict
    ));
    let another = ImportTable {
        request_id: macro_uuid::generate_uuid_v7(),
        ..request.clone()
    };
    assert!(matches!(
        store
            .import_table(
                existing.database_id,
                &viewer(),
                &another,
                &same,
                &[definition],
                &cells,
            )
            .await
            .unwrap(),
        ImportOutcome::NameConflict
    ));
    let (imported, fingerprint) = store
        .imported_table(existing.database_id, request.request_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(imported.id, table.id);
    assert_eq!(fingerprint, same);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_import_rolls_back_table_columns_and_all_rows(pool: PgPool) {
    let (repo, existing, _) = fixture(&pool).await;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let request = ImportTable {
        request_id: macro_uuid::generate_uuid_v7(),
        name: "Rejected import".into(),
        columns: vec!["Name".into()],
        rows: vec![vec!["valid".into()], vec!["also valid".into()]],
    };
    // A definition that does not exist: the column insert violates its
    // foreign key after the table row is already in the transaction.
    let missing_definition = macro_uuid::generate_uuid_v7();
    let error = store
        .import_table(
            existing.database_id,
            &viewer(),
            &request,
            &ImportFingerprint("request".into()),
            &[missing_definition],
            &[
                vec![(missing_definition, PropertyValue::Str("valid".into()))],
                vec![(missing_definition, PropertyValue::Str("also valid".into()))],
            ],
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        PgCellStoreError::Sqlx(sqlx::Error::Database(_))
    ));
    assert!(
        store
            .imported_table(existing.database_id, request.request_id)
            .await
            .unwrap()
            .is_none()
    );
    let (_, tables) = repo
        .get_database(existing.database_id)
        .await
        .unwrap()
        .unwrap();
    assert!(!tables.iter().any(|table| table.name == request.name));
}
