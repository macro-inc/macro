use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use sqlx::PgPool;

use super::*;
use uuid::Uuid;

use crate::domain::models::{RowId, Viewer, Write, Writes, WritesOutcome};
use crate::domain::ports::{CellStore, ColumnDefinitionStore};
use crate::outbound::pg_cell_store::PgCellStore;

#[cfg(feature = "gateway")]
mod apply_ops;
mod cell_triggers;
#[cfg(feature = "gateway")]
mod changes;
mod entity_split;
#[cfg(feature = "gateway")]
mod journal;
#[cfg(feature = "gateway")]
mod rename_column;
#[cfg(feature = "gateway")]
mod reorder_tables;
mod saved_queries;
#[cfg(feature = "gateway")]
mod schema_ops;
mod sharing;
#[cfg(feature = "gateway")]
mod tables;
mod transfer;
#[cfg(feature = "gateway")]
mod undo;
#[cfg(feature = "gateway")]
mod views;

const USER: &str = "macro|databases-a@macro.com";

/// Row statements the repository tests drive directly; the service writes
/// rows only through the cell store's batches.
impl<Properties> PgDatabasesRepo<Properties> {
    async fn insert_rows(
        &self,
        table_id: TableId,
        created_by: &str,
        count: usize,
    ) -> Result<Option<Vec<RowRef>>, PgDatabasesRepoError> {
        let mut transaction = self.pool.begin().await?;
        let database = sqlx::query_scalar!(
            "SELECT database_id FROM database_tables WHERE id = $1",
            table_id.into_uuid()
        )
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(database) = database else {
            return Ok(None);
        };
        if !rows::lock_live_database(&mut transaction, DatabaseId::from_uuid(database)).await? {
            return Ok(None);
        }
        let rows = rows::append_rows(&mut transaction, table_id, created_by, count).await?;
        if rows.is_some() {
            transaction.commit().await?;
        }
        Ok(rows)
    }

    async fn delete_row(
        &self,
        table_id: TableId,
        row_id: RowId,
    ) -> Result<bool, PgDatabasesRepoError> {
        Ok(rows::delete_row(&self.pool, table_id, row_id).await?)
    }

    async fn row_table(&self, row_id: RowId) -> Result<Option<TableId>, PgDatabasesRepoError> {
        Ok(sqlx::query_scalar!(
            "SELECT table_id FROM database_rows WHERE id = $1",
            row_id.into_uuid()
        )
        .fetch_optional(&self.pool)
        .await?
        .map(TableId::from_uuid))
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER)
        .expect("valid user id")
        .into_owned()
}

fn viewer() -> Viewer {
    Viewer {
        user_id: user(),
        acting_bot: None,
    }
}

async fn insert_user(pool: &PgPool) {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        USER,
    )
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        USER,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("user should insert");
}

/// A string property definition owned by the test user, ready to bind as a
/// column. The definition store port is a separate adapter, so the test mints
/// one directly.
async fn insert_definition(pool: &PgPool, display_name: &str) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select)
        VALUES ($1, $2, $3, 'STRING', false)
        "#,
        id,
        USER,
        display_name,
    )
    .execute(pool)
    .await
    .expect("definition should insert");
    id
}

/// Commit `writes` to `database_id` through the cell store, as the service
/// would send them in one batch, answering the versions it bumped.
async fn commit(
    pool: &PgPool,
    database_id: DatabaseId,
    writes: Vec<Write>,
) -> HashMap<TableId, TableVersion> {
    let outcome = PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .apply_writes(&Writes {
            database_id,
            created_by: user(),
            writes,
            related_rows: Vec::new(),
            expected_versions: Vec::new(),
            journal: crate::domain::journal::JournalPlan::default(),
        })
        .await
        .expect("the batch should run");
    let WritesOutcome::Applied { table_versions, .. } = outcome else {
        panic!("expected the batch to commit, got {outcome:?}");
    };
    table_versions
}

/// Place an existing definition on a table, at `position`.
fn bind(table_id: TableId, definition_id: Uuid, position: &str) -> Write {
    Write::CreateColumn {
        column: Column {
            id: ColumnId::new(),
            table_id,
            property_definition_id: definition_id,
            position: position.parse().expect("a fractional key"),
            config: None,
            display_name: None,
            infer_type: false,
        },
        definition: None,
    }
}

