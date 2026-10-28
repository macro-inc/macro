//! The [`ColumnDefinitionStore`] port over the properties domain: a column's
//! definition is a `property_definitions` row owned by its database.

#[cfg(test)]
mod test;

use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::{DataType, EntityType};
use properties::domain::database_definition_writer::{
    DatabaseDefinitionWriter, NewDatabaseDefinition,
};
use properties::domain::ports::PropertiesRepo;
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::models::{DatabaseId, OptionId, PropertyDefinitionId, Viewer};
use crate::domain::ports::ColumnDefinitionStore;

/// Errors from the column-definition store.
#[derive(Debug, thiserror::Error)]
pub enum PgDefinitionStoreError {
    /// Failure from the owning properties domain.
    #[error("properties error: {0}")]
    Properties(#[source] anyhow::Error),
    /// The properties domain failed a write inside the store's transaction.
    #[error("properties write failed: {0}")]
    Write(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// The store's transaction failed.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
}

/// [`ColumnDefinitionStore`] over the properties domain's repository, which
/// owns `property_definitions` and `property_options`.
#[derive(Debug, Clone)]
pub struct PgDefinitionStore<Properties> {
    pool: PgPool,
    properties: Properties,
}

impl<Properties> PgDefinitionStore<Properties> {
    /// Create a store over the pool and the owning properties domain's ports.
    pub fn new(pool: PgPool, properties: Properties) -> Self {
        Self { pool, properties }
    }
}

impl<Properties> ColumnDefinitionStore for PgDefinitionStore<Properties>
where
    Properties: PropertiesRepo<Err = anyhow::Error>
        + DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>,
{
    type Error = PgDefinitionStoreError;

    #[tracing::instrument(skip(self, viewer), err)]
    async fn bindable_definition(
        &self,
        database_id: DatabaseId,
        viewer: &Viewer,
        id: PropertyDefinitionId,
    ) -> Result<Option<PropertyDefinitionId>, Self::Error> {
        Ok(self
            .properties
            .get_bindable_property_definition(id, viewer.user_id.as_ref(), database_id.into_uuid())
            .await
            .map_err(PgDefinitionStoreError::Properties)?
            .map(|definition| definition.id))
    }

    #[tracing::instrument(skip(self, options), err)]
    async fn create_typed_definition(
        &self,
        database_id: DatabaseId,
        name: &str,
        data_type: DataType,
        is_multi_select: bool,
        specific_entity_type: Option<EntityType>,
        options: &[PropertyOptionValue],
    ) -> Result<PropertyDefinitionWithOptions, Self::Error> {
        let options: Vec<(uuid::Uuid, PropertyOptionValue)> = options
            .iter()
            .map(|value| (OptionId::new().into_uuid(), value.clone()))
            .collect();
        let mut transaction = self.pool.begin().await?;
        let definition = self
            .properties
            .create_database_definition_in(
                &mut transaction,
                NewDatabaseDefinition {
                    id: macro_uuid::generate_uuid_v7(),
                    database_id: database_id.into_uuid(),
                    name,
                    data_type,
                    is_multi_select,
                    specific_entity_type,
                    options: &options,
                },
            )
            .await
            .map_err(|error| PgDefinitionStoreError::Write(Box::new(error)))?;
        transaction.commit().await?;
        Ok(definition)
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_unused_definition(&self, id: PropertyDefinitionId) -> Result<(), Self::Error> {
        self.properties
            .delete_property_definition(id)
            .await
            .map_err(PgDefinitionStoreError::Properties)
    }

    #[tracing::instrument(skip(self, viewer), err)]
    async fn editable_definitions(
        &self,
        viewer: &Viewer,
        ids: &[PropertyDefinitionId],
    ) -> Result<Vec<PropertyDefinitionId>, Self::Error> {
        self.properties
            .get_editable_property_definition_ids(ids, viewer.user_id.as_ref())
            .await
            .map_err(PgDefinitionStoreError::Properties)
    }

    #[tracing::instrument(skip(self), err)]
    async fn definitions(
        &self,
        ids: &[PropertyDefinitionId],
    ) -> Result<Vec<PropertyDefinitionWithOptions>, Self::Error> {
        self.properties
            .get_property_definitions_with_options(ids)
            .await
            .map_err(PgDefinitionStoreError::Properties)
    }
}
