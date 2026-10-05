//! Imports: the table, its placements, its rows and their cells, committed
//! together so a retry never finds half an import.

use models_databases::position::{key_between, keys_between};
use models_databases::{ColumnId, RowId};
use uuid::Uuid;

use super::*;
use crate::domain::journal::created_table;
use crate::domain::models::{DatabaseId, Table, Viewer};
use crate::domain::transfer::{
    DatabaseTransferRepo, ImportFingerprint, ImportOutcome, ImportTable,
};
use crate::outbound::pg_databases_repo::{TableRecord, last_position, stored_positions, uuids};
use models_databases::position::Position;

/// Rows minted per `INSERT … UNNEST` statement.
const ROWS_PER_INSERT: usize = 500;

/// A `database_tables` row with the import key's fingerprint.
struct ImportedTableRecord {
    id: Uuid,
    database_id: Uuid,
    name: String,
    position: String,
    version: i64,
    import_fingerprint: Option<String>,
}

impl ImportedTableRecord {
    fn into_table(self) -> Result<(Table, Option<String>), PgDatabasesRepoError> {
        let fingerprint = self.import_fingerprint;
        let table = TableRecord {
            id: self.id,
            database_id: self.database_id,
            name: self.name,
            position: self.position,
            version: self.version,
        };
        Ok((table.try_into()?, fingerprint))
    }
}

impl<Properties> DatabaseTransferRepo for PgCellStore<Properties>
where
    Properties: PropertiesRepo<Err = anyhow::Error>
        + DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>
        + Send
        + Sync
        + 'static,
{
    type Error = PgCellStoreError;

    #[tracing::instrument(err, skip(self))]
    async fn imported_table(
        &self,
        database_id: DatabaseId,
        request_id: Uuid,
    ) -> Result<Option<(Table, ImportFingerprint)>, Self::Error> {
        let imported = sqlx::query_as!(
            ImportedTableRecord,
            "SELECT id, database_id, name, position, version, import_fingerprint FROM database_tables WHERE database_id = $1 AND import_key = $2",
            database_id.into_uuid(),
            request_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        imported
            .map(|record| {
                let (table, fingerprint) = record.into_table()?;
                let fingerprint =
                    fingerprint.ok_or(PgCellStoreError::MissingImportFingerprint(table.id))?;
                Ok((table, ImportFingerprint(fingerprint)))
            })
            .transpose()
    }

    #[tracing::instrument(err, skip(self, viewer, request, fingerprint, definitions, cells))]
    async fn import_table(
        &self,
        database_id: DatabaseId,
        viewer: &Viewer,
        request: &ImportTable,
        fingerprint: &ImportFingerprint,
        definitions: &[PropertyDefinitionId],
        cells: &[Vec<(PropertyDefinitionId, PropertyValue)>],
    ) -> Result<ImportOutcome, Self::Error> {
        let fingerprint = fingerprint.0.as_str();
        let mut transaction = self.pool.begin().await?;
        if !rows::lock_live_database(&mut *transaction, database_id).await? {
            return Ok(ImportOutcome::NotFound);
        }
        let replayed = sqlx::query_as!(
            ImportedTableRecord,
            "SELECT id, database_id, name, position, version, import_fingerprint FROM database_tables WHERE database_id = $1 AND import_key = $2",
            database_id.into_uuid(),
            request.request_id,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(record) = replayed {
            let (table, stored) = record.into_table()?;
            return Ok(if stored.as_deref() == Some(fingerprint) {
                ImportOutcome::Replayed(table)
            } else {
                ImportOutcome::KeyConflict
            });
        }
        let max_position = sqlx::query_scalar!(
            "SELECT MAX(position) FROM database_tables WHERE database_id = $1",
            database_id.into_uuid()
        )
        .fetch_one(&mut *transaction)
        .await?;
        let id = TableId::new();
        let position = last_position(max_position)
            .and_then(|last| key_between(last.as_ref(), None))
            .map_err(PgDatabasesRepoError::from)?;
        let table = sqlx::query_as!(
            TableRecord,
            r#"INSERT INTO database_tables (id, database_id, name, position, version, import_key, import_fingerprint)
               SELECT $1, $2, $3, $4, 1, $5, $6 WHERE NOT EXISTS (
                   SELECT 1 FROM database_tables WHERE database_id = $2 AND lower(name) = lower($3))
               RETURNING id, database_id, name, position, version"#,
            id.into_uuid(),
            database_id.into_uuid(),
            request.name,
            position.as_str(),
            request.request_id,
            fingerprint,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(table) = table else {
            return Ok(ImportOutcome::NameConflict);
        };
        let column_positions =
            keys_between(None, None, definitions.len()).map_err(PgDatabasesRepoError::from)?;
        let mut columns = Vec::with_capacity(definitions.len());
        for (definition, position) in definitions.iter().zip(column_positions) {
            let column = ColumnId::new();
            columns.push(column);
            sqlx::query!(
                "INSERT INTO database_columns (id, table_id, property_definition_id, position, infer_type) VALUES ($1, $2, $3, $4, false)",
                column.into_uuid(),
                id.into_uuid(),
                definition,
                position.as_str(),
            )
            .execute(&mut *transaction)
            .await?;
        }
        let mut rows = Vec::with_capacity(request.rows.len());
        let mut row_positions = keys_between(None, None, request.rows.len())
            .map_err(PgDatabasesRepoError::from)?
            .into_iter();
        for batch in request.rows.chunks(ROWS_PER_INSERT) {
            let row_ids: Vec<RowId> = batch.iter().map(|_| RowId::new()).collect();
            let positions: Vec<Position> = row_positions.by_ref().take(batch.len()).collect();
            sqlx::query!(
                r#"INSERT INTO database_rows (id, table_id, position, created_by)
                   SELECT row_id, $1, position, $2 FROM UNNEST($3::uuid[], $4::text[]) AS data(row_id, position)"#,
                id.into_uuid(),
                viewer.user_id.as_ref(),
                &uuids(&row_ids),
                &stored_positions(&positions),
            )
            .execute(&mut *transaction)
            .await?;
            rows.extend(row_ids);
        }
        for (row, row_cells) in rows.iter().zip(cells) {
            for (definition, value) in row_cells {
                self.properties
                    .upsert_entity_property_in(
                        &mut transaction,
                        &row_entity(*row),
                        *definition,
                        Some(value.clone()),
                    )
                    .await
                    .map_err(cells_error)?;
            }
        }
        let table: Table = table.try_into().map_err(PgDatabasesRepoError::from)?;
        journal::record(
            &mut transaction,
            &JournalActor {
                user: Some(viewer.user_id.to_string()),
                acting_bot: viewer.acting_bot,
            },
            &[created_table(
                database_id,
                table.id,
                table.version,
                &columns,
                &rows,
            )],
        )
        .await?;
        transaction.commit().await?;
        Ok(ImportOutcome::Created(table))
    }
}
