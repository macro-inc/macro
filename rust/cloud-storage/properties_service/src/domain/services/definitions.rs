//! Property definition service operations

use super::PropertyServiceImpl;
use crate::domain::{
    error::{PropertyError, Result},
    models::{CreatePropertyRequest, CreatePropertyResponse, PropertyDefinition},
    ports::{PropertiesStorage, PropertyService},
};

impl<S, P> PropertyService for PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: crate::domain::ports::PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    async fn create_property(
        &self,
        request: CreatePropertyRequest,
    ) -> Result<CreatePropertyResponse> {
        // Build the property definition
        let definition = PropertyDefinition::new(
            request.owner,
            request.display_name,
            request.data_type,
            request.is_multi_select,
            request.specific_entity_type,
        );

        // Validate the definition
        definition
            .validate()
            .map_err(|e| PropertyError::ValidationError(e))?;

        // Create via storage
        self.storage
            .create_property_definition(definition)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(CreatePropertyResponse {})
    }

    async fn create_property_with_options(
        &self,
        request: crate::domain::models::CreatePropertyWithOptionsRequest,
    ) -> Result<crate::domain::models::CreatePropertyWithOptionsResponse> {
        // Build the property definition
        let definition = PropertyDefinition::new(
            request.owner,
            request.display_name,
            request.data_type,
            request.is_multi_select,
            request.specific_entity_type,
        );

        // Validate the definition
        definition
            .validate()
            .map_err(|e| PropertyError::ValidationError(e))?;

        // Build the property options
        let options: Vec<crate::domain::models::PropertyOption> = request
            .options
            .into_iter()
            .map(|(value, display_order)| {
                crate::domain::models::PropertyOption::new(definition.id, value, display_order)
            })
            .collect();

        // Validate each option
        for option in &options {
            option
                .validate()
                .map_err(|e| PropertyError::ValidationError(e))?;
        }

        // Create via storage (in transaction)
        self.storage
            .create_property_definition_with_options(definition, options)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(crate::domain::models::CreatePropertyWithOptionsResponse {})
    }

    // TODO: Remaining methods will be added in subsequent commits
    async fn list_properties(
        &self,
        _request: crate::domain::models::ListPropertiesRequest,
    ) -> Result<crate::domain::models::ListPropertiesResponse> {
        unimplemented!("list_properties")
    }
    async fn delete_property(
        &self,
        _request: crate::domain::models::DeletePropertyRequest,
    ) -> Result<crate::domain::models::DeletePropertyResponse> {
        unimplemented!("delete_property")
    }
    async fn create_option(
        &self,
        _request: crate::domain::models::CreateOptionRequest,
    ) -> Result<crate::domain::models::CreateOptionResponse> {
        unimplemented!("create_option")
    }
    async fn get_options(
        &self,
        _request: crate::domain::models::GetOptionsRequest,
    ) -> Result<crate::domain::models::GetOptionsResponse> {
        unimplemented!("get_options")
    }
    async fn delete_option(
        &self,
        _request: crate::domain::models::DeleteOptionRequest,
    ) -> Result<crate::domain::models::DeleteOptionResponse> {
        unimplemented!("delete_option")
    }
    async fn get_entity_properties(
        &self,
        _request: crate::domain::models::GetEntityPropertiesRequest,
    ) -> Result<crate::domain::models::GetEntityPropertiesResponse> {
        unimplemented!("get_entity_properties")
    }
    async fn set_entity_property(
        &self,
        _request: crate::domain::models::SetEntityPropertyRequest,
    ) -> Result<crate::domain::models::SetEntityPropertyResponse> {
        unimplemented!("set_entity_property")
    }
    async fn delete_entity_property(
        &self,
        _request: crate::domain::models::DeleteEntityPropertyRequest,
    ) -> Result<crate::domain::models::DeleteEntityPropertyResponse> {
        unimplemented!("delete_entity_property")
    }
    async fn delete_all_entity_properties(
        &self,
        _request: crate::domain::models::DeleteAllEntityPropertiesRequest,
    ) -> Result<crate::domain::models::DeleteAllEntityPropertiesResponse> {
        unimplemented!("delete_all_entity_properties")
    }
    async fn get_bulk_entity_properties(
        &self,
        _request: crate::domain::models::GetBulkEntityPropertiesRequest,
    ) -> Result<crate::domain::models::GetBulkEntityPropertiesResponse> {
        unimplemented!("get_bulk_entity_properties")
    }
}
