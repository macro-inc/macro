//! Reads and bookkeeping for the indexer: what changed in a table since the
//! index last caught up, the rows to walk for a full pass, and the per-table
//! watermark that records how far the index has caught up.

use uuid::Uuid;

/// A table as the indexer needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableState {
    /// The database holding the table.
    pub database_id: Uuid,
    /// The table's current version.
    pub version: i64,
    /// Whether its rows belong in the index: the database has a database
    /// entity and it is not in the Trash.
    pub searchable: bool,
}

/// The table's state, or `None` when the table no longer exists.
#[tracing::instrument(skip(executor), err)]
pub async fn read_table_state<'e, Executor>(
    executor: Executor,
    table_id: Uuid,
) -> sqlx::Result<Option<TableState>>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query_as!(
        TableState,
        r#"
        SELECT
            t.database_id AS "database_id!",
            t.version AS "version!",
            (de.database_id IS NOT NULL AND de.trashed_at IS NULL) AS "searchable!"
        FROM database_tables t
        LEFT JOIN database_entities de ON de.database_id = t.database_id
        WHERE t.id = $1
        "#,
        table_id,
    )
    .fetch_optional(executor)
    .await
}

/// A database's tables, and whether their rows belong in the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseTables {
    /// Whether the database has a database entity that is not in the Trash.
    pub searchable: bool,
    /// Its tables.
    pub table_ids: Vec<Uuid>,
}

/// The database's tables, or `None` when its storage no longer exists.
#[tracing::instrument(skip(executor), err)]
pub async fn read_database_tables<'e, Executor>(
    executor: Executor,
    database_id: Uuid,
) -> sqlx::Result<Option<DatabaseTables>>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query_as!(
        DatabaseTables,
        r#"
        SELECT
            (de.database_id IS NOT NULL AND de.trashed_at IS NULL) AS "searchable!",
            ARRAY(
                SELECT t.id FROM database_tables t WHERE t.database_id = d.id ORDER BY t.id
            ) AS "table_ids!"
        FROM databases d
        LEFT JOIN database_entities de ON de.database_id = d.id
        WHERE d.id = $1
        "#,
        database_id,
    )
    .fetch_optional(executor)
    .await
}

/// Column changes that change what a table's rows say to search: a column
/// gone, retyped, moved into or out of first place (the title), or its
/// options relabelled or removed; and a related table's column change, which
/// can relabel a shared definition's options. Renames, formulas and new
/// options change no stored text.
const TEXT_RESHAPING_COLUMN_CHANGES: [&str; 8] = [
    "create",
    "change_type",
    "delete",
    "update_option",
    "delete_option",
    "reorder",
    "infer_type",
    "related",
];

/// What a table's journal says changed after one version, up to another.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableChanges {
    /// The versions journaled in the range, in order.
    pub versions: Vec<i64>,
    /// The rows those versions touched, each once.
    pub row_ids: Vec<Uuid>,
    /// Whether any of them changed a column in a way that changes rows'
    /// text without naming the rows.
    pub reshapes_text: bool,
}

/// The table's journal for versions in `(after, through]`.
#[tracing::instrument(skip(executor), err)]
pub async fn read_table_changes<'e, Executor>(
    executor: Executor,
    table_id: Uuid,
    after: i64,
    through: i64,
) -> sqlx::Result<TableChanges>
where
    Executor: sqlx::PgExecutor<'e>,
{
    let changes = sqlx::query!(
        r#"
        SELECT
            c.version,
            ARRAY(
                SELECT r.row_id FROM database_change_rows r WHERE r.change_id = c.id
            ) AS "row_ids!",
            EXISTS (
                SELECT 1 FROM database_change_columns cc
                WHERE cc.change_id = c.id AND cc.kind = ANY($4)
            ) AS "reshapes_text!"
        FROM database_changes c
        WHERE c.table_id = $1 AND c.version > $2 AND c.version <= $3
        ORDER BY c.version
        "#,
        table_id,
        after,
        through,
        &TEXT_RESHAPING_COLUMN_CHANGES.map(str::to_owned),
    )
    .fetch_all(executor)
    .await?;

    let mut versions = Vec::with_capacity(changes.len());
    let mut row_ids = Vec::new();
    let mut reshapes_text = false;
    for change in changes {
        versions.push(change.version);
        row_ids.extend(change.row_ids);
        reshapes_text |= change.reshapes_text;
    }
    row_ids.sort_unstable();
    row_ids.dedup();

    Ok(TableChanges {
        versions,
        row_ids,
        reshapes_text,
    })
}

/// A row's place in its table, the cursor for paging a table's rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowPlace {
    /// The row's fractional position.
    pub position: String,
    /// The row.
    pub id: Uuid,
}

