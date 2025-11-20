//! PostgreSQL implementation of storage ports
//! Maps directly from SQL rows to domain models, following frecency's pattern

mod definitions;
mod entity_properties;
mod options;

use crate::domain::ports::PropertiesStorage;
use sqlx::PgPool;
use thiserror::Error;

/// PostgreSQL storage implementation for properties
#[derive(Debug, Clone)]
pub struct PropertiesPgStorage {
    pool: PgPool,
}

/// Error type for properties storage operations
#[derive(Debug, Error)]
pub enum PropertiesStorageError {
    /// Database error
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// Data parsing error (e.g., invalid enum value from database)
    #[error("Data parsing error: {0}")]
    Parse(String),
}

impl PropertiesPgStorage {
    /// Create a new PostgreSQL properties storage
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

// Import implementations from submodules
impl PropertiesStorage for PropertiesPgStorage {
    type Error = PropertiesStorageError;

    // Property definition operations
    async fn create_property_definition(
        &self,
        definition: crate::domain::models::PropertyDefinition,
    ) -> Result<crate::domain::models::PropertyDefinition, Self::Error> {
        definitions::create_property_definition(&self.pool, definition).await
    }

    async fn create_property_definition_with_options(
        &self,
        definition: crate::domain::models::PropertyDefinition,
        options: Vec<crate::domain::models::PropertyOption>,
    ) -> Result<crate::domain::models::PropertyDefinition, Self::Error> {
        let result =
            definitions::create_property_definition_with_options(&self.pool, definition, options)
                .await?;
        Ok(result.definition)
    }

    // Stub implementations - will be implemented in subsequent commits

    async fn get_property_definition(
        &self,
        _id: uuid::Uuid,
    ) -> Result<Option<crate::domain::models::PropertyDefinition>, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn get_property_definition_with_owner(
        &self,
        _id: uuid::Uuid,
        _user_id: &str,
        _organization_id: Option<i32>,
    ) -> Result<Option<crate::domain::models::PropertyDefinition>, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn list_property_definitions(
        &self,
        _organization_id: Option<i32>,
        _user_id: Option<&str>,
        _limit: Option<i32>,
        _offset: Option<i32>,
    ) -> Result<Vec<crate::domain::models::PropertyDefinition>, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn delete_property_definition(&self, _id: uuid::Uuid) -> Result<bool, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn create_property_option(
        &self,
        option: crate::domain::models::PropertyOption,
    ) -> Result<crate::domain::models::PropertyOption, Self::Error> {
        options::create_property_option(&self.pool, option).await
    }

    async fn get_property_options(
        &self,
        property_definition_id: uuid::Uuid,
    ) -> Result<Vec<crate::domain::models::PropertyOption>, Self::Error> {
        options::get_property_options(&self.pool, property_definition_id).await
    }

    async fn delete_property_option(&self, option_id: uuid::Uuid) -> Result<bool, Self::Error> {
        // Fetch property_definition_id first for validation
        let opt_row = sqlx::query!(
            "SELECT property_definition_id FROM property_options WHERE id = $1",
            option_id
        )
        .fetch_optional(&self.pool)
        .await?;

        if opt_row.is_none() {
            return Ok(false);
        }

        let property_definition_id = opt_row.unwrap().property_definition_id;
        options::delete_property_option(&self.pool, option_id, property_definition_id).await?;
        Ok(true)
    }

    async fn get_entity_properties(
        &self,
        _entity_id: &str,
        _entity_type: crate::domain::models::EntityType,
    ) -> Result<Vec<crate::domain::models::EntityProperty>, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn get_entity_properties_with_values(
        &self,
        entity_id: &str,
        entity_type: crate::domain::models::EntityType,
        organization_id: Option<i32>,
        user_id: &str,
        include_metadata: bool,
    ) -> Result<Vec<crate::domain::models::EntityPropertyWithDefinition>, Self::Error> {
        entity_properties::get_entity_properties_with_values(
            &self.pool,
            entity_id,
            entity_type,
            organization_id,
            user_id.to_string(),
            include_metadata,
        )
        .await
    }

    async fn set_entity_property(
        &self,
        entity_property: crate::domain::models::EntityProperty,
        value: Option<crate::domain::models::PropertyValue>,
    ) -> Result<crate::domain::models::EntityProperty, Self::Error> {
        let (result, _) =
            entity_properties::set_entity_property(&self.pool, entity_property, value).await?;
        Ok(result)
    }

    async fn delete_entity_property(
        &self,
        _entity_property_id: uuid::Uuid,
    ) -> Result<bool, Self::Error> {
        todo!(
            "Will be implemented in subsequent commit - need entity_id, entity_type, property_definition_id"
        )
    }

    async fn delete_all_entity_properties(
        &self,
        entity_id: &str,
        entity_type: crate::domain::models::EntityType,
    ) -> Result<(), Self::Error> {
        entity_properties::delete_all_entity_properties(
            &self.pool,
            entity_id.to_string(),
            entity_type,
        )
        .await?;
        Ok(())
    }

    async fn get_bulk_entity_properties(
        &self,
        entity_refs: &[(String, crate::domain::models::EntityType)],
    ) -> Result<
        std::collections::HashMap<String, Vec<crate::domain::models::EntityPropertyWithDefinition>>,
        Self::Error,
    > {
        entity_properties::get_bulk_entity_properties(
            &self.pool,
            entity_refs
                .iter()
                .map(|(id, et)| (id.clone(), *et))
                .collect(),
        )
        .await
    }
}
