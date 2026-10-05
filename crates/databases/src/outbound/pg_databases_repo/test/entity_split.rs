//! Storage without app metadata, app cleanup, and the destructive schema cutover.

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
async fn schema_cutover_discards_database_content_and_allows_a_fresh_start(pool: PgPool) {
    let (repo, _, shared_definition) = fixture(&pool).await;
    let store = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    store.create_storage().await.unwrap();
    let mut transaction = pool.begin().await.unwrap();
    // Down also resets populated app and core storage, without a preservation guard.
    sqlx::raw_sql(SPLIT_DOWN)
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("entity_split/before_split.sql"))
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::raw_sql(SPLIT_UP)
        .execute(&mut *transaction)
        .await
        .unwrap();
    let remaining = sqlx::query_scalar!(
        r#"SELECT (SELECT COUNT(*) FROM database)
                 + (SELECT COUNT(*) FROM database_entity)
                 + (SELECT COUNT(*) FROM database_tables)
                 + (SELECT COUNT(*) FROM database_columns)
                 + (SELECT COUNT(*) FROM database_rows)
                 + (SELECT COUNT(*) FROM database_views)
                 + (SELECT COUNT(*) FROM database_view_positions)
                 + (SELECT COUNT(*) FROM property_definitions WHERE database_id IS NOT NULL)
                 + (SELECT COUNT(*) FROM entity_properties WHERE entity_type = 'DATABASE_ROW')
                 + (SELECT COUNT(*) FROM entity_access WHERE entity_type = 'database')
                 + (SELECT COUNT(*) FROM database_changes)
                 + (SELECT COUNT(*) FROM database_change_rows)
                 + (SELECT COUNT(*) FROM database_change_columns)
                 + (SELECT COUNT(*) FROM database_queries)
                 + (SELECT COUNT(*) FROM database_starter_seeds) AS "count!""#
    )
    .fetch_one(&mut *transaction)
    .await
    .unwrap();
    assert_eq!(remaining, 0);
    let old_table = sqlx::query_scalar!("SELECT to_regclass('databases')::text")
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    assert!(old_table.is_none());
    let shared = sqlx::query_scalar!(
        "SELECT id FROM property_definitions WHERE id = $1",
        shared_definition
    )
    .fetch_optional(&mut *transaction)
    .await
    .unwrap();
    assert_eq!(shared, Some(shared_definition));
    transaction.commit().await.unwrap();
    // The owner remains and can immediately create and write a fresh app database.
    let database = repo
        .create_database(
            &CreateDatabase {
                name: "Fresh start".into(),
                owner_id: user(),
                acting_bot: None,
                template: None,
            },
            FirstTable {
                name: "Contacts",
                title_column: "Name",
            },
        )
        .await
        .unwrap();
    assert_eq!(
        repo.get_database(database.id)
            .await
            .unwrap()
            .unwrap()
            .0
            .name,
        "Fresh start"
    );
}