/// One page of a table's rows in `(position, id)` order, after `after`.
/// Pages along `idx_database_rows_position_cursor`; there is no
/// `(table_id, id)` index.
#[tracing::instrument(skip(executor), err)]
pub async fn read_table_rows<'e, Executor>(
    executor: Executor,
    table_id: Uuid,
    after: Option<&RowPlace>,
    limit: i64,
) -> sqlx::Result<Vec<RowPlace>>
where
    Executor: sqlx::PgExecutor<'e>,
{
    // Two statements, not `$2 IS NULL OR ...`, so the cached generic plan
    // keeps the cursor as an index condition.
    match after {
        None => {
            sqlx::query_as!(
                RowPlace,
                r#"
                SELECT position AS "position!", id AS "id!"
                FROM database_rows
                WHERE table_id = $1
                ORDER BY position, id
                LIMIT $2
                "#,
                table_id,
                limit,
            )
            .fetch_all(executor)
            .await
        }
        Some(after) => {
            sqlx::query_as!(
                RowPlace,
                r#"
                SELECT position AS "position!", id AS "id!"
                FROM database_rows
                WHERE table_id = $1 AND (position, id) > ($2, $3)
                ORDER BY position, id
                LIMIT $4
                "#,
                table_id,
                after.position,
                after.id,
                limit,
            )
            .fetch_all(executor)
            .await
        }
    }
}

/// One page of the ids of databases whose rows belong in the index, in id
/// order, after `after`.
#[tracing::instrument(skip(executor), err)]
pub async fn read_searchable_database_ids<'e, Executor>(
    executor: Executor,
    after: Option<Uuid>,
    limit: i64,
) -> sqlx::Result<Vec<Uuid>>
where
    Executor: sqlx::PgExecutor<'e>,
{
    match after {
        None => {
            sqlx::query_scalar!(
                r#"
                SELECT database_id FROM database_entities
                WHERE trashed_at IS NULL
                ORDER BY database_id
                LIMIT $1
                "#,
                limit,
            )
            .fetch_all(executor)
            .await
        }
        Some(after) => {
            sqlx::query_scalar!(
                r#"
                SELECT database_id FROM database_entities
                WHERE trashed_at IS NULL AND database_id > $1
                ORDER BY database_id
                LIMIT $2
                "#,
                after,
                limit,
            )
            .fetch_all(executor)
            .await
        }
    }
}

/// Which of `row_ids` exist in a database whose rows belong in the index.
#[tracing::instrument(skip_all, fields(requested = row_ids.len()), err)]
pub async fn read_searchable_row_ids<'e, Executor>(
    executor: Executor,
    row_ids: &[Uuid],
) -> sqlx::Result<Vec<Uuid>>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query_scalar!(
        r#"
        SELECT r.id
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entities de ON de.database_id = t.database_id
        WHERE r.id = ANY($1) AND de.trashed_at IS NULL
        "#,
        row_ids,
    )
    .fetch_all(executor)
    .await
}

/// The version up to which the index holds the table, if known.
#[tracing::instrument(skip(executor), err)]
pub async fn read_watermark<'e, Executor>(
    executor: Executor,
    table_id: Uuid,
) -> sqlx::Result<Option<i64>>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query_scalar!(
        "SELECT indexed_version FROM database_row_search_watermarks WHERE table_id = $1",
        table_id,
    )
    .fetch_optional(executor)
    .await
}

/// Record that the index holds the table up to `version`. A mark never moves
/// back, so a slower pass that finishes later cannot undo a faster one.
#[tracing::instrument(skip(executor), err)]
pub async fn raise_watermark<'e, Executor>(
    executor: Executor,
    table_id: Uuid,
    database_id: Uuid,
    version: i64,
) -> sqlx::Result<()>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query!(
        r#"
        INSERT INTO database_row_search_watermarks (table_id, database_id, indexed_version)
        VALUES ($1, $2, $3)
        ON CONFLICT (table_id) DO UPDATE SET
            indexed_version = GREATEST(
                database_row_search_watermarks.indexed_version,
                EXCLUDED.indexed_version
            ),
            updated_at = now()
        "#,
        table_id,
        database_id,
        version,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Forget the table's mark, after its rows left the index.
#[tracing::instrument(skip(executor), err)]
pub async fn delete_table_watermark<'e, Executor>(
    executor: Executor,
    table_id: Uuid,
) -> sqlx::Result<()>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query!(
        "DELETE FROM database_row_search_watermarks WHERE table_id = $1",
        table_id,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Forget every mark of the database, after its rows left the index.
#[tracing::instrument(skip(executor), err)]
pub async fn delete_database_watermarks<'e, Executor>(
    executor: Executor,
    database_id: Uuid,
) -> sqlx::Result<()>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query!(
        "DELETE FROM database_row_search_watermarks WHERE database_id = $1",
        database_id,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// The tables that have a mark but no longer exist, at most `limit`.
#[tracing::instrument(skip(executor), err)]
pub async fn read_watermarks_of_gone_tables<'e, Executor>(
    executor: Executor,
    limit: i64,
) -> sqlx::Result<Vec<Uuid>>
where
    Executor: sqlx::PgExecutor<'e>,
{
    sqlx::query_scalar!(
        r#"
        SELECT w.table_id
        FROM database_row_search_watermarks w
        WHERE NOT EXISTS (SELECT 1 FROM database_tables t WHERE t.id = w.table_id)
        LIMIT $1
        "#,
        limit,
    )
    .fetch_all(executor)
    .await
}

#[cfg(test)]
mod test;
