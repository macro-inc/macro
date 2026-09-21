//! Postgres repository for databases, tables, columns, rows, and links.
//!
//! Mechanics only: sqlx queries and transactions. Policy lives in the domain
//! service. Tables: `databases`, `database_tables`, `database_columns`,
//! `database_rows`, `database_row_links`
//! (`crates/macro_db_client/migrations/20260908204308_add_databases.up.sql`).

#[cfg(test)]
mod test;

use std::collections::{BTreeSet, HashMap};

use models_properties::convert_set_property_value_to_property_value;
use models_properties::service::property_value::PropertyValue;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use entity_access_db_utils::{AccessLevel, EntityAccessSourceType};
use model_entity::EntityType;

use crate::domain::models::{
    ApplyOutcome, Column, ColumnConfig, ColumnId, CreateColumn, CreateDatabase, CreateTable,
    Database, DatabaseId, PropertyDefinitionId, RenameColumnOutcome, Row, RowChange, RowId, Table,
    TableId, TableVersion, Viewer,
};
use crate::domain::ports::DatabasesRepo;

/// Errors from the Postgres repository.
#[derive(Debug, thiserror::Error)]
pub enum PgDatabasesRepoError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
    /// A link change referenced a column placement that does not exist.
    #[error("column {0} not found")]
    ColumnNotFound(ColumnId),
    /// A stored `cells` object could not be decoded into property values.
    #[error("invalid cells stored for row {row_id}")]
    InvalidCells {
        /// The row carrying the undecodable cells.
        row_id: RowId,
    },
    /// A domain value could not be encoded as JSON for storage.
    #[error("failed to encode json for storage")]
    Json(#[from] serde_json::Error),
}

/// Width of the zero-padded decimal ordering keys stored in `position`.
///
/// There is no fractional-index helper in the workspace yet, so ordering keys
/// are plain zero-padded counters: a new item's position is
/// `max(position) + 1`, rendered to a fixed width so lexicographic ordering
/// (what the `TEXT` column and every `ORDER BY position` give us) matches
/// numeric ordering. Inserting *between* two neighbours is therefore not
/// expressible yet; when it is needed, swap [`next_position`] for a real
/// fractional index — the column is already `TEXT` and every read orders by it,
/// so nothing else has to change.
const POSITION_WIDTH: usize = 12;

/// The ordering key that appends after `max`, the largest existing position.
fn next_position(max: Option<&str>) -> String {
    let next = max.and_then(|p| p.parse::<u64>().ok()).unwrap_or(0) + 1;
    format!("{next:0POSITION_WIDTH$}")
}

/// Encode a changeset's cells as the JSONB object stored in `database_rows`.
///
/// Keys are property definition ids as text; values are the same tagged-union
/// [`PropertyValue`] the rest of the properties system stores.
fn cells_to_json(
    cells: &HashMap<PropertyDefinitionId, models_properties::api::requests::SetPropertyValue>,
) -> Result<serde_json::Value, PgDatabasesRepoError> {
    let converted: HashMap<String, PropertyValue> = cells
        .iter()
        .map(|(definition_id, value)| {
            (
                definition_id.to_string(),
                convert_set_property_value_to_property_value(value),
            )
        })
        .collect();
    Ok(serde_json::to_value(converted)?)
}

/// Decode a stored `cells` object back into typed property values.
fn cells_from_json(
    row_id: RowId,
    value: serde_json::Value,
) -> Result<HashMap<PropertyDefinitionId, PropertyValue>, PgDatabasesRepoError> {
    let serde_json::Value::Object(object) = value else {
        return Err(PgDatabasesRepoError::InvalidCells { row_id });
    };

    object
        .into_iter()
        .map(|(key, value)| {
            let definition_id = key
                .parse::<Uuid>()
                .map_err(|_| PgDatabasesRepoError::InvalidCells { row_id })?;
            let value = serde_json::from_value::<PropertyValue>(value)
                .map_err(|_| PgDatabasesRepoError::InvalidCells { row_id })?;
            Ok((definition_id, value))
        })
        .collect()
}

/// [`DatabasesRepo`] backed by MacroDB.
#[derive(Debug, Clone)]
pub struct PgDatabasesRepo {
    pool: PgPool,
}

