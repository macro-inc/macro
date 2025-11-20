//! Property definition service operations

use super::PropertyServiceImpl;
use crate::domain::{
    error::{PropertyError, Result},
    models::{
        CreatePropertyRequest, CreatePropertyResponse,
        extensions::{
            new_property_definition, new_property_option, validate_property_definition,
            validate_property_option,
        },
    },
    ports::{PermissionChecker, PropertiesStorage},
};

pub(super) async fn create_property<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: CreatePropertyRequest,
) -> Result<CreatePropertyResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Build the property definition
    let definition = new_property_definition(
        request.owner,
        request.display_name,
        request.data_type,
        request.is_multi_select,
        request.specific_entity_type,
    );

    // Validate the definition
    validate_property_definition(&definition).map_err(|e| PropertyError::ValidationError(e))?;

    // Create via storage
    service
        .storage
        .create_property_definition(definition)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(CreatePropertyResponse {})
}

pub(super) async fn create_property_with_options<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: crate::domain::models::CreatePropertyWithOptionsRequest,
) -> Result<crate::domain::models::CreatePropertyWithOptionsResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Build the property definition
    let definition = new_property_definition(
        request.owner,
        request.display_name,
        request.data_type,
        request.is_multi_select,
        request.specific_entity_type,
    );

    // Validate the definition
    validate_property_definition(&definition).map_err(|e| PropertyError::ValidationError(e))?;

    // Build the property options
    let options: Vec<crate::domain::models::PropertyOption> = request
        .options
        .into_iter()
        .map(|(value, display_order)| new_property_option(definition.id, value, display_order))
        .collect();

    // Validate each option
    for option in &options {
        validate_property_option(option).map_err(|e| PropertyError::ValidationError(e))?;
    }

    // Create via storage (in transaction)
    service
        .storage
        .create_property_definition_with_options(definition, options)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(crate::domain::models::CreatePropertyWithOptionsResponse {})
}

pub(super) async fn list_properties<S, P>(
    _service: &PropertyServiceImpl<S, P>,
    _request: crate::domain::models::ListPropertiesRequest,
) -> Result<crate::domain::models::ListPropertiesResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
{
    unimplemented!("list_properties")
}

pub(super) async fn delete_property<S, P>(
    _service: &PropertyServiceImpl<S, P>,
    _request: crate::domain::models::DeletePropertyRequest,
) -> Result<crate::domain::models::DeletePropertyResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
{
    unimplemented!("delete_property")
}
