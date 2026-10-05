//! Statements on row identities, over any connection: the repository runs
//! them on the pool, the cell store inside a batch's transaction.

use sqlx::{PgConnection, PgExecutor};

use models_databases::position::keys_between;

use super::{PgDatabasesRepoError, last_position, uuids};
use crate::domain::journal::RestoredRow;
use crate::domain::models::{
    DatabaseId, PropertyDefinitionId, RowId, RowRef, TableId, TableVersion,
};

/// Hold the app entity live while a batch writes its core storage.
pub(crate) async fn lock_live_database(
    connection: &mut PgConnection,
    database_id: DatabaseId,
) -> Result<bool, sqlx::Error> {
    let live = sqlx::query_scalar!(
        "SELECT database_id FROM database_entities WHERE database_id = $1 AND trashed_at IS NULL FOR SHARE",
        database_id.into_uuid()
    )
    .fetch_optional(connection)
    .await?;
    Ok(live.is_some())
}

/// Append `count` empty rows to a live table, in order; `None` when the
/// table is gone. The app wrapper holds the entity lifecycle lock.
pub(crate) async fn append_rows(
    connection: &mut PgConnection,
    table_id: TableId,
    created_by: &str,
    count: usize,
) -> Result<Option<Vec<RowRef>>, PgDatabasesRepoError> {
    // Row writers and schema writers serialize on the table's version
    // row, so positions are minted under the same lock.
    let live = sqlx::query_scalar!(
        r#"SELECT t.id FROM database_tables t
               WHERE t.id = $1 FOR UPDATE OF t"#,
        table_id.into_uuid(),
    )
    .fetch_optional(&mut *connection)
    .await?;
    if live.is_none() {
        return Ok(None);
    }
    let max_position = sqlx::query_scalar!(
        "SELECT MAX(position) FROM database_rows WHERE table_id = $1",
        table_id.into_uuid()
    )
    .fetch_one(&mut *connection)
    .await?;
    let positions = keys_between(last_position(max_position)?.as_ref(), None, count)?;
    let mut rows = Vec::with_capacity(count);
    for position in positions {
        let id = RowId::new();
        sqlx::query!(
            "INSERT INTO database_rows (id, table_id, position, created_by) VALUES ($1, $2, $3, $4)",
            id.into_uuid(),
            table_id.into_uuid(),
            position.as_str(),
            created_by,
        )
        .execute(&mut *connection)
        .await?;
        rows.push(RowRef { id, position });
    }
    Ok(Some(rows))
}

/// What putting removed rows back did.
pub(crate) enum Restored {
    /// They are back.
    Applied(Vec<RowRef>),
    /// The table is gone.
    TableGone,
    /// A row has one of their ids again.
    Taken(RowId),
}

/// Put removed rows back in a live table under their ids and positions.
pub(crate) async fn restore_rows(
    connection: &mut PgConnection,
    table_id: TableId,
    created_by: &str,
    restored: &[RestoredRow],
) -> Result<Restored, PgDatabasesRepoError> {
    let live = sqlx::query_scalar!(
        r#"SELECT t.id FROM database_tables t
               WHERE t.id = $1 FOR UPDATE OF t"#,
        table_id.into_uuid(),
    )
    .fetch_optional(&mut *connection)
    .await?;
    if live.is_none() {
        return Ok(Restored::TableGone);
    }
    let mut rows = Vec::with_capacity(restored.len());
    for row in restored {
        let inserted = sqlx::query!(
            "INSERT INTO database_rows (id, table_id, position, created_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING",
            row.id.into_uuid(),
            table_id.into_uuid(),
            row.position.as_str(),
            created_by,
        )
        .execute(&mut *connection)
        .await?;
        if inserted.rows_affected() != 1 {
            return Ok(Restored::Taken(row.id));
        }
        rows.push(RowRef {
            id: row.id,
            position: row.position.clone(),
        });
    }
    Ok(Restored::Applied(rows))
}

/// Remove one row of a table; `false` if it was not there.
pub(crate) async fn delete_row(
    executor: impl PgExecutor<'_>,
    table_id: TableId,
    row_id: RowId,
) -> Result<bool, sqlx::Error> {
    let deleted = sqlx::query!(
        "DELETE FROM database_rows WHERE id = $1 AND table_id = $2",
        row_id.into_uuid(),
        table_id.into_uuid(),
    )
    .execute(executor)
    .await?;
    Ok(deleted.rows_affected() == 1)
}

/// A first value landed in these columns: they no longer infer their type.
pub(crate) async fn settle_inference(
    executor: impl PgExecutor<'_>,
    table_id: TableId,
    definitions: &[PropertyDefinitionId],
) -> Result<(), sqlx::Error> {
    if definitions.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        "UPDATE database_columns SET infer_type = FALSE
             WHERE infer_type AND table_id = $1 AND property_definition_id = ANY($2)",
        table_id.into_uuid(),
        definitions,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Bump a table's version, answering the new one.
pub(crate) async fn bump_table_version(
    executor: impl PgExecutor<'_>,
    table_id: TableId,
) -> Result<TableVersion, sqlx::Error> {
    let version = sqlx::query_scalar!(
        r#"UPDATE database_tables SET version = version + 1 WHERE id = $1 RETURNING version"#,
        table_id.into_uuid()
    )
    .fetch_one(executor)
    .await?;
    Ok(TableVersion(version))
}

/// Lock the rows among `row_ids` that belong to the table, for writing,
/// answering them.
pub(crate) async fn lock_rows(
    executor: impl PgExecutor<'_>,
    table_id: TableId,
    row_ids: &[RowId],
) -> Result<Vec<RowId>, sqlx::Error> {
    sqlx::query_scalar!(
        "SELECT id FROM database_rows WHERE table_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE",
        table_id.into_uuid(),
        &uuids(row_ids),
    )
    .fetch_all(executor)
    .await
    .map(|ids| ids.into_iter().map(RowId::from_uuid).collect())
}

/// Keep the rows among `row_ids` that belong to the table from being deleted
/// until the transaction ends, answering them.
pub(crate) async fn hold_rows(
    executor: impl PgExecutor<'_>,
    table_id: TableId,
    row_ids: &[RowId],
) -> Result<Vec<RowId>, sqlx::Error> {
    sqlx::query_scalar!(
        "SELECT id FROM database_rows WHERE table_id = $1 AND id = ANY($2) ORDER BY id FOR KEY SHARE",
        table_id.into_uuid(),
        &uuids(row_ids),
    )
    .fetch_all(executor)
    .await
    .map(|ids| ids.into_iter().map(RowId::from_uuid).collect())
}
