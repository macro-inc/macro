//! Property option service operations

use super::PropertyServiceImpl;
use crate::domain::{
    error::{PropertyError, Result},
    models::{
        CreateOptionRequest, CreateOptionResponse, DeleteOptionRequest, DeleteOptionResponse,
        GetOptionsRequest, GetOptionsResponse, PropertyOptionValue,
        extensions::{new_property_option, validate_property_option},
    },
    ports::{PermissionChecker, PropertiesStorage},
};

pub(super) async fn create_option<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: CreateOptionRequest,
) -> Result<CreateOptionResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Verify the property definition exists
    let property_def = service
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
        (models_properties::shared::DataType::SelectString, PropertyOptionValue::String(_)) => {}
        (models_properties::shared::DataType::SelectNumber, PropertyOptionValue::Number(_)) => {}
        _ => {
            return Err(PropertyError::ValidationError(format!(
                "Option value type {:?} doesn't match property data type {:?}",
                request.value, property_def.data_type
            )));
        }
    }

    // Build the property option
    let option = new_property_option(
        request.property_definition_id,
        request.value,
        request.display_order,
    );

    // Validate the option
    validate_property_option(&option).map_err(|e| PropertyError::ValidationError(e))?;

    // Create via storage
    service
        .storage
        .create_property_option(option)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(CreateOptionResponse {})
}

pub(super) async fn get_options<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: GetOptionsRequest,
) -> Result<GetOptionsResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Verify the property definition exists
    let _property_def = service
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
    let options = service
        .storage
        .get_property_options(request.property_definition_id)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(GetOptionsResponse { options })
}

pub(super) async fn delete_option<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: DeleteOptionRequest,
) -> Result<DeleteOptionResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Delete via storage (trait only takes option_id)
    service
        .storage
        .delete_property_option(request.option_id)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(DeleteOptionResponse {})
}
