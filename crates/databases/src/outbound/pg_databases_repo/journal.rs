//! The change journal's statements: recording a batch's entries inside its
//! transaction, reading what its before-image needs under its locks, and
//! reading history back.

use std::collections::HashMap;

use sqlx::{PgConnection, PgExecutor};
use uuid::Uuid;

use super::{PgDatabasesRepoError, stored, uuids};
use crate::domain::journal::{
    ChangeRecord, ColumnTouch, JournalActor, JournalEntry, JournaledRowChange, RowTouch,
    StoredChange, VersionTouches,
};
use crate::domain::models::{
    ChangeId, ColumnId, CommittedChange, DatabaseId, RowId, TableId, TableVersion,
};
use models_databases::position::Position;

/// Record a batch's journal entries, answering each one's id.
pub(crate) async fn record(
    connection: &mut PgConnection,
    actor: &JournalActor,
    entries: &[JournalEntry],
) -> Result<Vec<CommittedChange>, PgDatabasesRepoError> {
    let acting_bot = actor.acting_bot.as_ref().map(ToString::to_string);
    let mut committed = Vec::with_capacity(entries.len());
    for entry in entries {
        let id = sqlx::query_scalar!(
            r#"INSERT INTO database_changes (database_id, table_id, version, actor, acting_bot, ops, inverse)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id"#,
            entry.database_id.into_uuid(),
            entry.table.into_uuid(),
            entry.version.0,
            actor.user,
            acting_bot,
            serde_json::to_value(&entry.ops)?,
            serde_json::to_value(&entry.inverse)?,
        )
        .fetch_one(&mut *connection)
        .await?;
        if !entry.rows.is_empty() {
            let rows: Vec<Uuid> = entry
                .rows
                .iter()
                .map(|touch| touch.row.into_uuid())
                .collect();
            let kinds: Vec<String> = entry
                .rows
                .iter()
                .map(|touch| <&str>::from(touch.kind).to_string())
                .collect();
            // Postgres has no array of arrays of varying length, so each
            // row's columns travel as one text of comma-separated ids.
            let columns: Vec<String> = entry
                .rows
                .iter()
                .map(|touch| {
                    touch
                        .columns
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .collect();
            sqlx::query!(
                r#"INSERT INTO database_change_rows (change_id, row_id, kind, columns)
                   SELECT $1, row_id, kind,
                          COALESCE(string_to_array(NULLIF(columns, ''), ',')::uuid[], '{}')
                   FROM UNNEST($2::uuid[], $3::text[], $4::text[]) AS data(row_id, kind, columns)"#,
                id,
                &rows,
                &kinds,
                &columns,
            )
            .execute(&mut *connection)
            .await?;
        }
        if !entry.columns.is_empty() {
            let columns: Vec<Uuid> = entry
                .columns
                .iter()
                .map(|touch| touch.column.into_uuid())
                .collect();
            let kinds: Vec<String> = entry
                .columns
                .iter()
                .map(|touch| <&str>::from(touch.kind).to_string())
                .collect();
            sqlx::query!(
                r#"INSERT INTO database_change_columns (change_id, column_id, kind)
                   SELECT $1, column_id, kind
                   FROM UNNEST($2::uuid[], $3::text[]) AS data(column_id, kind)"#,
                id,
                &columns,
                &kinds,
            )
            .execute(&mut *connection)
            .await?;
        }
        committed.push(CommittedChange {
            table: entry.table,
            version: entry.version,
            change: ChangeId(id),
        });
    }
    Ok(committed)
}

/// The rows among `rows` that exist, with their table and position.
pub(crate) async fn row_places(
    executor: impl PgExecutor<'_>,
    rows: &[RowId],
) -> Result<Vec<(RowId, TableId, Position)>, PgDatabasesRepoError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let records = sqlx::query!(
        "SELECT id, table_id, position FROM database_rows WHERE id = ANY($1)",
        &uuids(rows),
    )
    .fetch_all(executor)
    .await?;
    records
        .into_iter()
        .map(|record| {
            Ok((
                RowId::from_uuid(record.id),
                TableId::from_uuid(record.table_id),
                record.position.parse()?,
            ))
        })
        .collect()
}

/// Every row of a table.
pub(crate) async fn table_rows(
    executor: impl PgExecutor<'_>,
    table: TableId,
) -> Result<Vec<RowId>, sqlx::Error> {
    let rows = sqlx::query_scalar!(
        "SELECT id FROM database_rows WHERE table_id = $1",
        table.into_uuid(),
    )
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().map(RowId::from_uuid).collect())
}

