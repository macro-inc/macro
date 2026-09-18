use std::collections::HashMap;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::api::requests::SetPropertyValue;
use sqlx::PgPool;

use super::*;
use crate::domain::models::{ColumnBinding, ColumnConfig};

const USER: &str = "macro|databases-a@macro.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER)
        .expect("valid user id")
        .into_owned()
}

fn viewer() -> Viewer {
    Viewer { user_id: user() }
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

/// Database → table → one bound string column, the fixture every test starts from.
async fn fixture(pool: &PgPool) -> (PgDatabasesRepo, Table, Uuid) {
    insert_user(pool).await;
    let repo = PgDatabasesRepo::new(pool.clone());

    let database = repo
        .create_database(
            &CreateDatabase {
                name: "Summer Offsite".to_string(),
                owner_id: user(),
            },
            "Table 1",
        )
        .await
        .expect("database should insert");

    let table = repo
        .create_table(&CreateTable {
            database_id: database.id,
            name: "Guests".to_string(),
        })
        .await
        .expect("table should insert");

    let definition_id = insert_definition(pool, "Name").await;
    repo.create_column(
        table.id,
        definition_id,
        &CreateColumn {
            table_id: table.id,
            binding: ColumnBinding::ExistingDefinition(definition_id),
            config: None,
        },
    )
    .await
    .expect("column should insert");

    (repo, table, definition_id)
}

fn text(value: &str) -> SetPropertyValue {
    SetPropertyValue::String {
        value: value.to_string(),
    }
}

fn cells(pairs: Vec<(Uuid, SetPropertyValue)>) -> HashMap<Uuid, SetPropertyValue> {
    pairs.into_iter().collect()
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
    // A table is created at version 0, then bumped once by the column.
    assert_eq!(table.version, TableVersion(0));
    assert_eq!(tables[1].version, TableVersion(1));
    assert_eq!(tables[0].version, TableVersion(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_database_is_none_when_missing(pool: PgPool) {
    insert_user(&pool).await;
    let repo = PgDatabasesRepo::new(pool);

    let missing = repo
        .get_database(macro_uuid::generate_uuid_v7())
        .await
        .expect("get should succeed");

    assert!(missing.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_then_update_merges_cells_and_bumps_version_once(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let other_definition_id = insert_definition(&pool, "Role").await;

    let (inserted, versions) = repo
        .apply_changes(
            &viewer(),
            &[
                RowChange::Insert {
                    table_id: table.id,
                    cells: cells(vec![(definition_id, text("Priya"))]),
                },
                RowChange::Insert {
                    table_id: table.id,
                    cells: cells(vec![(definition_id, text("Sam"))]),
                },
            ],
            &HashMap::new(),
        )
        .await
        .expect("inserts should apply")
        .applied()
        .expect("no version conflict");

    assert_eq!(inserted.len(), 2);
    // Two changes, one table: exactly one bump off the column's version of 1.
    assert_eq!(versions, HashMap::from([(table.id, TableVersion(2))]));

    let rows = repo.fetch_rows(table.id).await.expect("rows should fetch");
    assert_eq!(rows.len(), 2);
    // Positions append, so fetch order matches insert order.
    assert_eq!(rows[0].id, inserted[0]);
    assert_eq!(rows[1].id, inserted[1]);
    assert_eq!(
        rows[0].cells.get(&definition_id),
        Some(&PropertyValue::Str("Priya".to_string()))
    );

    let (minted, versions) = repo
        .apply_changes(
            &viewer(),
            &[RowChange::Update {
                table_id: table.id,
                row_id: inserted[0],
                cells: cells(vec![(other_definition_id, text("host"))])
                    .into_iter()
                    .map(|(k, v)| (k, Some(v)))
                    .collect(),
            }],
            &HashMap::new(),
        )
        .await
        .expect("update should apply")
        .applied()
        .expect("no version conflict");

    assert!(minted.is_empty());
    assert_eq!(versions, HashMap::from([(table.id, TableVersion(3))]));

    let rows = repo.fetch_rows(table.id).await.expect("rows should fetch");
    let updated = &rows[0];
    // A merge, not a replace: the untouched cell survives.
    assert_eq!(
        updated.cells.get(&definition_id),
        Some(&PropertyValue::Str("Priya".to_string()))
    );
    assert_eq!(
        updated.cells.get(&other_definition_id),
        Some(&PropertyValue::Str("host".to_string()))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_of_a_missing_row_is_an_error(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;
    let ghost = macro_uuid::generate_uuid_v7();

    let result = repo
        .apply_changes(
            &viewer(),
            &[RowChange::Update {
                table_id: table.id,
                row_id: ghost,
                cells: cells(vec![(definition_id, text("nobody"))])
                    .into_iter()
                    .map(|(k, v)| (k, Some(v)))
                    .collect(),
            }],
            &HashMap::new(),
        )
        .await;

    assert!(matches!(
        result,
        Err(PgDatabasesRepoError::RowNotFound(id)) if id == ghost
    ));
    // The transaction rolled back, so the version never moved.
    let versions = repo
        .table_versions(&[table.id])
        .await
        .expect("versions should fetch");
    assert_eq!(versions, HashMap::from([(table.id, TableVersion(1))]));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn links_are_inserted_idempotently_and_removed(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;

    let link_definition_id = insert_definition(&pool, "Sessions").await;
    let link_column_id = repo
        .create_column(
            table.id,
            link_definition_id,
            &CreateColumn {
                table_id: table.id,
                binding: ColumnBinding::ExistingDefinition(link_definition_id),
                config: Some(ColumnConfig::Link {
                    database_id: table.database_id,
                    table_id: table.id,
                }),
            },
        )
        .await
        .expect("link column should insert");

    let (rows, _) = repo
        .apply_changes(
            &viewer(),
            &[
                RowChange::Insert {
                    table_id: table.id,
                    cells: cells(vec![(definition_id, text("Priya"))]),
                },
                RowChange::Insert {
                    table_id: table.id,
                    cells: cells(vec![(definition_id, text("Sam"))]),
                },
            ],
            &HashMap::new(),
        )
        .await
        .expect("inserts should apply")
        .applied()
        .expect("no version conflict");

    let before = repo
        .table_versions(&[table.id])
        .await
        .expect("versions should fetch")[&table.id];

    let (_, versions) = repo
        .apply_changes(
            &viewer(),
            &[
                RowChange::Link {
                    column_id: link_column_id,
                    source_row_id: rows[0],
                    target_row_id: rows[1],
                },
                // Re-linking the same pair is a no-op, not a conflict.
                RowChange::Link {
                    column_id: link_column_id,
                    source_row_id: rows[0],
                    target_row_id: rows[1],
                },
            ],
            &HashMap::new(),
        )
        .await
        .expect("links should apply")
        .applied()
        .expect("no version conflict");

    // A link change bumps the link column's own table, exactly once.
    assert_eq!(
        versions,
        HashMap::from([(table.id, TableVersion(before.0 + 1))])
    );
    assert_eq!(
        repo.fetch_links(link_column_id)
            .await
            .expect("links should fetch"),
        vec![(rows[0], rows[1])]
    );

    repo.apply_changes(
        &viewer(),
        &[RowChange::Unlink {
            column_id: link_column_id,
            source_row_id: rows[0],
            target_row_id: rows[1],
        }],
        &HashMap::new(),
    )
    .await
    .expect("unlink should apply");

    assert!(
        repo.fetch_links(link_column_id)
            .await
            .expect("links should fetch")
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_row_cascades_its_links(pool: PgPool) {
    let (repo, table, definition_id) = fixture(&pool).await;

    let link_definition_id = insert_definition(&pool, "Sessions").await;
    let link_column_id = repo
        .create_column(
            table.id,
            link_definition_id,
            &CreateColumn {
                table_id: table.id,
                binding: ColumnBinding::ExistingDefinition(link_definition_id),
                config: Some(ColumnConfig::Link {
                    database_id: table.database_id,
                    table_id: table.id,
                }),
            },
        )
        .await
        .expect("link column should insert");

    let (rows, _) = repo
        .apply_changes(
            &viewer(),
            &[
                RowChange::Insert {
                    table_id: table.id,
                    cells: cells(vec![(definition_id, text("Priya"))]),
                },
                RowChange::Insert {
                    table_id: table.id,
                    cells: cells(vec![(definition_id, text("Sam"))]),
                },
            ],
            &HashMap::new(),
        )
        .await
        .expect("inserts should apply")
        .applied()
        .expect("no version conflict");

    repo.apply_changes(
        &viewer(),
        &[RowChange::Link {
            column_id: link_column_id,
            source_row_id: rows[0],
            target_row_id: rows[1],
        }],
        &HashMap::new(),
    )
    .await
    .expect("link should apply");

    repo.apply_changes(
        &viewer(),
        &[RowChange::Delete {
            table_id: table.id,
            row_id: rows[1],
        }],
        &HashMap::new(),
    )
    .await
    .expect("delete should apply");

    assert_eq!(
        repo.fetch_rows(table.id)
            .await
            .expect("rows should fetch")
            .len(),
        1
    );
    assert!(
        repo.fetch_links(link_column_id)
            .await
            .expect("links should fetch")
            .is_empty()
    );
}
