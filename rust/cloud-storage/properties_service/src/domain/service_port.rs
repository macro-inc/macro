//! Service port - defines the interface for property business logic

use crate::domain::models::{
    EntityProperty, EntityType, PropertyDefinition, PropertyOption, PropertyValue,
};
use anyhow::Result;
use uuid::Uuid;

/// Port for checking permissions on property operations
pub trait PermissionChecker: Send + Sync + 'static {
    /// Check if a user can edit an entity (for setting entity properties)
    fn can_edit_entity(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<bool>> + Send;

    /// Check if a user can view an entity (for getting entity properties)
    fn can_view_entity(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<bool>> + Send;
}

/// The service level interface for property operations
/// Handles property definitions, options, and entity property assignments
#[cfg_attr(feature = "mock", mockall::automock)]
pub trait PropertyService: Send + Sync + 'static {
    // Property Definition Operations
    fn create_property(
        &self,
        user_id: &str,
        definition: PropertyDefinition,
    ) -> impl std::future::Future<Output = Result<PropertyDefinition>> + Send;

    fn create_property_with_options(
        &self,
        user_id: &str,
        definition: PropertyDefinition,
        options: Vec<PropertyOption>,
    ) -> impl std::future::Future<Output = Result<PropertyDefinition>> + Send;

    fn list_properties(
        &self,
        organization_id: Option<i32>,
        user_id: Option<&str>,
        limit: Option<i32>,
        offset: Option<i32>,
    ) -> impl std::future::Future<Output = Result<Vec<PropertyDefinition>>> + Send;

    fn delete_property(
        &self,
        user_id: &str,
        organization_id: Option<i32>,
        property_id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool>> + Send;

    // Property Option Operations
    fn create_option(
        &self,
        option: PropertyOption,
    ) -> impl std::future::Future<Output = Result<PropertyOption>> + Send;

    fn get_options(
        &self,
        property_definition_id: Uuid,
    ) -> impl std::future::Future<Output = Result<Vec<PropertyOption>>> + Send;

    fn delete_option(
        &self,
        option_id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool>> + Send;

    // Entity Property Operations
    fn get_entity_properties(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<Vec<EntityProperty>>> + Send;

    fn set_entity_property(
        &self,
        user_id: &str,
        entity_id: String,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> impl std::future::Future<Output = Result<EntityProperty>> + Send;

    fn delete_entity_property(
        &self,
        user_id: &str,
        entity_property_id: Uuid,
    ) -> impl std::future::Future<Output = Result<bool>> + Send;

    // Bulk/Internal Operations
    /// Delete all properties for an entity (internal use)
    fn delete_all_entity_properties(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// Get properties for multiple entities in bulk (internal use)
    fn get_bulk_entity_properties(
        &self,
        entity_refs: Vec<(String, EntityType)>,
    ) -> impl std::future::Future<Output = Result<Vec<(String, Vec<EntityProperty>)>>> + Send;
}
