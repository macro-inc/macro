//! PostgreSQL implementation of storage ports
//! Maps directly from SQL rows to domain models, following frecency's pattern

mod definitions;
mod entity_properties;
mod options;

use crate::domain::ports::PropertiesStorage;
use models_properties::shared::{DataType, EntityType};
use sqlx::PgPool;
use std::str::FromStr;
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

// Helper implementations for parsing database strings to models_properties types
impl FromStr for DataType {
    type Err = PropertiesStorageError;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "Boolean" => Ok(DataType::Boolean),
            "Date" => Ok(DataType::Date),
            "Number" => Ok(DataType::Number),
            "String" => Ok(DataType::String),
            "SelectNumber" => Ok(DataType::SelectNumber),
            "SelectString" => Ok(DataType::SelectString),
            "Entity" => Ok(DataType::Entity),
            "Link" => Ok(DataType::Link),
            _ => Err(PropertiesStorageError::Parse(format!(
                "Unknown DataType: {}",
                s
            ))),
        }
    }
}

impl FromStr for EntityType {
    type Err = PropertiesStorageError;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "Channel" => Ok(EntityType::Channel),
            "Chat" => Ok(EntityType::Chat),
            "Document" => Ok(EntityType::Document),
            "Project" => Ok(EntityType::Project),
            "Thread" => Ok(EntityType::Thread),
            "User" => Ok(EntityType::User),
            _ => Err(PropertiesStorageError::Parse(format!(
                "Unknown EntityType: {}",
                s
            ))),
        }
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
    ) -> Result<crate::domain::models::PropertyDefinitionWithOptions, Self::Error> {
        definitions::create_property_definition_with_options(&self.pool, definition, options).await
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
        _option: crate::domain::models::PropertyOption,
    ) -> Result<crate::domain::models::PropertyOption, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn get_property_options(
        &self,
        _property_definition_id: uuid::Uuid,
    ) -> Result<Vec<crate::domain::models::PropertyOption>, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn delete_property_option(&self, _option_id: uuid::Uuid) -> Result<bool, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn get_entity_properties(
        &self,
        _entity_id: &str,
        _entity_type: crate::domain::models::EntityType,
    ) -> Result<
        Vec<(
            crate::domain::models::EntityProperty,
            Option<crate::domain::models::PropertyValue>,
        )>,
        Self::Error,
    > {
        todo!("Will be implemented in subsequent commit")
    }

    async fn set_entity_property(
        &self,
        _entity_property: crate::domain::models::EntityProperty,
        _value: Option<crate::domain::models::PropertyValue>,
    ) -> Result<crate::domain::models::EntityProperty, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn delete_entity_property(
        &self,
        _entity_property_id: uuid::Uuid,
    ) -> Result<bool, Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn delete_all_entity_properties(
        &self,
        _entity_id: &str,
        _entity_type: crate::domain::models::EntityType,
    ) -> Result<(), Self::Error> {
        todo!("Will be implemented in subsequent commit")
    }

    async fn get_bulk_entity_properties(
        &self,
        _entity_refs: &[(String, crate::domain::models::EntityType)],
    ) -> Result<
        Vec<(
            String,
            Vec<(
                crate::domain::models::EntityProperty,
                Option<crate::domain::models::PropertyValue>,
            )>,
        )>,
        Self::Error,
    > {
        todo!("Will be implemented in subsequent commit")
    }
}
