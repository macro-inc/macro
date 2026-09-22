use super::*;
use crate::domain::transfer::{DatabaseTransferRepo, ImportOutcome, ImportTable};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imports_are_atomic_and_retries_do_not_duplicate_rows(pool: PgPool) {
    let (repo, existing, definition) = fixture(&pool).await;
    let request = ImportTable {
        request_id: macro_uuid::generate_uuid_v7(),
        name: "CSV contacts".into(),
        columns: vec!["Name".into()],
        rows: vec![vec!["00123".into()], vec!["a,\"b\nsecond line".into()]],
    };
    let ImportOutcome::Created(table) = repo
        .import_table(
            existing.database_id,
            &viewer(),
            &request,
            "same",
            &[definition],
        )
        .await
        .unwrap()
    else {
        panic!("first import should create")
    };
    assert_eq!(repo.fetch_rows(table.id, 10).await.unwrap().len(), 2);
    let ImportOutcome::Replayed(replayed) = repo
        .import_table(
            existing.database_id,
            &viewer(),
            &request,
            "same",
            &[definition],
        )
        .await
        .unwrap()
    else {
        panic!("retry should replay")
    };
    assert_eq!(replayed.id, table.id);
    assert_eq!(repo.fetch_rows(table.id, 10).await.unwrap().len(), 2);
    assert!(matches!(
        repo.import_table(
            existing.database_id,
            &viewer(),
            &request,
            "changed",
            &[definition]
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
        repo.import_table(
            existing.database_id,
            &viewer(),
            &another,
            "same",
            &[definition]
        )
        .await
        .unwrap(),
        ImportOutcome::NameConflict
    ));
    let rows = repo.fetch_rows(table.id, 10).await.unwrap();
    assert_eq!(
        rows[0].cells[&definition],
        models_properties::service::property_value::PropertyValue::Str("00123".into())
    );
    assert_eq!(
        repo.imported_table(existing.database_id, request.request_id)
            .await
            .unwrap()
            .unwrap()
            .0
            .id,
        table.id
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_import_rolls_back_table_columns_and_all_rows(pool: PgPool) {
    let (repo, existing, definition) = fixture(&pool).await;
    let request = ImportTable {
        request_id: macro_uuid::generate_uuid_v7(),
        name: "Rejected import".into(),
        columns: vec!["Name".into()],
        rows: vec![vec!["valid".into()], vec!["invalid\0postgres text".into()]],
    };
    assert!(
        repo.import_table(
            existing.database_id,
            &viewer(),
            &request,
            "request",
            &[definition]
        )
        .await
        .is_err()
    );
    assert!(
        repo.imported_table(existing.database_id, request.request_id)
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
