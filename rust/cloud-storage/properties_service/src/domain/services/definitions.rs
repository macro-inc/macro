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
}