/// Stamp who last wrote these rows' cells, and when.
pub(crate) async fn stamp_rows(
    executor: impl PgExecutor<'_>,
    rows: &[RowId],
    updated_by: &str,
) -> Result<(), sqlx::Error> {
    if rows.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        "UPDATE database_rows SET updated_by = $2, updated_at = now() WHERE id = ANY($1)",
        &uuids(rows),
        updated_by,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Forget a purged database's history.
pub(crate) async fn purge(
    executor: impl PgExecutor<'_>,
    database_id: DatabaseId,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "DELETE FROM database_changes WHERE database_id = $1",
        database_id.into_uuid(),
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// A row's changes in one table of a database, newest first.
pub(crate) async fn row_history(
    executor: impl PgExecutor<'_>,
    database_id: DatabaseId,
    table: TableId,
    row: RowId,
) -> Result<Vec<JournaledRowChange>, PgDatabasesRepoError> {
    let records = sqlx::query!(
        r#"SELECT c.id, c.table_id, c.version, c.actor, c.acting_bot, c.at, c.ops, c.inverse,
                  r.kind, r.columns
           FROM database_change_rows r
           JOIN database_changes c ON c.id = r.change_id
           WHERE r.row_id = $1 AND c.table_id = $2 AND c.database_id = $3
           ORDER BY r.change_id DESC"#,
        row.into_uuid(),
        table.into_uuid(),
        database_id.into_uuid(),
    )
    .fetch_all(executor)
    .await?;
    records
        .into_iter()
        .map(|record| {
            Ok(JournaledRowChange {
                change: StoredChange {
                    id: ChangeId(record.id),
                    table: TableId::from_uuid(record.table_id),
                    version: TableVersion(record.version),
                    actor: record.actor,
                    acting_bot: record.acting_bot,
                    at: record.at,
                    ops: stored::ops(record.ops)?,
                    inverse: stored::inverse(record.inverse)?,
                },
                kind: record
                    .kind
                    .parse::<crate::domain::journal::RowChangeKind>()
                    .map_err(|_| PgDatabasesRepoError::CorruptChangeKind(record.kind.clone()))?,
                columns: record
                    .columns
                    .into_iter()
                    .map(ColumnId::from_uuid)
                    .collect(),
            })
        })
        .collect()
}

/// The cells of `rows` the properties side keyed by row entity id, as the
/// before-image takes them.
pub(crate) fn entity_ids(rows: &[RowId]) -> Vec<String> {
    rows.iter().map(ToString::to_string).collect()
}

/// Group `(entity id, definition, value)` triples by row.
pub(crate) fn by_row<Value>(
    triples: Vec<(String, Uuid, Value)>,
) -> HashMap<RowId, HashMap<Uuid, Value>> {
    let mut rows: HashMap<RowId, HashMap<Uuid, Value>> = HashMap::new();
    for (entity, definition, value) in triples {
        if let Ok(row) = entity.parse() {
            rows.entry(row).or_default().insert(definition, value);
        }
    }
    rows
}

/// One change by id, in a database, with what it touched.
pub(crate) async fn change(
    connection: &mut PgConnection,
    database_id: DatabaseId,
    change: ChangeId,
) -> Result<Option<ChangeRecord>, PgDatabasesRepoError> {
    let records = sqlx::query!(
        r#"SELECT id, table_id, version, actor, acting_bot, at, ops, inverse
           FROM database_changes WHERE id = $1 AND database_id = $2"#,
        change.0,
        database_id.into_uuid(),
    )
    .fetch_all(&mut *connection)
    .await?;
    let changes = records
        .into_iter()
        .map(|record| {
            Ok(StoredChange {
                id: ChangeId(record.id),
                table: TableId::from_uuid(record.table_id),
                version: TableVersion(record.version),
                actor: record.actor,
                acting_bot: record.acting_bot,
                at: record.at,
                ops: stored::ops(record.ops)?,
                inverse: stored::inverse(record.inverse)?,
            })
        })
        .collect::<Result<Vec<_>, PgDatabasesRepoError>>()?;
    Ok(with_touches(connection, changes).await?.into_iter().next())
}

/// A table's changes after a version, oldest first, with what each touched.
pub(crate) async fn changes_after(
    connection: &mut PgConnection,
    table: TableId,
    version: TableVersion,
) -> Result<Vec<ChangeRecord>, PgDatabasesRepoError> {
    let records = sqlx::query!(
        r#"SELECT id, table_id, version, actor, acting_bot, at, ops, inverse
           FROM database_changes WHERE table_id = $1 AND version > $2
           ORDER BY version"#,
        table.into_uuid(),
        version.0,
    )
    .fetch_all(&mut *connection)
    .await?;
    let changes = records
        .into_iter()
        .map(|record| {
            Ok(StoredChange {
                id: ChangeId(record.id),
                table: TableId::from_uuid(record.table_id),
                version: TableVersion(record.version),
                actor: record.actor,
                acting_bot: record.acting_bot,
                at: record.at,
                ops: stored::ops(record.ops)?,
                inverse: stored::inverse(record.inverse)?,
            })
        })
        .collect::<Result<Vec<_>, PgDatabasesRepoError>>()?;
    with_touches(connection, changes).await
}

/// The changes with the rows and columns each touched.
async fn with_touches(
    connection: &mut PgConnection,
    changes: Vec<StoredChange>,
) -> Result<Vec<ChangeRecord>, PgDatabasesRepoError> {
    if changes.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<i64> = changes.iter().map(|change| change.id.0).collect();
    let rows = sqlx::query!(
        "SELECT change_id, row_id, kind, columns FROM database_change_rows WHERE change_id = ANY($1)",
        &ids,
    )
    .fetch_all(&mut *connection)
    .await?;
    let columns = sqlx::query!(
        "SELECT change_id, column_id, kind FROM database_change_columns WHERE change_id = ANY($1)",
        &ids,
    )
    .fetch_all(&mut *connection)
    .await?;
    let mut records: Vec<ChangeRecord> = changes
        .into_iter()
        .map(|change| ChangeRecord {
            change,
            rows: Vec::new(),
            columns: Vec::new(),
        })
        .collect();
    for row in rows {
        let kind = row
            .kind
            .parse()
            .map_err(|_| PgDatabasesRepoError::CorruptChangeKind(row.kind.clone()))?;
        if let Some(record) = records
            .iter_mut()
            .find(|record| record.change.id.0 == row.change_id)
        {
            record.rows.push(RowTouch {
                row: RowId::from_uuid(row.row_id),
                kind,
                columns: row.columns.into_iter().map(ColumnId::from_uuid).collect(),
            });
        }
    }
    for column in columns {
        let kind = column
            .kind
            .parse()
            .map_err(|_| PgDatabasesRepoError::CorruptChangeKind(column.kind.clone()))?;
        if let Some(record) = records
            .iter_mut()
            .find(|record| record.change.id.0 == column.change_id)
        {
            record.columns.push(ColumnTouch {
                column: ColumnId::from_uuid(column.column_id),
                kind,
            });
        }
    }
    Ok(records)
}

/// What each version of a table after `version` touched, oldest first.
pub(crate) async fn touches_after(
    connection: &mut PgConnection,
    table: TableId,
    version: TableVersion,
) -> Result<Vec<VersionTouches>, PgDatabasesRepoError> {
    let changes = sqlx::query!(
        r#"SELECT id, version FROM database_changes
           WHERE table_id = $1 AND version > $2 ORDER BY version"#,
        table.into_uuid(),
        version.0,
    )
    .fetch_all(&mut *connection)
    .await?;
    let ids: Vec<i64> = changes.iter().map(|change| change.id).collect();
    let rows = sqlx::query!(
        "SELECT change_id, row_id, kind FROM database_change_rows WHERE change_id = ANY($1)",
        &ids,
    )
    .fetch_all(&mut *connection)
    .await?;
    let columns = sqlx::query!(
        "SELECT change_id, column_id, kind FROM database_change_columns WHERE change_id = ANY($1)",
        &ids,
    )
    .fetch_all(&mut *connection)
    .await?;
    let mut touches: Vec<(i64, VersionTouches)> = changes
        .into_iter()
        .map(|change| {
            (
                change.id,
                VersionTouches {
                    version: TableVersion(change.version),
                    rows: Vec::new(),
                    columns: Vec::new(),
                },
            )
        })
        .collect();
    for row in rows {
        let kind = row
            .kind
            .parse()
            .map_err(|_| PgDatabasesRepoError::CorruptChangeKind(row.kind.clone()))?;
        if let Some((_, held)) = touches.iter_mut().find(|(id, _)| *id == row.change_id) {
            held.rows.push((RowId::from_uuid(row.row_id), kind));
        }
    }
    for column in columns {
        let kind = column
            .kind
            .parse()
            .map_err(|_| PgDatabasesRepoError::CorruptChangeKind(column.kind.clone()))?;
        if let Some((_, held)) = touches.iter_mut().find(|(id, _)| *id == column.change_id) {
            held.columns.push(ColumnTouch {
                column: ColumnId::from_uuid(column.column_id),
                kind,
            });
        }
    }
    Ok(touches.into_iter().map(|(_, held)| held).collect())
}
