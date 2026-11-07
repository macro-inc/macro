use super::*;
use crate::domain::provisioning::{DatabaseStorageProvisioner, StorageBlueprint};
use crate::outbound::pg_databases_repo::insert_column;
use models_databases::position::key_between;
use properties::domain::database_cell_writer::DatabaseCellWriter;

impl<Properties> DatabaseStorageProvisioner for PgCellStore<Properties>
where
    Properties: PropertiesRepo<Err = anyhow::Error>
        + DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>
        + DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>
        + DatabaseOptionWriter
        + Send
        + Sync
        + 'static,
{
    type Transaction = Transaction<'static, Postgres>;

    #[tracing::instrument(skip_all, err)]
    async fn create_storage_in(
        &self,
        transaction: &mut Self::Transaction,
        database: &StorageBlueprint,
    ) -> Result<(), Self::Error> {
        sqlx::query!(
            "INSERT INTO databases (id) VALUES ($1)",
            database.id.into_uuid()
        )
        .execute(&mut **transaction)
        .await?;
        let position = key_between(None, None).map_err(PgDatabasesRepoError::from)?;
        sqlx::query!(
            "INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Records', $3)",
            database.table_id.into_uuid(), database.id.into_uuid(), position.as_str(),
        ).execute(&mut **transaction).await?;
        let positions =
            models_databases::position::keys_between(None, None, database.columns.len())
                .map_err(PgDatabasesRepoError::from)?;
        for (column, position) in database.columns.iter().zip(positions) {
            let definition = self
                .properties
                .create_database_definition_in(
                    transaction,
                    NewDatabaseDefinition {
                        id: macro_uuid::generate_uuid_v7(),
                        database_id: database.id.into_uuid(),
                        name: &column.name,
                        data_type: column.data_type,
                        is_multi_select: false,
                        specific_entity_type: column.entity_type,
                        options: &column.options,
                    },
                )
                .await
                .map_err(|error| PgCellStoreError::Cells(Box::new(error)))?;
            insert_column(
                transaction,
                column.id,
                database.table_id,
                definition.definition.id,
                &position,
                false,
            )
            .await?;
            sqlx::query!(
                "UPDATE database_columns SET nullable = $2 WHERE id = $1",
                column.id.into_uuid(),
                column.nullable
            )
            .execute(&mut **transaction)
            .await?;
            for capability in &column.protections {
                sqlx::query!(
                    "INSERT INTO database_column_protections (column_id, capability) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                    column.id.into_uuid(), capability.to_string(),
                )
                .execute(&mut **transaction)
                .await?;
            }
        }
        Ok(())
    }
}
