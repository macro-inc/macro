//! Postgres repository for databases, tables, columns and row identities;
//! cells are entity properties, written through the properties adapter.

/// The change journal's statements, shared with the cell store's batches.
pub(crate) mod journal;
/// Row identity statements, shared with the cell store's batches.
pub(crate) mod rows;
mod saved_queries;
/// Schema statements of the cell store's batches.
pub(crate) mod schema;
mod sharing;
mod stored;
#[cfg(test)]
mod test;
/// View and card-place statements, shared with the cell store's batches.
pub(crate) mod views;

use std::collections::HashMap;

use chrono::SubsecRound;

use models_databases::position::{Position, PositionError, key_between};
use uuid::Uuid;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::DataType;
use properties::domain::database_definition_writer::{
    DatabaseDefinitionWriter, NewDatabaseDefinition,
};
use sqlx::{PgPool, Postgres, Transaction};

use entity_access_db_utils::{AccessLevel, EntityAccessSourceType};
use model_entity::EntityType;

use crate::domain::models::{
    CardPosition, Column, ColumnId, ColumnReplacement, CreateDatabase, Database, DatabaseId,
    DatabaseView, FirstTable, PropertyDefinitionId, QueryDefinition, QueryId, RowId, RowRef,
    SavedQuery, Table, TableId, TableVersion, ViewId,
};
use crate::domain::ports::DatabasesRepo;