impl PgDatabasesRepo {
    /// Create a repository over the given pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// The tables whose versions a change to `column_id`'s edges bumps: the
    /// table the link column sits on, and the table it points at.
    ///
    /// Both ends move because both ends read the edge — the target table's
    /// rows expose the reverse ("linked from") side, which is computed at read
    /// time, so a viewer of the target sees stale data until its version says
    /// otherwise. Returns just the source table when the placement carries no
    /// link config or points at itself.
    async fn link_column_tables(
        transaction: &mut Transaction<'_, Postgres>,
        column_id: ColumnId,
    ) -> Result<Vec<TableId>, PgDatabasesRepoError> {
        let row = sqlx::query!(
            r#"SELECT table_id, config FROM database_columns WHERE id = $1"#,
            column_id
        )
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or(PgDatabasesRepoError::ColumnNotFound(column_id))?;

        let mut tables = vec![row.table_id];
        let config: Option<ColumnConfig> = row.config.map(serde_json::from_value).transpose()?;
        if let Some(ColumnConfig::Link { table_id, .. }) = config
            && table_id != row.table_id
        {
            tables.push(table_id);
        }
        Ok(tables)
    }

    /// Insert one row at the end of its table, returning the minted id.
    async fn insert_row(
        transaction: &mut Transaction<'_, Postgres>,
        viewer: &Viewer,
        table_id: TableId,
        position: String,
        cells: serde_json::Value,
    ) -> Result<RowId, PgDatabasesRepoError> {
        let id = macro_uuid::generate_uuid_v7();

        sqlx::query!(
            r#"
            INSERT INTO database_rows (id, table_id, position, cells, created_by)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            id,
            table_id,
            position,
            cells,
            viewer.user_id.as_ref(),
        )
        .execute(&mut **transaction)
        .await?;

        Ok(id)
    }
}

impl DatabasesRepo for PgDatabasesRepo {
    type Err = PgDatabasesRepoError;

    #[tracing::instrument(err, skip(self, cmd))]
    async fn create_database(
        &self,
        cmd: &CreateDatabase,
        starter_table_name: &str,
    ) -> Result<Database, Self::Err> {
        // Time-ordered v7 so ids sort by creation and are known before insert.
        let id = macro_uuid::generate_uuid_v7();
        let mut transaction = self.pool.begin().await?;

        let row = sqlx::query!(
            r#"
            INSERT INTO databases (id, name, owner_id)
            VALUES ($1, $2, $3)
            RETURNING id, name, owner_id, created_at, trashed_at
            "#,
            id,
            cmd.name,
            cmd.owner_id.as_ref(),
        )
        .fetch_one(&mut *transaction)
        .await?;

        sqlx::query!(
            r#"
            INSERT INTO database_tables (id, database_id, name, position)
            VALUES ($1, $2, $3, $4)
            "#,
            macro_uuid::generate_uuid_v7(),
            id,
            starter_table_name,
            next_position(None),
        )
        .execute(&mut *transaction)
        .await?;

        // The creator's owner grant lives in the same transaction, so a
        // database can never exist that nobody can open.
        entity_access_db_utils::insert_entity_access_row(
            &mut transaction,
            &id,
            EntityType::Database,
            cmd.owner_id.as_ref(),
            EntityAccessSourceType::User,
            AccessLevel::Owner,
        )
        .await?;

        transaction.commit().await?;

        Ok(Database {
            id: row.id,
            name: row.name,
            owner_id: row.owner_id,
            created_at: row.created_at,
            trashed_at: row.trashed_at,
        })
    }

    /// Returns the row whether or not it is trashed; the domain decides what a
    /// trashed database means.
    #[tracing::instrument(err, skip(self))]
    async fn get_database(
        &self,
        id: DatabaseId,
    ) -> Result<Option<(Database, Vec<Table>)>, Self::Err> {
        let Some(row) = sqlx::query!(
            r#"SELECT id, name, owner_id, created_at, trashed_at FROM databases WHERE id = $1"#,
            id
        )
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };

        let database = Database {
            id: row.id,
            name: row.name,
            owner_id: row.owner_id,
            created_at: row.created_at,
            trashed_at: row.trashed_at,
        };

