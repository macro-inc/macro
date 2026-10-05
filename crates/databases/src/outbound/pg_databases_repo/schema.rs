//! Schema statements inside a batch's transaction: tables and column
//! placements, each guarded so a concurrent change shows as a refusal
//! rather than a lost write.

use sqlx::{PgConnection, Postgres, Transaction};

use super::*;

/// The primary key of `database_tables`.
const TABLE_KEY: &str = "database_tables_pkey";
/// The primary key of `database_columns`.
const COLUMN_KEY: &str = "database_columns_pkey";
/// The constraint that a definition is placed at most once per table.
const BINDING_KEY: &str = "database_columns_table_id_property_definition_id_key";

/// Which constraint a statement failed on, if it failed on one.
fn violated(error: &sqlx::Error) -> Option<&str> {
    match error {
        sqlx::Error::Database(database) => database.constraint(),
        _ => None,
    }
}

/// How an insert went: in, or refused by a key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Inserted {
    /// The row went in.
    Applied,
    /// The id already names a row.
    IdTaken,
    /// Another row holds the unique name or binding.
    Conflict,
}

/// Lock the database row: for update when the batch adds, renames, removes
/// or reorders tables, else shared, so its tables cannot change under the
/// batch. `false` when the core resource is gone.
pub(crate) async fn lock_database(
    connection: &mut PgConnection,
    database_id: DatabaseId,
    exclusive: bool,
) -> Result<bool, sqlx::Error> {
    if exclusive {
        return Ok(sqlx::query_scalar!(
            "SELECT id FROM databases WHERE id = $1 FOR UPDATE",
            database_id.into_uuid()
        )
        .fetch_optional(connection)
        .await?
        .is_some());
    }
    let live = sqlx::query_scalar!(
        "SELECT id FROM databases WHERE id = $1 FOR SHARE",
        database_id.into_uuid()
    )
    .fetch_optional(connection)
    .await?;
    Ok(live.is_some())
}

/// Lock the live tables among `table_ids`, in id order, answering each with
/// its version.
pub(crate) async fn lock_table_versions(
    connection: &mut PgConnection,
    table_ids: &[TableId],
) -> Result<HashMap<TableId, TableVersion>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT t.id, t.version FROM database_tables t
           WHERE t.id = ANY($1)
           ORDER BY t.id
           FOR UPDATE OF t"#,
        &uuids(table_ids),
    )
    .fetch_all(connection)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (TableId::from_uuid(row.id), TableVersion(row.version)))
        .collect())
}

/// Add a table after the database's others, unless another has its name.
pub(crate) async fn insert_table(
    transaction: &mut Transaction<'static, Postgres>,
    database_id: DatabaseId,
    table_id: TableId,
    name: &str,
) -> Result<Inserted, PgDatabasesRepoError> {
    let max_position = sqlx::query_scalar!(
        r#"SELECT MAX(position) FROM database_tables WHERE database_id = $1"#,
        database_id.into_uuid()
    )
    .fetch_one(&mut **transaction)
    .await?;
    let position = position_after(last_position(max_position)?.as_ref())?;
    let inserted = sqlx::query_scalar!(
        r#"
        INSERT INTO database_tables (id, database_id, name, position)
        SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (
            SELECT 1 FROM database_tables
            WHERE database_id = $2 AND lower(name) = lower($3)
        )
        RETURNING id
        "#,
        table_id.into_uuid(),
        database_id.into_uuid(),
        name,
        position.as_str(),
    )
    .fetch_optional(&mut **transaction)
    .await;
    Ok(match inserted {
        Ok(Some(_)) => Inserted::Applied,
        Ok(None) => Inserted::Conflict,
        Err(error) if violated(&error) == Some(TABLE_KEY) => Inserted::IdTaken,
        Err(error) => return Err(error.into()),
    })
}

/// Rename a table still named `from`, unless another table has `name`.
pub(crate) async fn rename_table(
    connection: &mut PgConnection,
    database_id: DatabaseId,
    table_id: TableId,
    from: &str,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let renamed = sqlx::query!(
        r#"
        UPDATE database_tables SET name = $3
        WHERE id = $1 AND database_id = $2 AND name = $4
          AND NOT EXISTS (
            SELECT 1 FROM database_tables other
            WHERE other.database_id = $2 AND other.id <> $1
              AND lower(other.name) = lower($3)
          )
        "#,
        table_id.into_uuid(),
        database_id.into_uuid(),
        name,
        from,
    )
    .execute(connection)
    .await?;
    Ok(renamed.rows_affected() == 1)
}

/// How a table's removal went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Removed {
    /// The table and everything in it are gone.
    Applied,
    /// The table is not in the database.
    Missing,
    /// It is the database's last table.
    LastTable,
}

/// Remove a table with its columns, rows and views, unless it is its
/// database's last. The caller holds the database's lock.
pub(crate) async fn delete_table(
    connection: &mut PgConnection,
    database_id: DatabaseId,
    table_id: TableId,
) -> Result<Removed, sqlx::Error> {
    let tables = sqlx::query_scalar!(
        "SELECT id FROM database_tables WHERE database_id = $1",
        database_id.into_uuid()
    )
    .fetch_all(&mut *connection)
    .await?;
    if !tables.contains(table_id.as_uuid()) {
        return Ok(Removed::Missing);
    }
    if tables.len() <= 1 {
        return Ok(Removed::LastTable);
    }
    // Columns, rows and views go with the table through their foreign keys,
    // and the rows' cells with them by trigger.
    let deleted = sqlx::query!(
        "DELETE FROM database_tables WHERE id = $1 AND database_id = $2",
        table_id.into_uuid(),
        database_id.into_uuid()
    )
    .execute(connection)
    .await?;
    Ok(if deleted.rows_affected() == 1 {
        Removed::Applied
    } else {
        Removed::Missing
    })
}

