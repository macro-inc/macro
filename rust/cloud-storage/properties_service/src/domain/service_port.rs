//! Service port - defines the interface for property business logic

use crate::domain::{
    error::Result,
    models::{
        CreateOptionRequest, CreateOptionResponse, CreatePropertyRequest,
        CreatePropertyWithOptionsRequest, DeleteAllEntityPropertiesRequest,
        DeleteAllEntityPropertiesResponse, DeleteEntityPropertyRequest,
        DeleteEntityPropertyResponse, DeleteOptionRequest, DeleteOptionResponse,
        DeletePropertyRequest, DeletePropertyResponse, EntityType, GetBulkEntityPropertiesRequest,
        GetBulkEntityPropertiesResponse, GetEntityPropertiesRequest, GetEntityPropertiesResponse,
        GetOptionsRequest, GetOptionsResponse, ListPropertiesRequest, ListPropertiesResponse,
        SetEntityPropertyRequest, SetEntityPropertyResponse,
    },
};

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

    /// Create a new property definition
    fn create_property(
        &self,
        request: CreatePropertyRequest,
    ) -> impl std::future::Future<Output = Result<crate::domain::models::PropertyDefinition>> + Send;

    /// Create a property definition with options in a single transaction
    fn create_property_with_options(
        &self,
        request: CreatePropertyWithOptionsRequest,
    ) -> impl std::future::Future<Output = Result<crate::domain::models::PropertyDefinition>> + Send;

    /// List property definitions with optional filtering
    fn list_properties(
        &self,
        request: ListPropertiesRequest,
    ) -> impl std::future::Future<Output = Result<ListPropertiesResponse>> + Send;

    /// Delete a property definition
    fn delete_property(
        &self,
        request: DeletePropertyRequest,
    ) -> impl std::future::Future<Output = Result<DeletePropertyResponse>> + Send;

    // Property Option Operations

    /// Create a new property option
    fn create_option(
        &self,
        request: CreateOptionRequest,
    ) -> impl std::future::Future<Output = Result<CreateOptionResponse>> + Send;

    /// Get all options for a property definition
    fn get_options(
        &self,
        request: GetOptionsRequest,
    ) -> impl std::future::Future<Output = Result<GetOptionsResponse>> + Send;

    /// Delete a property option
    fn delete_option(
        &self,
        request: DeleteOptionRequest,
    ) -> impl std::future::Future<Output = Result<DeleteOptionResponse>> + Send;

    // Entity Property Operations

    /// Get all properties for an entity (with definitions and values)
    fn get_entity_properties(
        &self,
        request: GetEntityPropertiesRequest,
    ) -> impl std::future::Future<Output = Result<GetEntityPropertiesResponse>> + Send;

    /// Set or update a property value for an entity
    fn set_entity_property(
        &self,
        request: SetEntityPropertyRequest,
    ) -> impl std::future::Future<Output = Result<SetEntityPropertyResponse>> + Send;

    /// Delete an entity property assignment
    fn delete_entity_property(
        &self,
        request: DeleteEntityPropertyRequest,
    ) -> impl std::future::Future<Output = Result<DeleteEntityPropertyResponse>> + Send;

    // Bulk/Internal Operations

    /// Delete all properties for an entity
    fn delete_all_entity_properties(
        &self,
        request: DeleteAllEntityPropertiesRequest,
    ) -> impl std::future::Future<Output = Result<DeleteAllEntityPropertiesResponse>> + Send;

    /// Get properties for multiple entities in bulk
    fn get_bulk_entity_properties(
        &self,
        request: GetBulkEntityPropertiesRequest,
    ) -> impl std::future::Future<Output = Result<GetBulkEntityPropertiesResponse>> + Send;
}
