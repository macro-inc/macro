use super::*;
use crate::domain::transfer::{DatabaseTransferRepo, ImportOutcome, ImportTable};
use models_properties::service::property_value::PropertyValue;

impl DatabaseTransferRepo for PgDatabasesRepo {
    type Err = PgDatabasesRepoError;

    async fn imported_table(
        &self,
        database_id: DatabaseId,
        request_id: Uuid,
    ) -> Result<Option<(Table, String)>, Self::Err> {
        let row = sqlx::query!(
            "SELECT id, database_id, name, position, version, import_fingerprint FROM database_tables WHERE database_id = $1 AND import_key = $2",
            database_id, request_id,
        ).fetch_optional(&self.pool).await?;
        Ok(row.map(|row| {
            (
                Table {
                    id: row.id,
                    database_id: row.database_id,
                    name: row.name,
                    position: row.position,
                    version: TableVersion(row.version),
                },
                row.import_fingerprint.unwrap_or_default(),
            )
        }))
    }

    async fn import_table(
        &self,
        database_id: DatabaseId,
        viewer: &Viewer,
        request: &ImportTable,
        fingerprint: &str,
        definitions: &[PropertyDefinitionId],
    ) -> Result<ImportOutcome, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        if sqlx::query_scalar!(
            "SELECT id FROM databases WHERE id = $1 AND trashed_at IS NULL FOR UPDATE",
            database_id
        )
        .fetch_optional(&mut *transaction)
        .await?
        .is_none()
        {
            return Ok(ImportOutcome::NotFound);
        }
        if let Some(row) = sqlx::query!(
            "SELECT id, database_id, name, position, version, import_fingerprint FROM database_tables WHERE database_id = $1 AND import_key = $2",
            database_id, request.request_id,
        ).fetch_optional(&mut *transaction).await? {
            return Ok(if row.import_fingerprint.as_deref() == Some(fingerprint) {
                ImportOutcome::Replayed(Table { id: row.id, database_id: row.database_id,
                    name: row.name, position: row.position, version: TableVersion(row.version) })
            } else { ImportOutcome::KeyConflict });
        }
        let max_position = sqlx::query_scalar!(
            "SELECT MAX(position) FROM database_tables WHERE database_id = $1",
            database_id
        )
        .fetch_one(&mut *transaction)
        .await?;
        let id = macro_uuid::generate_uuid_v7();
        let position = next_position(max_position.as_deref());
        let table = sqlx::query!(
            r#"INSERT INTO database_tables (id, database_id, name, position, version, import_key, import_fingerprint)
               SELECT $1, $2, $3, $4, 1, $5, $6 WHERE NOT EXISTS (
                   SELECT 1 FROM database_tables WHERE database_id = $2 AND lower(name) = lower($3))
               RETURNING id, database_id, name, position, version"#,
            id, database_id, request.name, position, request.request_id, fingerprint,
        ).fetch_optional(&mut *transaction).await?;
        let Some(table) = table else {
            return Ok(ImportOutcome::NameConflict);
        };
        for (index, definition) in definitions.iter().enumerate() {
            let column_id = macro_uuid::generate_uuid_v7();
            let position = format!("{:0POSITION_WIDTH$}", index + 1);
            sqlx::query!(
                "INSERT INTO database_columns (id, table_id, property_definition_id, position, infer_type) VALUES ($1, $2, $3, $4, false)",
                column_id, id, definition, position,
            ).execute(&mut *transaction).await?;
        }
        // Batch rows in a bounded INSERT using Postgres arrays; CSV values are
        // already parsed strings, never SQL fragments or coerced numbers.
        for (batch_index, batch) in request.rows.chunks(500).enumerate() {
            let mut row_ids = Vec::with_capacity(batch.len());
            let mut positions = Vec::with_capacity(batch.len());
            let mut cells = Vec::with_capacity(batch.len());
            for (index, values) in batch.iter().enumerate() {
                row_ids.push(macro_uuid::generate_uuid_v7());
                positions.push(format!(
                    "{:0POSITION_WIDTH$}",
                    batch_index * 500 + index + 1
                ));
                let row: HashMap<_, _> = definitions
                    .iter()
                    .zip(values)
                    .map(|(id, value)| (id.to_string(), PropertyValue::Str(value.clone())))
                    .collect();
                cells.push(serde_json::to_value(row)?);
            }
            sqlx::query!(
                r#"INSERT INTO database_rows (id, table_id, position, cells, created_by)
                   SELECT row_id, $1, position, cells, $2 FROM UNNEST($3::uuid[], $4::text[], $5::jsonb[]) AS data(row_id, position, cells)"#,
                id, viewer.user_id.as_ref(), &row_ids, &positions, &cells,
            ).execute(&mut *transaction).await?;
        }
        transaction.commit().await?;
        Ok(ImportOutcome::Created(Table {
            id: table.id,
            database_id: table.database_id,
            name: table.name,
            position: table.position,
            version: TableVersion(table.version),
        }))
    }
}