/// Database → table → one bound string column, the fixture every test starts from.
async fn fixture(pool: &PgPool) -> (PgDatabasesRepo<PropertiesPgRepo>, Table, Uuid) {
    insert_user(pool).await;
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));

    let database = repo
        .create_database(
            &CreateDatabase {
                name: "Summer Offsite".to_string(),
                owner_id: user(),
                acting_bot: None,
            },
            FirstTable {
                name: "Table 1",
                title_column: "Name",
            },
        )
        .await
        .expect("database should insert");

    let table_id = TableId::new();
    let definition_id = insert_definition(pool, "Name").await;
    commit(
        pool,
        database.id,
        vec![
            Write::CreateTable {
                table_id,
                name: "Guests".to_string(),
            },
            bind(table_id, definition_id, "80"),
        ],
    )
    .await;
    let (_, tables) = repo
        .get_database(database.id)
        .await
        .expect("get should succeed")
        .expect("database should exist");
    let table = tables
        .into_iter()
        .find(|table| table.id == table_id)
        .expect("the table should be stored");

    (repo, table, definition_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_database_starts_with_a_title_column_that_infers_its_type(pool: PgPool) {
    insert_user(&pool).await;
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let database = repo
        .create_database(
            &CreateDatabase {
                name: "Hiring".to_string(),
                owner_id: user(),
                acting_bot: None,
            },
            FirstTable {
                name: "Table 1",
                title_column: "Name",
            },
        )
        .await
        .unwrap();

    let (_, tables) = repo.get_database(database.id).await.unwrap().unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "Table 1");
    let columns = repo.columns_for_tables(&[tables[0].id]).await.unwrap();
    assert_eq!(columns.len(), 1);
    assert_eq!(columns[0].display_name, None);
    assert!(columns[0].infer_type);
    assert!(columns[0].config.is_none());
    let definitions = crate::outbound::pg_definition_store::PgDefinitionStore::new(
        pool.clone(),
        PropertiesPgRepo::new(pool.clone()),
    )
    .definitions(&[columns[0].property_definition_id])
    .await
    .unwrap();
    assert_eq!(definitions.len(), 1);
    let title = &definitions[0].definition;
    assert_eq!(title.display_name, "Name");
    assert_eq!(title.data_type, models_properties::DataType::String);
    assert!(!title.is_multi_select);
    assert_eq!(title.specific_entity_type, None);
    assert_eq!(
        title.owner,
        models_properties::shared::PropertyOwner::Database {
            database_id: database.id.into_uuid()
        }
    );
    assert!(definitions[0].property_options.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn database_table_and_column_round_trip(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;

    let (database, tables) = repo
        .get_database(table.database_id)
        .await
        .expect("get should succeed")
        .expect("database should exist");

    assert_eq!(database.name, "Summer Offsite");
    assert_eq!(database.owner_id, USER);
    assert!(database.trashed_at.is_none());
    // The starter table plus the one created explicitly, in position order.
    assert_eq!(tables.len(), 2);
    assert_eq!(tables[0].name, "Table 1");
    assert_eq!(tables[1].id, table.id);
    // Created with its column in one batch, the table is versioned once.
    assert_eq!(tables[1].version, TableVersion(1));
    assert_eq!(tables[0].version, TableVersion(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rename_trash_and_restore_round_trip(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let database_id = table.database_id;

    assert!(
        repo.rename_database(database_id, "Winter Offsite")
            .await
            .expect("rename should succeed")
    );
    let (database, _) = repo
        .get_database(database_id)
        .await
        .expect("get should succeed")
        .expect("database should exist");
    assert_eq!(database.name, "Winter Offsite");
    assert!(database.trashed_at.is_none());

    let trashed_at = chrono::Utc::now();
    assert!(
        repo.trash_database(database_id, trashed_at)
            .await
            .expect("trash should succeed")
    );
    let (database, _) = repo
        .get_database(database_id)
        .await
        .expect("get should succeed")
        .expect("a trashed database is still readable");
    // Postgres stores microseconds, so the round-tripped instant is the
    // written one truncated, not bit-identical.
    let stored = database.trashed_at.expect("trashed_at should be set");
    assert!((stored - trashed_at).num_milliseconds().abs() < 1);

    assert!(
        repo.restore_database(database_id)
            .await
            .expect("restore should succeed")
    );
    let (database, tables) = repo
        .get_database(database_id)
        .await
        .expect("get should succeed")
        .expect("database should exist");
    assert!(database.trashed_at.is_none());
    // Trashing and restoring never touches the contents.
    assert_eq!(tables.len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn renaming_trashing_or_restoring_a_missing_database_says_it_is_gone(pool: PgPool) {
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool));
    let missing = Uuid::nil();

    assert!(
        !repo
            .rename_database(DatabaseId::from_uuid(missing), "Winter")
            .await
            .unwrap()
    );
    assert!(
        !repo
            .trash_database(DatabaseId::from_uuid(missing), chrono::Utc::now())
            .await
            .unwrap()
    );
    assert!(
        !repo
            .restore_database(DatabaseId::from_uuid(missing))
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_database_cascades_and_purges_access_rows(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let database_id = table.database_id;

    let access_rows = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM entity_access WHERE entity_id = $1 AND entity_type = $2"#,
        database_id.into_uuid(),
        EntityType::Database.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .expect("count should succeed");
    assert_eq!(access_rows, Some(1), "creation writes the owner grant");

    repo.delete_database(database_id)
        .await
        .expect("delete should succeed");

    assert!(
        repo.get_database(database_id)
            .await
            .expect("get should succeed")
            .is_none()
    );
    for (label, count) in [
        (
            "tables",
            sqlx::query_scalar!(
                r#"SELECT COUNT(*) FROM database_tables WHERE database_id = $1"#,
                database_id.into_uuid()
            )
            .fetch_one(&pool)
            .await
            .expect("count should succeed"),
        ),
        (
            "columns",
            sqlx::query_scalar!(
                r#"SELECT COUNT(*) FROM database_columns WHERE table_id = $1"#,
                table.id.into_uuid()
            )
            .fetch_one(&pool)
            .await
            .expect("count should succeed"),
        ),
        (
            "rows",
            sqlx::query_scalar!(
                r#"SELECT COUNT(*) FROM database_rows WHERE table_id = $1"#,
                table.id.into_uuid()
            )
            .fetch_one(&pool)
            .await
            .expect("count should succeed"),
        ),
        (
            "entity access",
            sqlx::query_scalar!(
                r#"SELECT COUNT(*) FROM entity_access WHERE entity_id = $1 AND entity_type = $2"#,
                database_id.into_uuid(),
                EntityType::Database.as_ref(),
            )
            .fetch_one(&pool)
            .await
            .expect("count should succeed"),
        ),
    ] {
        assert_eq!(count, Some(0), "{label} should be gone");
    }

    // The bound definition is owned by the test user, not the database, so it
    // survives; only database-owned definitions cascade.
    let definitions = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM property_definitions WHERE id = $1"#,
        definition_id
    )
    .fetch_one(&pool)
    .await
    .expect("count should succeed");
    assert_eq!(definitions, Some(1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_database_is_none_when_missing(pool: PgPool) {
    insert_user(&pool).await;
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool));

    let missing = repo
        .get_database(DatabaseId::new())
        .await
        .expect("get should succeed");

    assert!(missing.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rows_are_minted_in_order_and_deleted_by_their_table(pool: PgPool) {
    let (repo, table, _) = fixture(&pool).await;
    let first = repo
        .insert_rows(table.id, USER, 2)
        .await
        .unwrap()
        .expect("the table is live");
    let second = repo
        .insert_rows(table.id, USER, 1)
        .await
        .unwrap()
        .expect("the table is live");
    let refs = repo.row_refs(table.id).await.unwrap();
    assert_eq!(
        refs.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![first[0].id, first[1].id, second[0].id]
    );
    assert!(
        refs.windows(2)
            .all(|pair| pair[0].position < pair[1].position)
    );
    assert_eq!(repo.row_table(first[0].id).await.unwrap(), Some(table.id));

    let other = macro_uuid::generate_uuid_v7();
    assert!(
        !repo
            .delete_row(TableId::from_uuid(other), first[0].id)
            .await
            .unwrap()
    );
    assert!(repo.delete_row(table.id, first[0].id).await.unwrap());
    assert_eq!(repo.row_table(first[0].id).await.unwrap(), None);
    assert_eq!(repo.row_refs(table.id).await.unwrap().len(), 2);

    repo.trash_database(table.database_id, chrono::Utc::now())
        .await
        .unwrap();
    assert!(repo.insert_rows(table.id, USER, 1).await.unwrap().is_none());
}
