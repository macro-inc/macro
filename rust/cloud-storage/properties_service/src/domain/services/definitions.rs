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
    service: &PropertyServiceImpl<S, P>,
    request: crate::domain::models::ListPropertiesRequest,
) -> Result<crate::domain::models::ListPropertiesResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Extract organization_id and user_id from owner
    let (organization_id, user_id) = match &request.owner {
        crate::domain::models::PropertyOwner::Organization { organization_id } => {
            (Some(*organization_id), None)
        }
        crate::domain::models::PropertyOwner::User { user_id } => (None, Some(user_id.as_str())),
        crate::domain::models::PropertyOwner::UserAndOrganization {
            user_id,
            organization_id,
        } => (Some(*organization_id), Some(user_id.as_str())),
    };

    // List property definitions from storage
    let definitions = service
        .storage
        .list_property_definitions(organization_id, user_id, None, None)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    if request.include_options {
        // Fetch options for each property definition
        let mut properties_with_options = Vec::new();
        for definition in definitions {
            let options = service
                .storage
                .get_property_options(definition.id)
                .await
                .map_err(|e| PropertyError::Internal(e.into()))?;

            properties_with_options.push(crate::domain::models::PropertyDefinitionWithOptions {
                definition,
                property_options: options,
            });
        }

        Ok(crate::domain::models::ListPropertiesResponse {
            properties: properties_with_options,
        })
    } else {
        // Return definitions without options
        let properties_with_options = definitions
            .into_iter()
            .map(
                |definition| crate::domain::models::PropertyDefinitionWithOptions {
                    definition,
                    property_options: Vec::new(),
                },
            )
            .collect();

        Ok(crate::domain::models::ListPropertiesResponse {
            properties: properties_with_options,
        })
    }
}

pub(super) async fn delete_property<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: crate::domain::models::DeletePropertyRequest,
) -> Result<crate::domain::models::DeletePropertyResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Extract organization_id and user_id from owner
    let (organization_id, user_id) = match &request.owner {
        crate::domain::models::PropertyOwner::Organization { organization_id } => {
            (Some(*organization_id), None)
        }
        crate::domain::models::PropertyOwner::User { user_id } => (None, Some(user_id.as_str())),
        crate::domain::models::PropertyOwner::UserAndOrganization {
            user_id,
            organization_id,
        } => (Some(*organization_id), Some(user_id.as_str())),
    };

    // Verify the property exists and belongs to the owner
    let definition = service
        .storage
        .get_property_definition_with_owner(
            request.property_id,
            user_id.unwrap_or(""),
            organization_id,
        )
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    if definition.is_none() {
        return Err(PropertyError::NotFound(format!(
            "Property definition {} not found or access denied",
            request.property_id
        )));
    }

    // Delete the property definition (options are deleted via cascade)
    let deleted = service
        .storage
        .delete_property_definition(request.property_id)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    if !deleted {
        return Err(PropertyError::NotFound(format!(
            "Property definition {} not found",
            request.property_id
        )));
    }

    Ok(crate::domain::models::DeletePropertyResponse {})
}
