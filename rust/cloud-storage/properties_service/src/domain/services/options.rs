//! Property option service operations

use super::PropertyServiceImpl;
use crate::domain::{
    error::{PropertyError, Result},
    models::{
        CreateOptionRequest, CreateOptionResponse, DeleteOptionRequest, DeleteOptionResponse,
        GetOptionsRequest, GetOptionsResponse, PropertyOption, PropertyOptionValue,
    },
    ports::{PropertiesStorage, PropertyService},
};

impl<S, P> PropertyService for PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: crate::domain::ports::PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    async fn create_option(&self, request: CreateOptionRequest) -> Result<CreateOptionResponse> {
        // Verify the property definition exists
        let property_def = self
            .storage
            .get_property_definition(request.property_definition_id)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?
            .ok_or_else(|| {
                PropertyError::NotFound(format!(
                    "Property definition {} not found",
                    request.property_definition_id
                ))
            })?;

        // Validate that the option value type matches the property data type
        match (&property_def.data_type, &request.value) {
            (models_properties::shared::DataType::SelectString, PropertyOptionValue::String(_)) => {
            }
            (models_properties::shared::DataType::SelectNumber, PropertyOptionValue::Number(_)) => {
            }
            _ => {
                return Err(PropertyError::ValidationError(format!(
                    "Option value type {:?} doesn't match property data type {:?}",
                    request.value, property_def.data_type
                )));
            }
        }

        // Build the property option
        let option = PropertyOption::new(
            request.property_definition_id,
            request.value,
            request.display_order,
        );

        // Validate the option
        option
            .validate()
            .map_err(|e| PropertyError::ValidationError(e))?;

        // Create via storage
        self.storage
            .create_property_option(option)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(CreateOptionResponse {})
    }

    async fn get_options(&self, request: GetOptionsRequest) -> Result<GetOptionsResponse> {
        // Verify the property definition exists
        let _property_def = self
            .storage
            .get_property_definition(request.property_definition_id)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?
            .ok_or_else(|| {
                PropertyError::NotFound(format!(
                    "Property definition {} not found",
                    request.property_definition_id
                ))
            })?;

        // Get options from storage
        let options = self
            .storage
            .get_property_options(request.property_definition_id)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(GetOptionsResponse { options })
    }

    async fn delete_option(&self, request: DeleteOptionRequest) -> Result<DeleteOptionResponse> {
        // Delete via storage
        self.storage
            .delete_property_option(request.option_id, request.property_definition_id)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(DeleteOptionResponse {})
    }
}
