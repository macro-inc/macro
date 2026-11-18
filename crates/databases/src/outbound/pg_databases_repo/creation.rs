//! Creation transactions shared by root and import-folder creation.

use super::*;

impl<Properties> PgDatabasesRepo<Properties>
where
    Properties: DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>
        + Send
        + Sync
        + 'static,
{
    pub(super) async fn create_database_at(
        &self,
        command: &CreateDatabase,
        first_table: FirstTable,
        project_id: Option<&str>,
        database_id: DatabaseId,
    ) -> Result<Database, PgDatabasesRepoError> {
        let mut transaction = self.pool.begin().await?;
        let table_id = first_table.ids.map(|ids| ids.table).unwrap_or_default();
        let mut database = insert_owned_database(
            &mut transaction,
            database_id,
            &command.name,
            command.owner_id.as_ref(),
            table_id,
            &first_table.name,
        )
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
            first_table
                .ids
                .map(|ids| ids.title_column)
                .unwrap_or_default(),
            table_id,
            title.definition.id,
            &position_after(None)?,
            true,
        )
        .await?;
        if let Some(project_id) = project_id {
            // Import sharing is reviewed per database. Filing must never apply
            // the page folder's inherited grants to its imported data.
            sqlx::query!(
                "UPDATE database_entities SET project_id = $2, updated_at = now() WHERE database_id = $1",
                database.id.into_uuid(),
                project_id,
            ).execute(&mut *transaction).await?;
            database.project_id = Some(project_id.to_string());
        }
        transaction.commit().await?;
        Ok(database)
    }
}
