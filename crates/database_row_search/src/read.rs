//! Reading rows' searchable text from Postgres.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::visible_text::{CellInput, SearchableKind, row_text};

/// The most rows one [`read_row_search_text`] call reads. Callers with more
/// read them in chunks.
pub const MAX_ROWS_PER_READ: usize = 500;

/// What one database row offers to search, as Postgres holds it now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowSearchText {
    /// The row.
    pub row_id: Uuid,
    /// The table holding it.
    pub table_id: Uuid,
    /// The database holding the table. Its database entity has the same id.
    pub database_id: Uuid,
    /// Plain text of the row's first column, empty when that column is not a
    /// searchable type.
    pub title: String,
    /// Plain text of the row's other searchable cells: text (mentions as
    /// their visible label), links, and select and tag option labels.
    pub cell_text: Vec<String>,
    /// The table's version when this was read.
    pub table_version: i64,
    /// When the row was last written.
    pub updated_at: DateTime<Utc>,
}

/// Why [`read_row_search_text`] failed.
#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    /// More than [`MAX_ROWS_PER_READ`] rows were asked for.
    #[error("asked for {requested} rows; one read takes at most {MAX_ROWS_PER_READ}")]
    TooManyRows {
        /// How many rows were asked for.
        requested: usize,
    },
    /// The query failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Read the searchable text of `row_ids`, in one statement so every row is
/// read from the same snapshot as its table's version.
///
/// A row is left out when it no longer exists or when its database is not
/// searchable: a database without a `database_entities` row (CRM and forms
/// storage) or one in the Trash. The result follows no particular order.
#[tracing::instrument(skip_all, fields(requested = row_ids.len(), found), err)]
pub async fn read_row_search_text<'e, Executor>(
    executor: Executor,
    row_ids: &[Uuid],
) -> Result<Vec<RowSearchText>, ReadError>
where
    Executor: sqlx::PgExecutor<'e>,
{
    if row_ids.len() > MAX_ROWS_PER_READ {
        return Err(ReadError::TooManyRows {
            requested: row_ids.len(),
        });
    }
    if row_ids.is_empty() {
        return Ok(Vec::new());
    }

    // One line per (row, column of its table), the columns in table order.
    // A table without columns still gives its rows one line, with no column.
    // Option cells resolve to their labels here, each by primary key (a
    // shared tag set can hold thousands of options); an option id that names
    // no option of the column's definition (a deleted option) reads as nothing.
    let lines = sqlx::query!(
        r#"
        SELECT
            r.id AS "row_id!",
            r.table_id AS "table_id!",
            t.database_id AS "database_id!",
            t.version AS "table_version!",
            r.updated_at AS "updated_at!",
            c.id AS "column_id?",
            pd.data_type::TEXT AS "data_type?",
            ep.values AS "values?",
            array_remove(ARRAY(
                SELECT (
                    SELECT COALESCE(po.string_value, po.number_value::TEXT)
                    FROM property_options po
                    WHERE po.id = CASE
                            WHEN picked.option_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN picked.option_id::UUID
                        END
                        AND po.property_definition_id = pd.id
                )
                FROM jsonb_array_elements_text(
                    CASE
                        WHEN ep.values ->> 'type' = 'SelectOption' THEN ep.values -> 'value'
                        ELSE '[]'::JSONB
                    END
                ) WITH ORDINALITY AS picked(option_id, ordinal)
                ORDER BY picked.ordinal
            ), NULL) AS "option_labels!"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entities de ON de.database_id = t.database_id
        LEFT JOIN database_columns c ON c.table_id = r.table_id
        LEFT JOIN property_definitions pd ON pd.id = c.property_definition_id
        LEFT JOIN entity_properties ep
            ON ep.entity_id = r.id::TEXT
            AND ep.entity_type = 'DATABASE_ROW'
            AND ep.property_definition_id = c.property_definition_id
        WHERE r.id = ANY($1)
            AND de.trashed_at IS NULL
        ORDER BY r.id, c.position, c.id
        "#,
        row_ids,
    )
    .fetch_all(executor)
    .await?;

    let mut rows: Vec<RowSearchText> = Vec::new();
    let mut cells: Vec<CellInput> = Vec::new();

    // Lines arrive grouped by row; close a row when the next one starts.
    let mut current: Option<RowSearchText> = None;
    for line in lines {
        let starts_row = current.as_ref().is_none_or(|row| row.row_id != line.row_id);
        if starts_row {
            if let Some(row) = current.take() {
                rows.push(with_text(row, &cells));
            }
            cells.clear();
            current = Some(RowSearchText {
                row_id: line.row_id,
                table_id: line.table_id,
                database_id: line.database_id,
                title: String::new(),
                cell_text: Vec::new(),
                table_version: line.table_version,
                updated_at: line.updated_at,
            });
        }

        if line.column_id.is_some() {
            cells.push(CellInput {
                kind: line.data_type.as_deref().and_then(SearchableKind::of),
                values: line.values,
                option_labels: line.option_labels,
            });
        }
    }
    if let Some(row) = current.take() {
        rows.push(with_text(row, &cells));
    }

    tracing::Span::current().record("found", rows.len());
    Ok(rows)
}

fn with_text(row: RowSearchText, cells: &[CellInput]) -> RowSearchText {
    let text = row_text(cells);
    RowSearchText {
        title: text.title,
        cell_text: text.cell_text,
        ..row
    }
}

#[cfg(test)]
mod test;
