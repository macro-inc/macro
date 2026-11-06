//! The schema's guarantees about cells: a cell belongs to an existing row and
//! a column of that row's table, and goes with either.

use super::*;

/// Store one cell the way the properties crate does, bypassing the service.
async fn insert_cell(
    pool: &PgPool,
    row: &str,
    definition: Uuid,
    value: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
         VALUES ($1, $2, 'DATABASE_ROW', $3, jsonb_build_object('type', 'String', 'value', $4::text))",
        macro_uuid::generate_uuid_v7(),
        row,
        definition,
        value,
    )
    .execute(pool)
    .await
    .map(|_| ())
}

/// Every stored row cell as (row, definition, text), in a stable order.
async fn stored_cells(pool: &PgPool) -> Vec<(String, Uuid, String)> {
    sqlx::query!(
        r#"SELECT entity_id, property_definition_id, values ->> 'value' AS "value!"
         FROM entity_properties WHERE entity_type = 'DATABASE_ROW'
         ORDER BY values ->> 'value'"#,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|cell| (cell.entity_id, cell.property_definition_id, cell.value))
    .collect()
}

/// The SQLSTATE and message a refused statement failed with.
fn refusal(error: sqlx::Error) -> (String, String) {
    let sqlx::Error::Database(database) = error else {
        panic!("expected a database error, got {error:?}");
    };
    (
        database
            .code()
            .map(|code| code.into_owned())
            .unwrap_or_default(),
        database.message().to_string(),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cell_of_a_column_of_its_rows_table_is_accepted(pool: PgPool) {
    let (repo, table, name) = fixture(&pool).await;
    let rows = repo.insert_rows(table.id, USER, 1).await.unwrap().unwrap();
    let sam = rows[0].id.to_string();

    insert_cell(&pool, &sam, name, "Sam").await.unwrap();

    assert_eq!(
        stored_cells(&pool).await,
        vec![(sam, name, "Sam".to_string())]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cell_of_a_column_of_another_table_is_refused(pool: PgPool) {
    let (repo, guests, name) = fixture(&pool).await;
    let hosts = TableId::new();
    let email = insert_definition(&pool, "Email").await;
    commit(
        &pool,
        guests.database_id,
        vec![
            Write::CreateTable {
                table_id: hosts,
                name: "Hosts".to_string(),
            },
            bind(hosts, email, "80"),
        ],
    )
    .await;
    let rows = repo.insert_rows(guests.id, USER, 1).await.unwrap().unwrap();
    let sam = rows[0].id.to_string();

    let inserted = insert_cell(&pool, &sam, email, "sam@example.com").await;
    assert_eq!(
        refusal(inserted.unwrap_err()),
        (
            "23503".to_string(),
            format!(
                "property definition {email} is not a column of the table of database row {sam}"
            ),
        )
    );

    insert_cell(&pool, &sam, name, "Sam").await.unwrap();
    let moved = sqlx::query!(
        "UPDATE entity_properties SET property_definition_id = $1 WHERE entity_id = $2",
        email,
        &sam,
    )
    .execute(&pool)
    .await;
    assert_eq!(
        refusal(moved.unwrap_err()),
        (
            "23503".to_string(),
            format!(
                "property definition {email} is not a column of the table of database row {sam}"
            ),
        )
    );
    assert_eq!(
        stored_cells(&pool).await,
        vec![(sam, name, "Sam".to_string())]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cell_of_a_missing_row_is_refused(pool: PgPool) {
    let (_, _, name) = fixture(&pool).await;
    let missing = macro_uuid::generate_uuid_v7().to_string();

    let inserted = insert_cell(&pool, &missing, name, "Sam").await;
    assert_eq!(
        refusal(inserted.unwrap_err()),
        (
            "23503".to_string(),
            format!("database row {missing} does not exist"),
        )
    );

    let not_a_row = insert_cell(&pool, "not-a-uuid", name, "Sam").await;
    assert_eq!(
        refusal(not_a_row.unwrap_err()),
        (
            "23503".to_string(),
            "database row not-a-uuid does not exist".to_string(),
        )
    );
    assert_eq!(stored_cells(&pool).await, vec![]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_row_deletes_its_cells(pool: PgPool) {
    let (repo, table, name) = fixture(&pool).await;
    let rows = repo.insert_rows(table.id, USER, 2).await.unwrap().unwrap();
    let (sam, ada) = (rows[0].id.to_string(), rows[1].id.to_string());
    insert_cell(&pool, &sam, name, "Sam").await.unwrap();
    insert_cell(&pool, &ada, name, "Ada").await.unwrap();

    assert!(repo.delete_row(table.id, rows[0].id).await.unwrap());

    assert_eq!(
        stored_cells(&pool).await,
        vec![(ada, name, "Ada".to_string())]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_table_or_its_database_deletes_its_cells(pool: PgPool) {
    let (repo, table, name) = fixture(&pool).await;
    let rows = repo.insert_rows(table.id, USER, 1).await.unwrap().unwrap();
    insert_cell(&pool, &rows[0].id.to_string(), name, "Sam")
        .await
        .unwrap();

    repo.delete_database(table.database_id).await.unwrap();

    assert_eq!(stored_cells(&pool).await, vec![]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_column_deletes_its_cells_in_that_table_only(pool: PgPool) {
    let (repo, guests, name) = fixture(&pool).await;
    let email = insert_definition(&pool, "Email").await;
    let hosts = TableId::new();
    commit(
        &pool,
        guests.database_id,
        vec![
            Write::CreateTable {
                table_id: hosts,
                name: "Hosts".to_string(),
            },
            bind(guests.id, email, "8180"),
            bind(hosts, name, "80"),
        ],
    )
    .await;
    let guest = repo.insert_rows(guests.id, USER, 1).await.unwrap().unwrap()[0]
        .id
        .to_string();
    let host = repo.insert_rows(hosts, USER, 1).await.unwrap().unwrap()[0]
        .id
        .to_string();
    insert_cell(&pool, &guest, name, "Sam").await.unwrap();
    insert_cell(&pool, &guest, email, "sam@example.com")
        .await
        .unwrap();
    insert_cell(&pool, &host, name, "Ada").await.unwrap();

    sqlx::query!(
        "DELETE FROM database_columns WHERE table_id = $1 AND property_definition_id = $2",
        guests.id.into_uuid(),
        name,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        stored_cells(&pool).await,
        vec![
            (host, name, "Ada".to_string()),
            (guest, email, "sam@example.com".to_string()),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rebinding_a_column_deletes_the_old_definitions_cells(pool: PgPool) {
    let (repo, table, name) = fixture(&pool).await;
    let title = insert_definition(&pool, "Title").await;
    let rows = repo.insert_rows(table.id, USER, 1).await.unwrap().unwrap();
    let sam = rows[0].id.to_string();
    insert_cell(&pool, &sam, name, "Sam").await.unwrap();

    sqlx::query!(
        "UPDATE database_columns SET property_definition_id = $3
         WHERE table_id = $1 AND property_definition_id = $2",
        table.id.into_uuid(),
        name,
        title,
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_cell(&pool, &sam, title, "Dr. Sam").await.unwrap();

    assert_eq!(
        stored_cells(&pool).await,
        vec![(sam, title, "Dr. Sam".to_string())]
    );
}
