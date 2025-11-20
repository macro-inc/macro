//! Domain extensions for models_properties types
//!
//! This module provides helper functions for business logic (validation, constructors, helper methods)
//! for models_properties types. Since we can't add methods to external types, we use free functions.

use chrono::Utc;
use models_properties::service::entity_property::EntityProperty;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOption;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, EntityType, PropertyOwner};
use uuid::Uuid;

// ===== PropertyDefinition Helpers =====

/// Create a new property definition with business logic
pub fn new_property_definition(
    owner: PropertyOwner,
    display_name: String,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<EntityType>,
) -> PropertyDefinition {
    let now = Utc::now();
    PropertyDefinition {
        id: macro_uuid::generate_uuid_v7(),
        owner,
        display_name: display_name.trim().to_string(),
        data_type,
        is_multi_select,
        specific_entity_type,
        created_at: now,
        updated_at: now,
        is_metadata: false,
    }
}

/// Validate the property definition
pub fn validate_property_definition(def: &PropertyDefinition) -> Result<(), String> {
    // Validate owner
    validate_property_owner(&def.owner)?;

    // Validate display name
    if def.display_name.is_empty() {
        return Err("Display name cannot be empty".to_string());
    }

    if def.display_name.len() > 100 {
        return Err("Display name cannot exceed 100 characters".to_string());
    }

    // Validate multi-select compatibility
    if def.is_multi_select && !supports_multi_select(&def.data_type) {
        return Err(format!(
            "Data type {:?} does not support multi-select",
            def.data_type
        ));
    }

    // Validate specific entity type is only used with Entity data type
    if def.specific_entity_type.is_some() && def.data_type != DataType::Entity {
        return Err("specific_entity_type can only be set for Entity data type".to_string());
    }

    Ok(())
}

// ===== PropertyOption Helpers =====

/// Create a new property option with business logic
pub fn new_property_option(
    property_definition_id: Uuid,
    value: PropertyOptionValue,
    display_order: i32,
) -> PropertyOption {
    let now = Utc::now();
    PropertyOption {
        id: macro_uuid::generate_uuid_v7(),
        property_definition_id,
        display_order,
        value,
        created_at: now,
        updated_at: now,
    }
}

/// Validate the property option
pub fn validate_property_option(option: &PropertyOption) -> Result<(), String> {
    validate_property_option_value(&option.value)?;

    if option.display_order < 0 {
        return Err("Display order cannot be negative".to_string());
    }

    Ok(())
}

// ===== PropertyOptionValue Helpers =====

/// Validate the option value
pub fn validate_property_option_value(value: &PropertyOptionValue) -> Result<(), String> {
    match value {
        PropertyOptionValue::String(s) if s.is_empty() => {
            Err("Option value cannot be empty".to_string())
        }
        PropertyOptionValue::Number(n) if !n.is_finite() => {
            Err("Option value must be a finite number".to_string())
        }
        _ => Ok(()),
    }
}

// ===== PropertyOwner Helpers =====

/// Validate the property owner
pub fn validate_property_owner(owner: &PropertyOwner) -> Result<(), String> {
    match owner {
        PropertyOwner::User { user_id } if user_id.is_empty() => {
            Err("User ID cannot be empty".to_string())
        }
        PropertyOwner::Organization { organization_id: _ } => Ok(()),
        PropertyOwner::UserAndOrganization {
            user_id,
            organization_id: _,
        } if user_id.is_empty() => Err("User ID cannot be empty".to_string()),
        _ => Ok(()),
    }
}

// ===== DataType Helpers =====

/// Check if data type supports multi-select
pub fn supports_multi_select(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::SelectString | DataType::SelectNumber | DataType::Entity | DataType::Link
    )
}

/// Check if data type requires options
pub fn requires_options(data_type: &DataType) -> bool {
    matches!(data_type, DataType::SelectString | DataType::SelectNumber)
}

// ===== EntityProperty Helpers =====

/// Validate the entity property
pub fn validate_entity_property(prop: &EntityProperty) -> Result<(), String> {
    if prop.entity_id.is_empty() {
        return Err("Entity ID cannot be empty".to_string());
    }
    Ok(())
}

// ===== PropertyValue Helpers =====

/// Validate the property value
pub fn validate_property_value(value: &PropertyValue) -> Result<(), String> {
    match value {
        PropertyValue::Num(n) if !n.is_finite() => {
            Err("Property value must be a finite number".to_string())
        }
        PropertyValue::Str(s) if s.is_empty() => {
            Err("Property value cannot be empty string".to_string())
        }
        _ => Ok(()),
    }
}

// ===== PropertyDefinitionWithOptions Helpers =====

/// Validate property definition with options
pub fn validate_property_definition_with_options(
    def_with_opts: &PropertyDefinitionWithOptions,
) -> Result<(), String> {
    validate_property_definition(&def_with_opts.definition)?;

    for option in &def_with_opts.property_options {
        validate_property_option(option)?;
    }

    Ok(())
}

// ===== EntityPropertyWithDefinition Helpers =====

/// Validate entity property with definition
pub fn validate_entity_property_with_definition(
    prop_with_def: &EntityPropertyWithDefinition,
) -> Result<(), String> {
    validate_entity_property(&prop_with_def.property)?;
    validate_property_definition(&prop_with_def.definition)?;

    if let Some(value) = &prop_with_def.value {
        validate_property_value(value)?;
    }

    if let Some(options) = &prop_with_def.options {
        for option in options {
            validate_property_option(option)?;
        }
    }

    Ok(())
}
