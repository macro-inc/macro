//! Entity property service operations

use super::PropertyServiceImpl;
use crate::domain::{
    error::{PropertyError, Result},
    models::{
        DeleteAllEntityPropertiesRequest, DeleteAllEntityPropertiesResponse,
        DeleteEntityPropertyRequest, DeleteEntityPropertyResponse, EntityProperty,
        EntityPropertyWithDefinition, GetBulkEntityPropertiesRequest,
        GetBulkEntityPropertiesResponse, GetEntityPropertiesRequest, GetEntityPropertiesResponse,
        PropertyValue, SetEntityPropertyRequest, SetEntityPropertyResponse,
    },
    ports::{PropertiesStorage, PropertyService},
};
use std::collections::HashMap;

impl<S, P> PropertyService for PropertyServiceImpl<S, P>
where
    S: PropertiesStorage,
    P: crate::domain::ports::PermissionChecker,
    anyhow::Error: From<S::Error>,
{
    async fn get_entity_properties(
        &self,
        request: GetEntityPropertiesRequest,
    ) -> Result<GetEntityPropertiesResponse> {
        // Get entity properties with values from storage
        let properties = self
            .storage
            .get_entity_properties_with_values(
                &request.entity_id,
                request.entity_type,
                request.organization_id,
                request.user_id,
                request.include_metadata,
            )
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        // Validate each property
        for prop in &properties {
            prop.validate()
                .map_err(|e| PropertyError::ValidationError(e))?;
        }

        // Group by entity ID (in this case, just the single entity)
        let mut result = HashMap::new();
        result.insert(request.entity_id.clone(), properties);

        Ok(GetEntityPropertiesResponse { properties: result })
    }

    async fn set_entity_property(
        &self,
        request: SetEntityPropertyRequest,
    ) -> Result<SetEntityPropertyResponse> {
        // Get the property definition
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

        // Validate value type compatibility if value is provided
        if let Some(ref value) = request.value {
            validate_value_compatibility(&property_def.data_type, value)?;
        }

        // Build the entity property
        let entity_property = EntityProperty::new(
            request.entity_id,
            request.entity_type,
            request.property_definition_id,
            request.value.clone(),
        );

        // Validate the entity property
        entity_property
            .validate()
            .map_err(|e| PropertyError::ValidationError(e))?;

        // If the property requires options, validate them
        if property_def.data_type.requires_options() {
            if let Some(ref value) = request.value {
                // Get options for validation
                let options = self
                    .storage
                    .get_property_options(request.property_definition_id)
                    .await
                    .map_err(|e| PropertyError::Internal(e.into()))?;

                validate_value_against_options(value, &options, property_def.is_multi_select)?;
            }
        }

        // Set via storage
        self.storage
            .set_entity_property(entity_property, request.value)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(SetEntityPropertyResponse {})
    }

    async fn delete_entity_property(
        &self,
        request: DeleteEntityPropertyRequest,
    ) -> Result<DeleteEntityPropertyResponse> {
        // Delete via storage
        self.storage
            .delete_entity_property(
                request.entity_id,
                request.entity_type,
                request.property_definition_id,
            )
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(DeleteEntityPropertyResponse {})
    }

    async fn delete_all_entity_properties(
        &self,
        request: DeleteAllEntityPropertiesRequest,
    ) -> Result<DeleteAllEntityPropertiesResponse> {
        // Delete all properties for the entity
        let deleted_count = self
            .storage
            .delete_all_entity_properties(request.entity_id, request.entity_type)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        Ok(DeleteAllEntityPropertiesResponse { deleted_count })
    }

    async fn get_bulk_entity_properties(
        &self,
        request: GetBulkEntityPropertiesRequest,
    ) -> Result<GetBulkEntityPropertiesResponse> {
        // Get properties for all entities
        let properties = self
            .storage
            .get_bulk_entity_properties(request.entity_refs)
            .await
            .map_err(|e| PropertyError::Internal(e.into()))?;

        // Validate each property
        for props in properties.values() {
            for prop in props {
                prop.validate()
                    .map_err(|e| PropertyError::ValidationError(e))?;
            }
        }

        Ok(GetBulkEntityPropertiesResponse { properties })
    }
}

// ===== Helper Functions =====

fn validate_value_compatibility(
    data_type: &models_properties::shared::DataType,
    value: &PropertyValue,
) -> Result<()> {
    use models_properties::shared::DataType;

    match (data_type, value) {
        (DataType::String, PropertyValue::String(_)) => Ok(()),
        (DataType::Number, PropertyValue::Number(_)) => Ok(()),
        (DataType::Boolean, PropertyValue::Boolean(_)) => Ok(()),
        (DataType::Date, PropertyValue::Date(_)) => Ok(()),
        (DataType::Link, PropertyValue::Link(_)) => Ok(()),
        (DataType::Entity, PropertyValue::Entity(_)) => Ok(()),
        (DataType::SelectString, PropertyValue::SelectString(_)) => Ok(()),
        (DataType::SelectNumber, PropertyValue::SelectNumber(_)) => Ok(()),
        _ => Err(PropertyError::ValidationError(format!(
            "Value type {:?} doesn't match property data type {:?}",
            value, data_type
        ))),
    }
}

fn validate_value_against_options(
    value: &PropertyValue,
    options: &[models_properties::service::PropertyOption],
    is_multi_select: bool,
) -> Result<()> {
    use models_properties::service::PropertyOptionValue;

    let valid_option_values: Vec<&PropertyOptionValue> = options.iter().map(|o| &o.value).collect();

    match value {
        PropertyValue::SelectString(values) => {
            if !is_multi_select && values.len() > 1 {
                return Err(PropertyError::ValidationError(
                    "Single-select property cannot have multiple values".to_string(),
                ));
            }
            for val in values {
                if !valid_option_values.contains(&&PropertyOptionValue::String(val.clone())) {
                    return Err(PropertyError::ValidationError(format!(
                        "Value '{}' is not a valid option",
                        val
                    )));
                }
            }
            Ok(())
        }
        PropertyValue::SelectNumber(values) => {
            if !is_multi_select && values.len() > 1 {
                return Err(PropertyError::ValidationError(
                    "Single-select property cannot have multiple values".to_string(),
                ));
            }
            for val in values {
                if !valid_option_values.contains(&&PropertyOptionValue::Number(*val)) {
                    return Err(PropertyError::ValidationError(format!(
                        "Value '{}' is not a valid option",
                        val
                    )));
                }
            }
            Ok(())
        }
        _ => Err(PropertyError::ValidationError(
            "Expected select value type".to_string(),
        )),
    }
}
