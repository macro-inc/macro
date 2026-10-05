//! Storage without app metadata, and compatibility with deployed writers.

use super::*;
use crate::domain::journal::JournalPlan;
use crate::domain::models::NewDefinition;
use crate::domain::ports::DatabaseStorage;
use models_properties::service::property_value::PropertyValue;

const SPLIT_UP: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../macro_db_client/migrations/20261005183743_separate_database_entity.up.sql"
));
const SPLIT_DOWN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../macro_db_client/migrations/20261005183743_separate_database_entity.down.sql"
));

fn batch(database_id: DatabaseId, writes: Vec<Write>) -> Writes {
    Writes {
        database_id,
        created_by: user(),
        writes,
        related_rows: Vec::new(),
        expected_versions: Vec::new(),
        journal: JournalPlan::default(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn core_storage_supports_cells_and_versions_without_an_app_entity(pool: PgPool) {
    let properties = PropertiesPgRepo::new(pool.clone());
    let store = PgCellStore::new(pool.clone(), properties.clone());
    let repo = PgDatabasesRepo::new(pool.clone(), properties);
    // Storage allocation itself needs no user, entity or owner grant.
    let database = store.create_storage().await.unwrap();
    assert!(repo.get_database(database).await.unwrap().is_none());
    let app_rows = sqlx::query_scalar!(
        r#"SELECT (SELECT COUNT(*) FROM database_entity)
                 + (SELECT COUNT(*) FROM databases)
                 + (SELECT COUNT(*) FROM entity_access) AS "count!""#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(app_rows, 0);

    insert_user(&pool).await;
    let table = TableId::new();
    let definition = macro_uuid::generate_uuid_v7();
    let Write::CreateColumn { column, .. } = bind(table, definition, "80") else {
        unreachable!()
    };
    let writes = batch(
        database,
        vec![
            Write::CreateTable {
                table_id: table,
                name: "Contacts".into(),
            },
            Write::CreateColumn {
                column,
                definition: Some(NewDefinition {
                    id: definition,
                    name: "Name".into(),
                    data_type: DataType::String,
                    is_multi_select: false,
                    specific_entity_type: None,
                    options: Vec::new(),
                }),
            },
            Write::InsertRows {
                table_id: table,
                rows: vec![vec![(definition, PropertyValue::Str("Acme".into()))]],
                restored: Vec::new(),
            },
        ],
    );
    assert!(matches!(
        store.apply_writes(&writes, None).await.unwrap(),
        WritesOutcome::TableNotFound(_)
    ));
    let WritesOutcome::Applied {
        inserted,
        table_versions,
        ..
    } = store.apply_storage_writes(&writes).await.unwrap()
    else {
        panic!("a core database should support the same storage batch");
    };
    let row = inserted[2][0];
    assert_eq!(table_versions[&table], TableVersion(1));
    assert_eq!(
        store.cells(&[row]).await.unwrap()[&row][&definition],
        PropertyValue::Str("Acme".into())
    );

    let mut stale = batch(
        database,
        vec![Write::InsertRows {
            table_id: table,
            rows: vec![Vec::new()],
            restored: Vec::new(),
        }],
    );
    stale.expected_versions.push((table, TableVersion(0)));
    assert_eq!(
        store.apply_storage_writes(&stale).await.unwrap(),
        WritesOutcome::VersionConflict(table)
    );
    assert_eq!(repo.row_refs(table).await.unwrap().len(), 1);

    // The app lifecycle cannot delete a resource that has no app entity.
    repo.delete_database(database).await.unwrap();
    assert_eq!(
        repo.tables_for_databases(&[database]).await.unwrap().len(),
        1
    );
    store.delete_storage(database).await.unwrap();
    assert!(
        repo.tables_for_databases(&[database])
            .await
            .unwrap()
            .is_empty()
    );
    let cells = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_properties WHERE entity_id = $1 AND entity_type = 'DATABASE_ROW'", row.to_string()
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(cells, Some(0));
    let definitions = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM property_definitions WHERE id = $1",
        definition
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(definitions, Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn attached_storage_cannot_be_deleted_through_the_core_port(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    assert!(store.delete_storage(table.database_id).await.is_err());
    assert!(
        repo.get_database(table.database_id)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(
        repo.tables_for_databases(&[table.database_id])
            .await
            .unwrap()
            .len(),
        2
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_and_entity_writers_preserve_identity_and_lifecycle(pool: PgPool) {
    insert_user(&pool).await;
    let database = DatabaseId::new();
    sqlx::query!(
        "INSERT INTO databases (id, name, owner_id) VALUES ($1, 'Legacy', $2)",
        database.into_uuid(),
        USER
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    assert_eq!(
        repo.get_database(database).await.unwrap().unwrap().0.name,
        "Legacy"
    );
    repo.rename_database(database, "Entity").await.unwrap();
    let name = sqlx::query_scalar!(
        "SELECT name FROM databases WHERE id = $1",
        database.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(name, "Entity");
    sqlx::query!(
        "UPDATE databases SET trashed_at = now() WHERE id = $1",
        database.into_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.get_database(database)
            .await
            .unwrap()
            .unwrap()
            .0
            .trashed_at
            .is_some()
    );
    repo.restore_database(database).await.unwrap();
    let trashed = sqlx::query_scalar!(
        "SELECT trashed_at FROM databases WHERE id = $1",
        database.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(trashed.is_none());
    sqlx::query!("DELETE FROM databases WHERE id = $1", database.into_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert!(repo.get_database(database).await.unwrap().is_none());
    let core = sqlx::query_scalar!(
        "SELECT id FROM database WHERE id = $1",
        database.into_uuid()
    )
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert!(core.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn migration_preserves_existing_metadata_tables_and_grants(pool: PgPool) {
    let (_, table, _) = fixture(&pool).await;
    let mut transaction = pool.begin().await.unwrap();
    sqlx::raw_sql(SPLIT_DOWN)
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE databases SET name = 'Before split', trashed_at = now() WHERE id = $1",
        table.database_id.into_uuid()
    )
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::raw_sql(SPLIT_UP)
        .execute(&mut *transaction)
        .await
        .unwrap();
    let migrated = sqlx::query!(
        "SELECT e.name, e.user_id, e.trashed_at, t.id FROM database_entity e
         JOIN database d ON d.id = e.database_id
         JOIN database_tables t ON t.database_id = d.id WHERE e.database_id = $1 AND t.id = $2",
        table.database_id.into_uuid(),
        table.id.into_uuid()
    )
    .fetch_one(&mut *transaction)
    .await
    .unwrap();
    assert_eq!(migrated.name, "Before split");
    assert_eq!(migrated.user_id, USER);
    assert!(migrated.trashed_at.is_some());
    assert_eq!(migrated.id, table.id.into_uuid());
    let grants = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM entity_access WHERE entity_id = $1 AND entity_type = 'database'",
        table.database_id.into_uuid()
    )
    .fetch_one(&mut *transaction)
    .await
    .unwrap();
    assert_eq!(grants, Some(1));
    transaction.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rollback_refuses_to_discard_storage_without_an_entity(pool: PgPool) {
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let database = store.create_storage().await.unwrap();
    let mut transaction = pool.begin().await.unwrap();
    assert!(
        sqlx::raw_sql(SPLIT_DOWN)
            .execute(&mut *transaction)
            .await
            .is_err()
    );
    transaction.rollback().await.unwrap();
    let core = sqlx::query_scalar!(
        "SELECT id FROM database WHERE id = $1",
        database.into_uuid()
    )
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(core, Some(database.into_uuid()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rollback_waits_for_in_flight_core_allocation_before_checking_its_guard(pool: PgPool) {
    let database = DatabaseId::new();
    let mut allocation = pool.begin().await.unwrap();
    sqlx::query!(
        "INSERT INTO database (id) VALUES ($1)",
        database.into_uuid()
    )
    .execute(&mut *allocation)
    .await
    .unwrap();
    let mut rollback = pool.begin().await.unwrap();
    let error = {
        let mut pending = std::pin::pin!(sqlx::raw_sql(SPLIT_DOWN).execute(&mut *rollback));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut pending)
                .await
                .is_err()
        );
        allocation.commit().await.unwrap();
        pending.await.unwrap_err()
    };
    assert!(
        error
            .to_string()
            .contains("cannot revert database/entity separation")
    );
    rollback.rollback().await.unwrap();
    let core = sqlx::query_scalar!(
        "SELECT id FROM database WHERE id = $1",
        database.into_uuid()
    )
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(core, Some(database.into_uuid()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_an_owner_deletes_their_app_storage_but_leaves_unowned_storage(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let unowned = store.create_storage().await.unwrap();
    sqlx::query!("DELETE FROM \"User\" WHERE id = $1", USER)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.get_database(table.database_id)
            .await
            .unwrap()
            .is_none()
    );
    let resources = sqlx::query_scalar!("SELECT id FROM database")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(resources, vec![unowned.into_uuid()]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_metadata_writers_follow_the_legacy_lock_order(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let mut legacy = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM databases WHERE id = $1 FOR UPDATE",
        table.database_id.into_uuid()
    )
    .fetch_one(&mut *legacy)
    .await
    .unwrap();
    let mut trash = std::pin::pin!(repo.trash_database(table.database_id, chrono::Utc::now()));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut trash)
            .await
            .is_err()
    );
    // This update must not deadlock against a new writer holding the entity.
    sqlx::query!(
        "UPDATE databases SET name = 'Old writer' WHERE id = $1",
        table.database_id.into_uuid()
    )
    .execute(&mut *legacy)
    .await
    .unwrap();
    legacy.commit().await.unwrap();
    assert!(trash.await.unwrap());
    let database = repo
        .get_database(table.database_id)
        .await
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(database.name, "Old writer");
    assert!(database.trashed_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_schema_batches_wait_for_legacy_table_writers(pool: PgPool) {
    let (_, table, _) = fixture(&pool).await;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let mut legacy = pool.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM databases WHERE id = $1 FOR UPDATE",
        table.database_id.into_uuid()
    )
    .fetch_one(&mut *legacy)
    .await
    .unwrap();
    let writes = batch(
        table.database_id,
        vec![Write::CreateTable {
            table_id: TableId::new(),
            name: "Contacts".into(),
        }],
    );
    let mut pending = std::pin::pin!(store.apply_writes(&writes, None));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut pending)
            .await
            .is_err()
    );
    let position = models_databases::position::key_between(Some(&table.position), None).unwrap();
    sqlx::query!("INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Contacts', $3)", TableId::new().into_uuid(), table.database_id.into_uuid(), position.as_str())
        .execute(&mut *legacy).await.unwrap();
    legacy.commit().await.unwrap();
    assert_eq!(
        pending.await.unwrap(),
        WritesOutcome::TableNameTaken { write: 0 }
    );
}