        let tables = sqlx::query!(
            r#"
            SELECT id, database_id, name, position, version
            FROM database_tables
            WHERE database_id = $1
            ORDER BY position
            "#,
            id
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| Table {
            id: row.id,
            database_id: row.database_id,
            name: row.name,
            position: row.position,
            version: TableVersion(row.version),
        })
        .collect();

        Ok(Some((database, tables)))
    }

    #[tracing::instrument(err, skip(self))]
    async fn rename_database(&self, id: DatabaseId, name: &str) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE databases SET name = $2, updated_at = now() WHERE id = $1"#,
            id,
            name,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn trash_database(
        &self,
        id: DatabaseId,
        trashed_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE databases SET trashed_at = $2, updated_at = now() WHERE id = $1"#,
            id,
            trashed_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn restore_database(&self, id: DatabaseId) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"UPDATE databases SET trashed_at = NULL, updated_at = now() WHERE id = $1"#,
            id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Tables, columns, rows, link edges, and database-owned property
    /// definitions go with the database through the `ON DELETE CASCADE` chain
    /// declared in the migrations that added them; `entity_access`
    /// rows are a generic side table with no foreign key to `databases`, so
    /// they are purged explicitly in the same transaction.
    #[tracing::instrument(err, skip(self))]
    async fn delete_database(&self, id: DatabaseId) -> Result<(), Self::Err> {
        let mut transaction = self.pool.begin().await?;

        entity_access_db_utils::delete_entity_access_rows(
            &mut transaction,
            &id,
            EntityType::Database,
        )
        .await?;

        sqlx::query!(r#"DELETE FROM databases WHERE id = $1"#, id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, cmd))]
    async fn create_table(&self, cmd: &CreateTable) -> Result<Option<Table>, Self::Err> {
        let mut transaction = self.pool.begin().await?;

        sqlx::query!(
            "SELECT id FROM databases WHERE id = $1 FOR UPDATE",
            cmd.database_id
        )
        .fetch_one(&mut *transaction)
        .await?;

        let max_position = sqlx::query_scalar!(
            r#"SELECT MAX(position) FROM database_tables WHERE database_id = $1"#,
            cmd.database_id
        )
        .fetch_one(&mut *transaction)
        .await?;
        let position = next_position(max_position.as_deref());
        let id = macro_uuid::generate_uuid_v7();

        let row = sqlx::query!(
            r#"
            INSERT INTO database_tables (id, database_id, name, position)
            SELECT $1, $2, $3, $4
            WHERE NOT EXISTS (
                SELECT 1 FROM database_tables
                WHERE database_id = $2 AND lower(name) = lower($3)
            )
            RETURNING id, database_id, name, position, version
            "#,
            id,
            cmd.database_id,
            cmd.name,
            position,
        )
        .fetch_optional(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(row.map(|row| Table {
            id: row.id,
            database_id: row.database_id,
            name: row.name,
            position: row.position,
            version: TableVersion(row.version),
        }))
    }

    #[tracing::instrument(err, skip(self, table))]
    async fn rename_table(
        &self,
        table: &Table,
        name: &str,
        previous_name: &str,
    ) -> Result<Option<Table>, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        // Serialize table naming and position allocation within a database.
        sqlx::query!(
            "SELECT id FROM databases WHERE id = $1 FOR UPDATE",
            table.database_id
        )
        .fetch_one(&mut *transaction)
        .await?;
        let row = sqlx::query!(
            r#"
            UPDATE database_tables
            SET name = $3, version = version + 1
            WHERE id = $1 AND database_id = $2 AND name = $4
              AND NOT EXISTS (
                SELECT 1 FROM database_tables other
                WHERE other.database_id = $2 AND other.id <> $1
                  AND lower(other.name) = lower($3)
              )
            RETURNING id, database_id, name, position, version
            "#,
            table.id,
            table.database_id,
            name,
            previous_name,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(row.map(|row| Table {
            id: row.id,
            database_id: row.database_id,
            name: row.name,
            position: row.position,
            version: TableVersion(row.version),
        }))
    }

    #[tracing::instrument(err, skip(self, cmd))]
    async fn create_column(
        &self,
        table_id: TableId,
        property_definition_id: PropertyDefinitionId,
        cmd: &CreateColumn,
    ) -> Result<ColumnId, Self::Err> {
        let config = cmd.config.as_ref().map(serde_json::to_value).transpose()?;

        let mut transaction = self.pool.begin().await?;

        let max_position = sqlx::query_scalar!(
            r#"SELECT MAX(position) FROM database_columns WHERE table_id = $1"#,
            table_id
        )
        .fetch_one(&mut *transaction)
        .await?;
        let position = next_position(max_position.as_deref());
        let id = macro_uuid::generate_uuid_v7();

        sqlx::query!(
            r#"
            INSERT INTO database_columns (id, table_id, property_definition_id, position, config, infer_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            id,
            table_id,
            property_definition_id,
            position,
            config,
            cmd.infer_type,
        )
        .execute(&mut *transaction)
        .await?;

        // A new column changes the table's shape, so materializations keyed on
        // the version have to be rebuilt.
        sqlx::query!(
            r#"UPDATE database_tables SET version = version + 1 WHERE id = $1"#,
            table_id
        )
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;

        Ok(id)
    }

    #[tracing::instrument(err, skip(self, table, column))]
    async fn rename_column(
        &self,
        table: &Table,
        column: &Column,
        name: &str,
    ) -> Result<Option<RenameColumnOutcome>, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let version = sqlx::query_scalar!(
            r#"UPDATE database_tables SET version = version + 1
            WHERE id = $1 AND database_id = $2 AND version = $3
              AND EXISTS (SELECT 1 FROM database_columns WHERE id = $4 AND table_id = $1
                          AND display_name IS NOT DISTINCT FROM $5)
              AND EXISTS (SELECT 1 FROM databases WHERE id = $2 AND trashed_at IS NULL)
            RETURNING version"#,
            table.id,
            table.database_id,
            table.version.0,
            column.id,
            column.display_name,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(version) = version else {
            return Ok(None);
        };
        sqlx::query!(
            "UPDATE database_columns SET display_name = $2 WHERE id = $1 AND table_id = $3",
            column.id,
            name,
            table.id
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(RenameColumnOutcome {
            column: Column {
                display_name: Some(name.to_string()),
                ..column.clone()
            },
            table_version: TableVersion(version),
        }))
    }

    #[tracing::instrument(err, skip(self, table, column))]
    async fn infer_column_type(
        &self,
        table: &Table,
        column: &Column,
        definition_id: PropertyDefinitionId,
    ) -> Result<Option<TableVersion>, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        // Row writers take this same lock before checking versions and cells.
        let current = sqlx::query_scalar!(
            "SELECT version FROM database_tables WHERE id = $1 AND database_id = $2 FOR UPDATE",
            table.id,
            table.database_id,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if current != Some(table.version.0) {
            return Ok(None);
        }
        let updated = sqlx::query_scalar!(
            r#"UPDATE database_columns SET property_definition_id = $4, infer_type = FALSE
            WHERE id = $1 AND table_id = $2 AND property_definition_id = $3 AND infer_type
              AND NOT EXISTS (SELECT 1 FROM database_rows WHERE table_id = $2 AND cells ? $5)
              AND EXISTS (SELECT 1 FROM databases WHERE id = $6 AND trashed_at IS NULL)
            RETURNING id"#,
            column.id,
            table.id,
            column.property_definition_id,
            definition_id,
            column.property_definition_id.to_string(),
            table.database_id,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if updated.is_none() {
            return Ok(None);
        }
        let version = sqlx::query_scalar!(
            "UPDATE database_tables SET version = version + 1 WHERE id = $1 RETURNING version",
            table.id,
        )
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(TableVersion(version)))
    }

    #[tracing::instrument(err, skip(self))]
    async fn fetch_rows(&self, table_id: TableId, limit: usize) -> Result<Vec<Row>, Self::Err> {
        // One sequential scan: cells are dense and always read together.
        sqlx::query!(
            r#"
            SELECT id, table_id, position, cells
            FROM database_rows
            WHERE table_id = $1
            ORDER BY position
            LIMIT $2
            "#,
            table_id,
            limit as i64,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| {
            Ok(Row {
                id: row.id,
                table_id: row.table_id,
                position: row.position,
                cells: cells_from_json(row.id, row.cells)?,
            })
        })
        .collect()
    }

    #[tracing::instrument(err, skip(self))]
    async fn fetch_links(&self, column_id: ColumnId) -> Result<Vec<(RowId, RowId)>, Self::Err> {
        let links = sqlx::query!(
            r#"
            SELECT source_row_id, target_row_id
            FROM database_row_links
            WHERE link_column_id = $1
            ORDER BY position NULLS LAST, created_at
            "#,
            column_id
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| (row.source_row_id, row.target_row_id))
        .collect();

        Ok(links)
    }

    #[tracing::instrument(err, skip(self, viewer, changes, expected_versions))]
    async fn apply_changes(
        &self,
        viewer: &Viewer,
        changes: &[RowChange],
        expected_versions: &HashMap<TableId, TableVersion>,
    ) -> Result<ApplyOutcome, Self::Err> {
        let mut transaction = self.pool.begin().await?;

        // Every table this changeset writes, resolved up front (links name a
        // column, not a table) so the version rows can be locked in one go.
        let mut link_tables: HashMap<ColumnId, Vec<TableId>> = HashMap::new();
        for change in changes {
            if let RowChange::Link { column_id, .. } | RowChange::Unlink { column_id, .. } = change
                && !link_tables.contains_key(column_id)
            {
                let tables = Self::link_column_tables(&mut transaction, *column_id).await?;
                link_tables.insert(*column_id, tables);
            }
        }
        // Sorted so concurrent changesets lock version rows in the same order
        // and cannot deadlock on each other.
        let written_tables: BTreeSet<TableId> = changes
            .iter()
            .flat_map(|change| match change {
                RowChange::Insert { table_id, .. }
                | RowChange::Update { table_id, .. }
                | RowChange::Delete { table_id, .. } => vec![*table_id],
                RowChange::Link { column_id, .. } | RowChange::Unlink { column_id, .. } => {
                    link_tables[column_id].clone()
                }
            })
            .collect();
        let written: Vec<TableId> = written_tables.iter().copied().collect();

        // Acquire database locks before table locks, matching parent deletion's
        // lock order. A concurrent trash must finish before this check or wait
        // until the changeset commits; catalog materialization alone is stale.
        let databases = sqlx::query!(
            r#"
            SELECT t.id AS table_id, d.trashed_at
            FROM database_tables t
            JOIN databases d ON d.id = t.database_id
            WHERE t.id = ANY($1)
            ORDER BY d.id, t.id
            FOR SHARE OF d
            "#,
            &written,
        )
        .fetch_all(&mut *transaction)
        .await?;
        for table_id in &written {
            if !databases
                .iter()
                .any(|row| row.table_id == *table_id && row.trashed_at.is_none())
            {
                return Ok(ApplyOutcome::VersionConflict {
                    table_id: *table_id,
                });
            }
        }

        // Compare-and-swap inside the transaction: lock the version rows,
        // then refuse if any expected version has moved.
        let current = sqlx::query!(
            r#"
            SELECT id, version FROM database_tables
            WHERE id = ANY($1)
            ORDER BY id
            FOR UPDATE
            "#,
            &written,
        )
        .fetch_all(&mut *transaction)
        .await?;
        for table_id in &written {
            let actual = current
                .iter()
                .find(|r| r.id == *table_id)
                .map(|r| r.version);
            let Some(actual) = actual else {
                return Ok(ApplyOutcome::VersionConflict {
                    table_id: *table_id,
                });
            };
            if let Some(expected) = expected_versions.get(table_id)
                && expected.0 != actual
            {
                transaction.rollback().await?;
                return Ok(ApplyOutcome::VersionConflict {
                    table_id: *table_id,
                });
            }
        }

        // Blind row writes retain cell-level last-write-wins, but must never
        // write under a definition removed by a concurrent schema rebind.
        // Table locks keep this binding check and inference mutually exclusive.
        let mut binding_tables = Vec::new();
        let mut binding_definitions = Vec::new();
        for change in changes {
            match change {
                RowChange::Insert { table_id, cells } => {
                    for id in cells.keys() {
                        binding_tables.push(*table_id);
                        binding_definitions.push(*id);
                    }
                }
                RowChange::Update {
                    table_id, cells, ..
                } => {
                    for id in cells.keys() {
                        binding_tables.push(*table_id);
                        binding_definitions.push(*id);
                    }
                }
                _ => {}
            }
        }
        let stale_table = sqlx::query_scalar!(
            r#"SELECT changed.table_id AS "table_id!"
            FROM UNNEST($1::uuid[], $2::uuid[]) AS changed(table_id, definition_id)
            WHERE NOT EXISTS (SELECT 1 FROM database_columns
                WHERE table_id = changed.table_id AND property_definition_id = changed.definition_id)
            LIMIT 1"#,
            &binding_tables, &binding_definitions,
        ).fetch_optional(&mut *transaction).await?;
        if let Some(table_id) = stale_table {
            return Ok(ApplyOutcome::VersionConflict { table_id });
        }

        // Row positions: one MAX per inserted-into table, then increment in
        // memory rather than a round trip per row.
        let mut next_positions: HashMap<TableId, String> = HashMap::new();
        let mut inserted_row_ids = Vec::new();

        for change in changes {
            match change {
                RowChange::Insert { table_id, cells } => {
                    if !next_positions.contains_key(table_id) {
                        let max_position = sqlx::query_scalar!(
                            r#"SELECT MAX(position) FROM database_rows WHERE table_id = $1"#,
                            table_id
                        )
                        .fetch_one(&mut *transaction)
                        .await?;
                        next_positions.insert(*table_id, next_position(max_position.as_deref()));
                    }
                    let position = next_positions[table_id].clone();
                    next_positions.insert(*table_id, next_position(Some(&position)));
                    let cells = cells_to_json(cells)?;
                    let row_id =
                        Self::insert_row(&mut transaction, viewer, *table_id, position, cells)
                            .await?;
                    inserted_row_ids.push(row_id);
                }
                RowChange::Update {
                    table_id,
                    row_id,
                    cells,
                } => {
                    let set: HashMap<
                        PropertyDefinitionId,
                        models_properties::api::requests::SetPropertyValue,
                    > = cells
                        .iter()
                        .filter_map(|(id, value)| value.clone().map(|v| (*id, v)))
                        .collect();
                    let cleared: Vec<String> = cells
                        .iter()
                        .filter(|(_, value)| value.is_none())
                        .map(|(id, _)| id.to_string())
                        .collect();
                    let set = cells_to_json(&set)?;
                    // Shallow merge scoped to the table: only the changed cells
                    // are replaced (and NULLed cells removed), so concurrent
                    // writers to other cells do not clobber.
                    let updated = sqlx::query!(
                        r#"
                        UPDATE database_rows
                        SET cells = (cells - $3::text[]) || $2::jsonb, updated_at = now()
                        WHERE id = $1 AND table_id = $4
                        "#,
                        row_id,
                        set,
                        &cleared,
                        table_id,
                    )
                    .execute(&mut *transaction)
                    .await?;
                    if updated.rows_affected() == 0 {
                        transaction.rollback().await?;
                        return Ok(ApplyOutcome::VersionConflict {
                            table_id: *table_id,
                        });
                    }
                }
                RowChange::Delete { table_id, row_id } => {
                    // Link edges cascade from the foreign keys.
                    let deleted = sqlx::query!(
                        r#"DELETE FROM database_rows WHERE id = $1 AND table_id = $2"#,
                        row_id,
                        table_id,
                    )
                    .execute(&mut *transaction)
                    .await?;
                    if deleted.rows_affected() == 0 {
                        transaction.rollback().await?;
                        return Ok(ApplyOutcome::VersionConflict {
                            table_id: *table_id,
                        });
                    }
                }
                RowChange::Link {
                    column_id,
                    source_row_id,
                    target_row_id,
                } => {
                    sqlx::query!(
                        r#"
                        INSERT INTO database_row_links (link_column_id, source_row_id, target_row_id)
                        VALUES ($1, $2, $3)
                        ON CONFLICT DO NOTHING
                        "#,
                        column_id,
                        source_row_id,
                        target_row_id,
                    )
                    .execute(&mut *transaction)
                    .await?;
                }
                RowChange::Unlink {
                    column_id,
                    source_row_id,
                    target_row_id,
                } => {
                    sqlx::query!(
                        r#"
                        DELETE FROM database_row_links
                        WHERE link_column_id = $1 AND source_row_id = $2 AND target_row_id = $3
                        "#,
                        column_id,
                        source_row_id,
                        target_row_id,
                    )
                    .execute(&mut *transaction)
                    .await?;
                }
            }
        }

        // SQL/AI/import writes also settle first-value inference. Only actual
        // values count: clearing a cell or inserting an untouched row does not.
        let mut valued_tables = Vec::new();
        let mut valued_definitions = Vec::new();
        for change in changes {
            match change {
                RowChange::Insert { table_id, cells } => {
                    for id in cells.keys() {
                        valued_tables.push(*table_id);
                        valued_definitions.push(*id);
                    }
                }
                RowChange::Update {
                    table_id, cells, ..
                } => {
                    for (id, value) in cells {
                        if value.is_some() {
                            valued_tables.push(*table_id);
                            valued_definitions.push(*id);
                        }
                    }
                }
                _ => {}
            }
        }
        if !valued_tables.is_empty() {
            sqlx::query!(
                r#"UPDATE database_columns SET infer_type = FALSE
                WHERE infer_type AND (table_id, property_definition_id) IN
                    (SELECT * FROM UNNEST($1::uuid[], $2::uuid[]))"#,
                &valued_tables,
                &valued_definitions,
            )
            .execute(&mut *transaction)
            .await?;
        }

        // Exactly one bump per written table, however many changes touched it.
        let bumped = sqlx::query!(
            r#"
            UPDATE database_tables
            SET version = version + 1
            WHERE id = ANY($1)
            RETURNING id, version
            "#,
            &written,
        )
        .fetch_all(&mut *transaction)
        .await?;
        let new_versions: HashMap<TableId, TableVersion> = bumped
            .into_iter()
            .map(|r| (r.id, TableVersion(r.version)))
            .collect();

        transaction.commit().await?;
        Ok(ApplyOutcome::Applied((inserted_row_ids, new_versions)))
    }

    #[tracing::instrument(skip(self), err)]
    async fn databases_by_ids(&self, ids: &[DatabaseId]) -> Result<Vec<Database>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT id, name, owner_id, created_at, trashed_at
            FROM databases
            WHERE id = ANY($1)
            ORDER BY created_at
            "#,
            ids,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| Database {
                id: r.id,
                name: r.name,
                owner_id: r.owner_id,
                created_at: r.created_at,
                trashed_at: r.trashed_at,
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn tables_for_databases(
        &self,
        database_ids: &[DatabaseId],
    ) -> Result<Vec<Table>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT id, database_id, name, position, version
            FROM database_tables
            WHERE database_id = ANY($1)
            ORDER BY database_id, position
            "#,
            database_ids,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| Table {
                id: r.id,
                database_id: r.database_id,
                name: r.name,
                position: r.position,
                version: TableVersion(r.version),
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn columns_for_tables(&self, table_ids: &[TableId]) -> Result<Vec<Column>, Self::Err> {
        let rows = sqlx::query!(
            r#"
            SELECT id, table_id, property_definition_id, position, config, display_name, infer_type
            FROM database_columns
            WHERE table_id = ANY($1)
            ORDER BY table_id, position
            "#,
            table_ids,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|r| {
                Ok(Column {
                    id: r.id,
                    table_id: r.table_id,
                    property_definition_id: r.property_definition_id,
                    position: r.position,
                    config: r.config.map(serde_json::from_value).transpose()?,
                    display_name: r.display_name,
                    infer_type: r.infer_type,
                })
            })
            .collect()
    }

    #[tracing::instrument(err, skip(self))]
    async fn bump_table_version(&self, table_id: TableId) -> Result<TableVersion, Self::Err> {
        let version = sqlx::query_scalar!(
            r#"UPDATE database_tables SET version = version + 1 WHERE id = $1 RETURNING version"#,
            table_id
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(TableVersion(version))
    }

    async fn table_versions(
        &self,
        table_ids: &[TableId],
    ) -> Result<HashMap<TableId, TableVersion>, Self::Err> {
        let versions = sqlx::query!(
            r#"SELECT id, version FROM database_tables WHERE id = ANY($1)"#,
            table_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| (row.id, TableVersion(row.version)))
        .collect();

        Ok(versions)
    }
}
