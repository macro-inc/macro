//! Storage port - defines the interface for property persistence operations

use crate::domain::models::{EntityProperty, EntityType, PropertyDefinition, PropertyOption};
use uuid::Uuid;

/// Storage port for all property-related persistence operations
pub trait PropertiesStorage: Send + Sync + 'static {
    /// Error type for storage operations
    type Error: Send + Sync + std::error::Error;

    // Property Definition Operations
    fn create_property_definition(
        &self,
        definition: PropertyDefinition,
    ) -> impl std::future::Future<Output = Result<PropertyDefinition, Self::Error>> + Send;

    fn create_property_definition_with_options(
        &self,
        definition: PropertyDefinition,
        options: Vec<PropertyOption>,
    ) -> impl std::future::Future<Output = Result<PropertyDefinition, Self::Error>> + Send;

    fn get_property_definition(
        &self,
        id: Uuid,
    ) -> impl std::future::Future<Output = Result<Option<PropertyDefinition>, Self::Error>> + Send;

    fn get_property_definition_with_owner(
        &self,
        id: Uuid,
        user_id: &str,
        organization_id: Option<i32>,
    ) -> impl std::future::Future<Output = Result<Option<PropertyDefinition>, Self::Error>> + Send;

    fn list_property_definitions(
        &self,
        organization_id: Option<i32>,
        user_id: Option<&str>,
        limit: Option<i32>,
        offset: Option<i32>,
    ) -> impl std::future::Future<Output = Result<Vec<PropertyDefinition>, Self::Error>> + Send;

    fn delete_property_definition(
        &self,
        id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send;

    // Property Option Operations
    fn create_property_option(
        &self,
        option: PropertyOption,
    ) -> impl std::future::Future<Output = Result<PropertyOption, Self::Error>> + Send;

    fn get_property_options(
        &self,
        property_definition_id: Uuid,
    ) -> impl std::future::Future<Output = Result<Vec<PropertyOption>, Self::Error>> + Send;

    fn delete_property_option(
        &self,
        option_id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send;

    // Entity Property Operations
    fn get_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<Vec<EntityProperty>, Self::Error>> + Send;

    fn set_entity_property(
        &self,
        entity_property: EntityProperty,
    ) -> impl std::future::Future<Output = Result<EntityProperty, Self::Error>> + Send;

    fn delete_entity_property(
        &self,
        entity_property_id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send;

    fn delete_all_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send;

    fn get_bulk_entity_properties(
        &self,
        entity_refs: &[(String, EntityType)],
    ) -> impl std::future::Future<Output = Result<Vec<(String, Vec<EntityProperty>)>, Self::Error>> + Send;
}
