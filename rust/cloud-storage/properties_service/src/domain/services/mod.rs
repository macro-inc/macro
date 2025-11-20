//! Domain services - concrete implementations of service ports

mod definitions;
mod entity_properties;
mod options;

use crate::domain::ports::{PermissionChecker, PropertiesStorage, PropertyService};
use crate::domain::{
    error::Result,
    models::{
        CreateOptionRequest, CreateOptionResponse, CreatePropertyRequest, CreatePropertyResponse,
        DeleteAllEntityPropertiesRequest, DeleteAllEntityPropertiesResponse,
        DeleteEntityPropertyRequest, DeleteEntityPropertyResponse, DeleteOptionRequest,
        DeleteOptionResponse, DeletePropertyRequest, DeletePropertyResponse,
        GetBulkEntityPropertiesRequest, GetBulkEntityPropertiesResponse,
        GetEntityPropertiesRequest, GetEntityPropertiesResponse, GetOptionsRequest,
        GetOptionsResponse, ListPropertiesRequest, ListPropertiesResponse,
        SetEntityPropertyRequest, SetEntityPropertyResponse,
    },
};

/// Concrete implementation of PropertyService
pub struct PropertyServiceImpl<S, P> {
    storage: S,
    #[allow(dead_code)] // Will be used for permission checks in future implementations
    permission_checker: P,
}

impl<S, P> PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: PermissionChecker,
{
    /// Create a new property service implementation
    pub fn new(storage: S, permission_checker: P) -> Self {
        Self {
            storage,
            permission_checker,
        }
    }
}

// Single impl block for PropertyService - delegates to module functions
impl<S, P> PropertyService for PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Property Definition Operations
    async fn create_property(
        &self,
        request: CreatePropertyRequest,
    ) -> Result<CreatePropertyResponse> {
        definitions::create_property(self, request).await
    }

    async fn create_property_with_options(
        &self,
        request: crate::domain::models::CreatePropertyWithOptionsRequest,
    ) -> Result<crate::domain::models::CreatePropertyWithOptionsResponse> {
        definitions::create_property_with_options(self, request).await
    }

    async fn list_properties(
        &self,
        request: ListPropertiesRequest,
    ) -> Result<ListPropertiesResponse> {
        definitions::list_properties(self, request).await
    }

    async fn delete_property(
        &self,
        request: DeletePropertyRequest,
    ) -> Result<DeletePropertyResponse> {
        definitions::delete_property(self, request).await
    }

    // Property Option Operations
    async fn create_option(&self, request: CreateOptionRequest) -> Result<CreateOptionResponse> {
        options::create_option(self, request).await
    }

    async fn get_options(&self, request: GetOptionsRequest) -> Result<GetOptionsResponse> {
        options::get_options(self, request).await
    }

    async fn delete_option(&self, request: DeleteOptionRequest) -> Result<DeleteOptionResponse> {
        options::delete_option(self, request).await
    }

    // Entity Property Operations
    async fn get_entity_properties(
        &self,
        request: GetEntityPropertiesRequest,
    ) -> Result<GetEntityPropertiesResponse> {
        entity_properties::get_entity_properties(self, request).await
    }

    async fn set_entity_property(
        &self,
        request: SetEntityPropertyRequest,
    ) -> Result<SetEntityPropertyResponse> {
        entity_properties::set_entity_property(self, request).await
    }

    async fn delete_entity_property(
        &self,
        request: DeleteEntityPropertyRequest,
    ) -> Result<DeleteEntityPropertyResponse> {
        entity_properties::delete_entity_property(self, request).await
    }

    async fn delete_all_entity_properties(
        &self,
        request: DeleteAllEntityPropertiesRequest,
    ) -> Result<DeleteAllEntityPropertiesResponse> {
        entity_properties::delete_all_entity_properties(self, request).await
    }

    async fn get_bulk_entity_properties(
        &self,
        request: GetBulkEntityPropertiesRequest,
    ) -> Result<GetBulkEntityPropertiesResponse> {
        entity_properties::get_bulk_entity_properties(self, request).await
    }
}