/// Give a database's tables new positions, provided `tables` are exactly
/// its tables. The caller holds the database's lock.
pub(crate) async fn order_tables(
    connection: &mut PgConnection,
    database_id: DatabaseId,
    tables: &[TableId],
    positions: &[Position],
) -> Result<bool, sqlx::Error> {
    let mut current: Vec<TableId> = sqlx::query_scalar!(
        "SELECT id FROM database_tables WHERE database_id = $1",
        database_id.into_uuid()
    )
    .fetch_all(&mut *connection)
    .await?
    .into_iter()
    .map(TableId::from_uuid)
    .collect();
    let mut requested = tables.to_vec();
    current.sort_unstable();
    requested.sort_unstable();
    if current != requested {
        return Ok(false);
    }
    sqlx::query!(
        r#"
        UPDATE database_tables t
        SET position = ordered.position
        FROM UNNEST($2::uuid[], $3::text[]) AS ordered(id, position)
        WHERE t.id = ordered.id AND t.database_id = $1
        "#,
        database_id.into_uuid(),
        &uuids(tables),
        &stored_positions(positions),
    )
    .execute(connection)
    .await?;
    Ok(true)
}

/// Place a column, its id, position and binding given.
pub(crate) async fn insert_column(
    connection: &mut PgConnection,
    column: &Column,
) -> Result<Inserted, PgDatabasesRepoError> {
    let config = column
        .config
        .as_ref()
        .map(serde_json::to_value)
        .transpose()?;
    let inserted = sqlx::query!(
        r#"
            INSERT INTO database_columns (id, table_id, property_definition_id, position, config, infer_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        column.id.into_uuid(),
        column.table_id.into_uuid(),
        column.property_definition_id,
        column.position.as_str(),
        config,
        column.infer_type,
    )
    .execute(connection)
    .await;
    Ok(match inserted {
        Ok(_) => Inserted::Applied,
        Err(error) if violated(&error) == Some(COLUMN_KEY) => Inserted::IdTaken,
        Err(error) if violated(&error) == Some(BINDING_KEY) => Inserted::Conflict,
        Err(error) => return Err(error.into()),
    })
}

/// Relabel a column whose own label is still `from`.
pub(crate) async fn rename_column(
    connection: &mut PgConnection,
    table_id: TableId,
    column_id: ColumnId,
    from: Option<&str>,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let renamed = sqlx::query!(
        "UPDATE database_columns SET display_name = $3
         WHERE id = $1 AND table_id = $2 AND display_name IS NOT DISTINCT FROM $4",
        column_id.into_uuid(),
        table_id.into_uuid(),
        name,
        from,
    )
    .execute(connection)
    .await?;
    Ok(renamed.rows_affected() == 1)
}

/// Remove a column still bound to `definition_id`; its cells go by trigger.
pub(crate) async fn delete_column(
    connection: &mut PgConnection,
    table_id: TableId,
    column_id: ColumnId,
    definition_id: PropertyDefinitionId,
) -> Result<bool, sqlx::Error> {
    let deleted = sqlx::query!(
        "DELETE FROM database_columns WHERE id = $1 AND table_id = $2 AND property_definition_id = $3",
        column_id.into_uuid(),
        table_id.into_uuid(),
        definition_id
    )
    .execute(connection)
    .await?;
    Ok(deleted.rows_affected() == 1)
}

/// Give a table's columns new positions; `false` when one is gone.
pub(crate) async fn order_columns(
    connection: &mut PgConnection,
    table_id: TableId,
    positions: &[(ColumnId, Position)],
) -> Result<bool, sqlx::Error> {
    for (id, position) in positions {
        let result = sqlx::query!(
            "UPDATE database_columns SET position = $3 WHERE id = $1 AND table_id = $2",
            id.into_uuid(),
            table_id.into_uuid(),
            position.as_str()
        )
        .execute(&mut *connection)
        .await?;
        if result.rows_affected() != 1 {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Swap a placement onto its replacement definition; `false` when the
/// placement is no longer bound as the replacement expects. The old
/// definition's cells on the table go by trigger.
pub(crate) async fn rebind_column(
    connection: &mut PgConnection,
    table_id: TableId,
    replacement: &ColumnReplacement,
) -> Result<bool, PgDatabasesRepoError> {
    let config = replacement
        .config
        .as_ref()
        .map(serde_json::to_value)
        .transpose()?;
    let changed = sqlx::query!(
        "UPDATE database_columns SET property_definition_id = $4, config = $5, infer_type = false
             WHERE id = $1 AND table_id = $2 AND property_definition_id = $3",
        replacement.column.id.into_uuid(),
        table_id.into_uuid(),
        replacement.column.property_definition_id,
        replacement.definition_id,
        config
    )
    .execute(connection)
    .await?;
    Ok(changed.rows_affected() == 1)
}

/// Store views rewritten by a schema change; `false` when one is gone.
pub(crate) async fn rewrite_views(
    connection: &mut PgConnection,
    views: &[DatabaseView],
) -> Result<bool, PgDatabasesRepoError> {
    for view in views {
        if !views::update_view(&mut *connection, view).await? {
            return Ok(false);
        }
    }
    Ok(true)
}
