//! Entity property service operations

use super::PropertyServiceImpl;
use crate::domain::{
    error::{PropertyError, Result},
    models::{
        DeleteAllEntityPropertiesRequest, DeleteAllEntityPropertiesResponse,
        DeleteEntityPropertyRequest, DeleteEntityPropertyResponse, EntityProperty,
        GetBulkEntityPropertiesRequest, GetBulkEntityPropertiesResponse,
        GetEntityPropertiesRequest, GetEntityPropertiesResponse, PropertyValue,
        SetEntityPropertyRequest, SetEntityPropertyResponse,
        extensions::{requires_options, validate_entity_property_with_definition},
    },
    ports::{PermissionChecker, PropertiesStorage},
};
use chrono::Utc;
use std::collections::HashMap;

pub(super) async fn get_entity_properties<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: GetEntityPropertiesRequest,
) -> Result<GetEntityPropertiesResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Get entity properties with values from storage
    // Note: organization_id not available in request, passing None
    let properties = service
        .storage
        .get_entity_properties_with_values(
            &request.entity_id,
            request.entity_type,
            None, // organization_id not in request
            &request.user_id,
            request.include_metadata,
        )
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    // Validate each property
    for prop in &properties {
        validate_entity_property_with_definition(prop)
            .map_err(|e| PropertyError::ValidationError(e))?;
    }

    Ok(GetEntityPropertiesResponse {
        entity_id: request.entity_id,
        properties,
    })
}

pub(super) async fn set_entity_property<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: SetEntityPropertyRequest,
) -> Result<SetEntityPropertyResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Get the property definition
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

    // Validate value type compatibility if value is provided
    if let Some(ref value) = request.value {
        validate_value_compatibility(&property_def.data_type, value)?;
    }

    // Build the entity property
    let now = Utc::now();
    let entity_property = EntityProperty {
        id: macro_uuid::generate_uuid_v7(),
        entity_id: request.entity_id.clone(),
        entity_type: request.entity_type,
        property_definition_id: request.property_definition_id,
        created_at: now,
        updated_at: now,
    };

    // Validate the entity property
    crate::domain::models::extensions::validate_entity_property(&entity_property)
        .map_err(|e| PropertyError::ValidationError(e))?;

    // If the property requires options, validate them
    if requires_options(&property_def.data_type) {
        if let Some(ref value) = request.value {
            // Get options for validation
            let options = service
                .storage
                .get_property_options(request.property_definition_id)
                .await
                .map_err(|e| PropertyError::Internal(e.into()))?;

            validate_value_against_options(value, &options, property_def.is_multi_select)?;
        }
    }

    // Set via storage
    service
        .storage
        .set_entity_property(entity_property, request.value)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(SetEntityPropertyResponse {})
}

pub(super) async fn delete_entity_property<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: DeleteEntityPropertyRequest,
) -> Result<DeleteEntityPropertyResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Delete via storage (only takes entity_property_id)
    service
        .storage
        .delete_entity_property(request.entity_property_id)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(DeleteEntityPropertyResponse {})
}

pub(super) async fn delete_all_entity_properties<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: DeleteAllEntityPropertiesRequest,
) -> Result<DeleteAllEntityPropertiesResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Delete all properties for the entity
    service
        .storage
        .delete_all_entity_properties(&request.entity_id, request.entity_type)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    Ok(DeleteAllEntityPropertiesResponse {})
}

pub(super) async fn get_bulk_entity_properties<S, P>(
    service: &PropertyServiceImpl<S, P>,
    request: GetBulkEntityPropertiesRequest,
) -> Result<GetBulkEntityPropertiesResponse>
where
    S: PropertiesStorage,
    P: PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    // Get properties for all entities
    let properties_map = service
        .storage
        .get_bulk_entity_properties(&request.entity_refs)
        .await
        .map_err(|e| PropertyError::Internal(e.into()))?;

    // Validate each property and convert to response format
    let mut results = HashMap::new();
    for (entity_id, props) in properties_map {
        // Validate each property
        for prop in &props {
            validate_entity_property_with_definition(prop)
                .map_err(|e| PropertyError::ValidationError(e))?;
        }

        results.insert(
            entity_id.clone(),
            GetEntityPropertiesResponse {
                entity_id: entity_id.clone(),
                properties: props,
            },
        );
    }

    Ok(GetBulkEntityPropertiesResponse { results })
}

// ===== Helper Functions =====

fn validate_value_compatibility(
    data_type: &models_properties::shared::DataType,
    value: &PropertyValue,
) -> Result<()> {
    use models_properties::shared::DataType;

    match (data_type, value) {
        (DataType::String, PropertyValue::Str(_)) => Ok(()),
        (DataType::Number, PropertyValue::Num(_)) => Ok(()),
        (DataType::Boolean, PropertyValue::Bool(_)) => Ok(()),
        (DataType::Date, PropertyValue::Date(_)) => Ok(()),
        (DataType::Link, PropertyValue::Link(_)) => Ok(()),
        (DataType::Entity, PropertyValue::EntityRef(_)) => Ok(()),
        (DataType::SelectString, PropertyValue::SelectOption(_)) => Ok(()),
        (DataType::SelectNumber, PropertyValue::SelectOption(_)) => Ok(()),
        _ => Err(PropertyError::ValidationError(format!(
            "Value type {:?} doesn't match property data type {:?}",
            value, data_type
        ))),
    }
}

fn validate_value_against_options(
    value: &PropertyValue,
    _options: &[models_properties::service::property_option::PropertyOption],
    is_multi_select: bool,
) -> Result<()> {
    match value {
        PropertyValue::SelectOption(option_ids) => {
            if !is_multi_select && option_ids.len() > 1 {
                return Err(PropertyError::ValidationError(
                    "Single-select property cannot have multiple values".to_string(),
                ));
            }
            // Note: SelectOption stores UUIDs, not values directly
            // This validation would need to check if the option IDs exist
            // For now, just check count
            Ok(())
        }
        _ => Err(PropertyError::ValidationError(
            "Expected select value type".to_string(),
        )),
    }
}