/// Errors from the Postgres repository.
#[derive(Debug, thiserror::Error)]
pub enum PgDatabasesRepoError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
    /// A domain value could not be encoded as JSON for storage, or a stored
    /// one decoded.
    #[error("failed to encode or decode stored json")]
    Json(#[from] serde_json::Error),
    /// A stored position is not a fractional key.
    #[error("stored position")]
    Position(#[from] PositionError),
    /// A stored card lane names no option, person or empty lane.
    #[error("stored card lane `{0}` names no lane")]
    CorruptLane(String),
    /// A board stored without a card title belongs to a table with no
    /// column to title it by.
    #[error("board {0} has no card title and its table no column")]
    UntitledBoard(ViewId),
    /// The properties domain refused or failed a write.
    #[error("properties write failed: {0}")]
    Properties(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// A stored journal row's kind is not one the journal writes.
    #[error("stored change kind `{0}` is not a row change kind")]
    CorruptChangeKind(String),
    /// This build cannot interpret the persisted journal payload format.
    #[error("unsupported database journal payload version {0}")]
    UnsupportedJournalPayloadVersion(i32),
}

/// The UUIDs of typed ids, for a statement's `ANY($n)`.
pub(crate) fn uuids<Id: Copy + Into<Uuid>>(ids: &[Id]) -> Vec<Uuid> {
    ids.iter().map(|id| (*id).into()).collect()
}

/// The positions as stored, for a statement's `UNNEST($n)`.
pub(crate) fn stored_positions(positions: &[Position]) -> Vec<String> {
    positions.iter().map(Position::to_string).collect()
}

/// A `database_entities` row, read by `query_as!` and mapped onto [`Database`].
pub(crate) struct DatabaseRecord {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) owner_id: String,
    pub(crate) created_at: chrono::DateTime<chrono::Utc>,
    pub(crate) trashed_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<DatabaseRecord> for Database {
    fn from(record: DatabaseRecord) -> Self {
        Self {
            id: DatabaseId::from_uuid(record.id),
            name: record.name,
            owner_id: record.owner_id,
            created_at: record.created_at,
            trashed_at: record.trashed_at,
        }
    }
}

/// A `database_tables` row, read by `query_as!` and mapped onto [`Table`].
pub(crate) struct TableRecord {
    pub(crate) id: Uuid,
    pub(crate) database_id: Uuid,
    pub(crate) name: String,
    pub(crate) position: String,
    pub(crate) version: i64,
}

impl TryFrom<TableRecord> for Table {
    type Error = PositionError;

    fn try_from(record: TableRecord) -> Result<Self, Self::Error> {
        Ok(Self {
            id: TableId::from_uuid(record.id),
            database_id: DatabaseId::from_uuid(record.database_id),
            name: record.name,
            position: record.position.parse()?,
            version: TableVersion(record.version),
        })
    }
}

/// Stored table rows as tables.
pub(crate) fn tables_of(records: Vec<TableRecord>) -> Result<Vec<Table>, PositionError> {
    records.into_iter().map(Table::try_from).collect()
}

/// The largest stored position of a list, read back.
pub(crate) fn last_position(stored: Option<String>) -> Result<Option<Position>, PositionError> {
    stored.map(|key| key.parse()).transpose()
}

/// The position that appends after `last`, the largest one a list has, or
/// starts an empty list. Positions are fractional keys compared as bytes
/// (the columns are `COLLATE "C"`), so the largest is the last.
fn position_after(last: Option<&Position>) -> Result<Position, PositionError> {
    key_between(last, None)
}

/// Insert the core resource and its app entity with the owner grant atomically.
pub(crate) async fn insert_owned_database(
    transaction: &mut Transaction<'static, Postgres>,
    database: &Database,
) -> Result<(), PgDatabasesRepoError> {
    sqlx::query!(
        "INSERT INTO databases (id) VALUES ($1)",
        database.id.into_uuid()
    )
    .execute(&mut **transaction)
    .await?;
    sqlx::query!(
        "INSERT INTO database_entities (database_id, name, user_id, created_at) VALUES ($1, $2, $3, $4)",
        database.id.into_uuid(),
        database.name,
        database.owner_id,
        database.created_at,
    )
    .execute(&mut **transaction)
    .await?;
    entity_access_db_utils::insert_entity_access_row(
        transaction,
        database.id.as_uuid(),
        EntityType::Database,
        &database.owner_id,
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await?;
    Ok(())
}

/// Insert a column placement bound to `definition_id` inside `transaction`;
/// `infer_type` lets its first value settle a plain text column's type.
pub(crate) async fn insert_column(
    transaction: &mut Transaction<'static, Postgres>,
    column_id: ColumnId,
    table_id: TableId,
    definition_id: PropertyDefinitionId,
    position: &Position,
    infer_type: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO database_columns (id, table_id, property_definition_id, position, infer_type) VALUES ($1, $2, $3, $4, $5)",
        column_id.into_uuid(),
        table_id.into_uuid(),
        definition_id,
        position.as_str(),
        infer_type,
    )
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// [`DatabasesRepo`] backed by MacroDB; a new database's title definition is
/// written through the properties domain, in the same transaction.
#[derive(Debug, Clone)]
pub struct PgDatabasesRepo<Properties> {
    pool: PgPool,
    properties: Properties,
}

impl<Properties> PgDatabasesRepo<Properties> {
    /// Create a repository over the pool and the properties writer.
    pub fn new(pool: PgPool, properties: Properties) -> Self {
        Self { pool, properties }
    }
}

impl<Properties> DatabasesRepo for PgDatabasesRepo<Properties>
where
    Properties: DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>
        + Send
        + Sync
        + 'static,
{
    type Error = PgDatabasesRepoError;

    #[tracing::instrument(err, skip(self))]
    async fn views_for_tables(
        &self,
        table_ids: &[TableId],
    ) -> Result<Vec<DatabaseView>, Self::Error> {
        views::views_for_tables(&self.pool, table_ids).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn view_positions(&self, view_id: ViewId) -> Result<Vec<CardPosition>, Self::Error> {
        views::view_positions(&self.pool, view_id).await
    }

    #[tracing::instrument(err, skip(self, definition))]
    async fn save_query(
        &self,
        database_id: Option<DatabaseId>,
        definition: &QueryDefinition,
        created_by: &MacroUserIdStr<'_>,
    ) -> Result<SavedQuery, Self::Error> {
        self.insert_query(database_id, definition, created_by.as_ref())
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_query(&self, id: QueryId) -> Result<Option<SavedQuery>, Self::Error> {
        self.query_by_id(id).await
    }

    #[tracing::instrument(err, skip(self, command))]
    async fn create_database(
        &self,
        command: &CreateDatabase,
        first_table: FirstTable,
    ) -> Result<Database, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        let database = Database {
            id: DatabaseId::new(),
            name: command.name.clone(),
            owner_id: command.owner_id.to_string(),
            // Stored to the microsecond, so the answer matches what reads return.
            created_at: chrono::Utc::now().trunc_subsecs(6),
            trashed_at: None,
        };
        insert_owned_database(&mut transaction, &database).await?;
        let table_id = TableId::new();
        let table_position = position_after(None)?;
        sqlx::query!(
            r#"
            INSERT INTO database_tables (id, database_id, name, position)
            VALUES ($1, $2, $3, $4)
            "#,
            table_id.into_uuid(),
            database.id.into_uuid(),
            first_table.name,
            table_position.as_str(),
        )
        .execute(&mut *transaction)
        .await?;
        let title = self
            .properties
            .create_database_definition_in(
                &mut transaction,
                NewDatabaseDefinition {
                    id: macro_uuid::generate_uuid_v7(),
                    database_id: database.id.into_uuid(),
                    name: first_table.title_column,
                    data_type: DataType::String,
                    is_multi_select: false,
                    specific_entity_type: None,
                    options: &[],
                },
            )
            .await
            .map_err(|error| PgDatabasesRepoError::Properties(Box::new(error)))?;
        insert_column(
            &mut transaction,
            ColumnId::new(),
            table_id,
            title.definition.id,
            &position_after(None)?,
            true,
        )
        .await?;
        transaction.commit().await?;
        Ok(database)
    }

    #[tracing::instrument(err, skip(self))]
    async fn starter_database(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<DatabaseId>, Self::Error> {
        Ok(sqlx::query_scalar!(
            r#"SELECT d.database_id FROM database_starter_seeds s JOIN database_entities d ON d.database_id = s.database_id
                   WHERE s.user_id = $1 AND d.trashed_at IS NULL"#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(DatabaseId::from_uuid))
    }

    /// Returns the row whether or not it is trashed; the domain decides what a
    /// trashed database means.
    #[tracing::instrument(err, skip(self))]
    async fn get_database(
        &self,
        id: DatabaseId,
    ) -> Result<Option<(Database, Vec<Table>)>, Self::Error> {
        let Some(database) = sqlx::query_as!(
            DatabaseRecord,
            r#"SELECT database_id AS id, name, user_id AS owner_id, created_at, trashed_at FROM database_entities WHERE database_id = $1"#,
            id.into_uuid()
        )
        .fetch_optional(&self.pool)
        .await?
        .map(Database::from) else {
            return Ok(None);
        };

        let tables = sqlx::query_as!(
            TableRecord,
            r#"
            SELECT id, database_id, name, position, version
            FROM database_tables
            WHERE database_id = $1
            ORDER BY position
            "#,
            id.into_uuid()
        )
        .fetch_all(&self.pool)
        .await?;
        let tables = tables_of(tables)?;

        Ok(Some((database, tables)))
    }

    #[tracing::instrument(err, skip(self))]
    async fn rename_database(&self, id: DatabaseId, name: &str) -> Result<bool, Self::Error> {
        let renamed = sqlx::query!(
            r#"UPDATE database_entities SET name = $2, updated_at = now() WHERE database_id = $1"#,
            id.into_uuid(),
            name,
        )
        .execute(&self.pool)
        .await?;
        Ok(renamed.rows_affected() == 1)
    }

    #[tracing::instrument(err, skip(self))]
    async fn trash_database(
        &self,
        id: DatabaseId,
        trashed_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<bool, Self::Error> {
        let trashed = sqlx::query!(
            r#"UPDATE database_entities SET trashed_at = $2, updated_at = now() WHERE database_id = $1"#,
            id.into_uuid(),
            trashed_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(trashed.rows_affected() == 1)
    }

    #[tracing::instrument(err, skip(self))]
    async fn restore_database(&self, id: DatabaseId) -> Result<bool, Self::Error> {
        let restored = sqlx::query!(
            r#"UPDATE database_entities SET trashed_at = NULL, updated_at = now() WHERE database_id = $1"#,
            id.into_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(restored.rows_affected() == 1)
    }

    /// Deleting the app entity cleans up its owned storage, grants and journal,
    /// including the same cleanup used when its owner is deleted.
    #[tracing::instrument(err, skip(self))]
    async fn delete_database(&self, id: DatabaseId) -> Result<(), Self::Error> {
        sqlx::query!(
            r#"DELETE FROM database_entities WHERE database_id = $1"#,
            id.into_uuid()
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, table, column, actor))]
    async fn infer_column_type(
        &self,
        table: &Table,
        column: &Column,
        definition_id: PropertyDefinitionId,
        actor: &crate::domain::journal::JournalActor,
    ) -> Result<Option<TableVersion>, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        if !rows::lock_live_database(&mut transaction, table.database_id).await? {
            return Ok(None);
        }
        // Row writers take this same lock before checking versions and cells.
        let current = sqlx::query_scalar!(
            "SELECT version FROM database_tables WHERE id = $1 AND database_id = $2 FOR UPDATE",
            table.id.into_uuid(),
            table.database_id.into_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if current != Some(table.version.0) {
            return Ok(None);
        }
        let updated = sqlx::query_scalar!(
            r#"UPDATE database_columns SET property_definition_id = $4, infer_type = FALSE
            WHERE id = $1 AND table_id = $2 AND property_definition_id = $3 AND infer_type
              AND NOT EXISTS (
                  SELECT 1 FROM entity_properties p
                  JOIN database_rows r ON r.id::text = p.entity_id
                  WHERE r.table_id = $2 AND p.property_definition_id = $3
                    AND p.entity_type = 'DATABASE_ROW')
              AND EXISTS (SELECT 1 FROM database_entities WHERE database_id = $5 AND trashed_at IS NULL)
            RETURNING id"#,
            column.id.into_uuid(),
            table.id.into_uuid(),
            column.property_definition_id,
            definition_id,
            table.database_id.into_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if updated.is_none() {
            return Ok(None);
        }
        let version = rows::bump_table_version(&mut *transaction, table.id).await?;
        journal::record(
            &mut transaction,
            actor,
            &[crate::domain::journal::settled_column(
                table.database_id,
                table.id,
                version,
                column.id,
            )],
        )
        .await?;
        transaction.commit().await?;
        Ok(Some(version))
    }

    #[tracing::instrument(err, skip(self))]
    async fn row_refs(&self, table_id: TableId) -> Result<Vec<RowRef>, Self::Error> {
        let rows = sqlx::query!(
            "SELECT id, position FROM database_rows WHERE table_id = $1 ORDER BY position, id",
            table_id.into_uuid(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                Ok(RowRef {
                    id: RowId::from_uuid(row.id),
                    position: row.position.parse()?,
                })
            })
            .collect::<Result<_, PositionError>>()?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn databases_by_ids(&self, ids: &[DatabaseId]) -> Result<Vec<Database>, Self::Error> {
        Ok(sqlx::query_as!(
            DatabaseRecord,
            r#"
            SELECT database_id AS id, name, user_id AS owner_id, created_at, trashed_at
            FROM database_entities
            WHERE database_id = ANY($1)
            ORDER BY created_at
            "#,
            &uuids(ids),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(Database::from)
        .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn tables_for_databases(
        &self,
        database_ids: &[DatabaseId],
    ) -> Result<Vec<Table>, Self::Error> {
        let tables = sqlx::query_as!(
            TableRecord,
            r#"
            SELECT id, database_id, name, position, version
            FROM database_tables
            WHERE database_id = ANY($1)
            ORDER BY database_id, position
            "#,
            &uuids(database_ids),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(tables_of(tables)?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn columns_for_tables(&self, table_ids: &[TableId]) -> Result<Vec<Column>, Self::Error> {
        let rows = sqlx::query!(
            r#"
            SELECT id, table_id, property_definition_id, position, config, display_name, infer_type
            FROM database_columns
            WHERE table_id = ANY($1)
            ORDER BY table_id, position
            "#,
            &uuids(table_ids),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(Column {
                    id: ColumnId::from_uuid(row.id),
                    table_id: TableId::from_uuid(row.table_id),
                    property_definition_id: row.property_definition_id,
                    position: row.position.parse()?,
                    config: row.config.map(serde_json::from_value).transpose()?,
                    display_name: row.display_name,
                    infer_type: row.infer_type,
                })
            })
            .collect()
    }

    #[tracing::instrument(err, skip(self))]
    async fn change(
        &self,
        database_id: DatabaseId,
        change: crate::domain::models::ChangeId,
    ) -> Result<Option<crate::domain::journal::ChangeRecord>, Self::Error> {
        let mut connection = self.pool.acquire().await?;
        journal::change(&mut connection, database_id, change).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn changes_after(
        &self,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<Vec<crate::domain::journal::ChangeRecord>, Self::Error> {
        let mut connection = self.pool.acquire().await?;
        journal::changes_after(&mut connection, table_id, version).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn touches_after(
        &self,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<Vec<crate::domain::journal::VersionTouches>, Self::Error> {
        let mut connection = self.pool.acquire().await?;
        journal::touches_after(&mut connection, table_id, version).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn row_history(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        row_id: RowId,
    ) -> Result<Vec<crate::domain::journal::JournaledRowChange>, Self::Error> {
        journal::row_history(&self.pool, database_id, table_id, row_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn table_versions(
        &self,
        table_ids: &[TableId],
    ) -> Result<HashMap<TableId, TableVersion>, Self::Error> {
        let versions = sqlx::query!(
            r#"SELECT id, version FROM database_tables WHERE id = ANY($1)"#,
            &uuids(table_ids)
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| (TableId::from_uuid(row.id), TableVersion(row.version)))
        .collect();

        Ok(versions)
    }
}
