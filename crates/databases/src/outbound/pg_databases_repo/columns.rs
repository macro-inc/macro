use super::*;

impl PgDatabasesRepo {
    async fn lock_column_tables<'a>(
        &'a self,
        table: &Table,
        ids: &[TableId],
    ) -> Result<Option<Transaction<'a, Postgres>>, PgDatabasesRepoError> {
        let mut transaction = self.pool.begin().await?;
        // Parent locks precede table locks, exactly as row writes and purge do.
        let databases = sqlx::query!(
            "SELECT t.id AS table_id, d.id AS database_id, d.trashed_at
             FROM database_tables t JOIN databases d ON d.id = t.database_id
             WHERE t.id = ANY($1) ORDER BY d.id, t.id FOR SHARE OF d",
            ids
        )
        .fetch_all(&mut *transaction)
        .await?;
        if !databases.iter().any(|row| {
            row.table_id == table.id
                && row.database_id == table.database_id
                && row.trashed_at.is_none()
        }) {
            transaction.rollback().await?;
            return Ok(None);
        }
        let versions = sqlx::query!(
            "SELECT id, version FROM database_tables WHERE id = ANY($1) ORDER BY id FOR UPDATE",
            ids
        )
        .fetch_all(&mut *transaction)
        .await?;
        if !versions
            .iter()
            .any(|row| row.id == table.id && row.version == table.version.0)
        {
            transaction.rollback().await?;
            return Ok(None);
        }
        Ok(Some(transaction))
    }

    pub(super) async fn replace_column_placement(
        &self,
        table: &Table,
        replacement: &ColumnReplacement,
    ) -> Result<Option<TableVersion>, PgDatabasesRepoError> {
        let Some(mut tx) = self.lock_column_tables(table, &[table.id]).await? else {
            return Ok(None);
        };
        let config = replacement
            .config
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?;
        let changed = sqlx::query!(
            "UPDATE database_columns SET property_definition_id = $4, config = $5, infer_type = false
             WHERE id = $1 AND table_id = $2 AND property_definition_id = $3",
            replacement.column.id, table.id, replacement.column.property_definition_id,
            replacement.definition_id, config
        ).execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(None);
        }
        let values: serde_json::Map<String, serde_json::Value> = replacement
            .values
            .iter()
            .map(|(id, value)| Ok((id.to_string(), serde_json::to_value(value)?)))
            .collect::<Result<_, serde_json::Error>>()?;
        let values = serde_json::Value::Object(values);
        let old_key = replacement.column.property_definition_id.to_string();
        let new_key = replacement.definition_id.to_string();
        sqlx::query!(
            "UPDATE database_rows SET cells = (cells - $2::text) ||
             CASE WHEN $4::jsonb ? id::text THEN jsonb_build_object($3::text, $4::jsonb -> id::text)
             ELSE '{}'::jsonb END, updated_at = now()
             WHERE table_id = $1 AND cells ? $2::text",
            table.id,
            old_key,
            new_key,
            values
        )
        .execute(&mut *tx)
        .await?;
        let version = sqlx::query_scalar!(
            "UPDATE database_tables SET version = version + 1 WHERE id = $1 RETURNING version",
            table.id
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(TableVersion(version)))
    }

    pub(super) async fn delete_column_placement(
        &self,
        table: &Table,
        column: &Column,
    ) -> Result<Option<ColumnSchemaOutcome>, PgDatabasesRepoError> {
        let mut tables = vec![table.id];
        if let Some(ColumnConfig::Link { table_id, .. }) = column.config
            && table_id != table.id
        {
            tables.push(table_id);
        }
        let Some(mut tx) = self.lock_column_tables(table, &tables).await? else {
            return Ok(None);
        };
        let changed = sqlx::query!(
            "DELETE FROM database_columns WHERE id = $1 AND table_id = $2 AND property_definition_id = $3",
            column.id, table.id, column.property_definition_id
        ).execute(&mut *tx).await?;
        if changed.rows_affected() != 1 {
            tx.rollback().await?;
            return Ok(None);
        }
        let key = column.property_definition_id.to_string();
        sqlx::query!(
            "UPDATE database_rows SET cells = cells - $2::text, updated_at = now()
             WHERE table_id = $1 AND cells ? $2::text",
            table.id,
            key
        )
        .execute(&mut *tx)
        .await?;
        let versions = sqlx::query!(
            "UPDATE database_tables SET version = version + 1 WHERE id = ANY($1) RETURNING id, version",
            &tables
        ).fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(Some(ColumnSchemaOutcome {
            table_versions: versions
                .into_iter()
                .map(|row| (row.id, TableVersion(row.version)))
                .collect(),
        }))
    }

    pub(super) async fn reorder_column_placements(
        &self,
        table: &Table,
        ids: &[ColumnId],
    ) -> Result<Option<TableVersion>, PgDatabasesRepoError> {
        let Some(mut tx) = self.lock_column_tables(table, &[table.id]).await? else {
            return Ok(None);
        };
        for (index, id) in ids.iter().enumerate() {
            let position = format!("{:0POSITION_WIDTH$}", index + 1);
            let result = sqlx::query!(
                "UPDATE database_columns SET position = $3 WHERE id = $1 AND table_id = $2",
                id,
                table.id,
                position
            )
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() != 1 {
                tx.rollback().await?;
                return Ok(None);
            }
        }
        let version = sqlx::query_scalar!(
            "UPDATE database_tables SET version = version + 1 WHERE id = $1 RETURNING version",
            table.id
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(TableVersion(version)))
    }
}
