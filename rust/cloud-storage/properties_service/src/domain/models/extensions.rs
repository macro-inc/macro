//! Domain extensions for models_properties types
//!
//! This module adds business logic (validation, constructors, helper methods)
//! to models_properties types via impl blocks. The struct definitions themselves
//! come from models_properties::service and models_properties::shared.

use chrono::Utc;
use models_properties::service::{
    EntityPropertyWithDefinition, PropertyDefinition, PropertyDefinitionWithOptions,
    PropertyOption, PropertyOptionValue,
};
use models_properties::shared::{DataType, EntityType, PropertyOwner};
use uuid::Uuid;

// ===== PropertyDefinition Behavior =====

impl PropertyDefinition {
    /// Create a new property definition with business logic
    pub fn new(
        owner: PropertyOwner,
        display_name: String,
        data_type: DataType,
        is_multi_select: bool,
        specific_entity_type: Option<EntityType>,
    ) -> Self {
        let now = Utc::now();
        Self {
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
    pub fn validate(&self) -> Result<(), String> {
        // Validate owner
        self.owner.validate().map_err(|e| e.to_string())?;

        // Validate display name
        if self.display_name.is_empty() {
            return Err("Display name cannot be empty".to_string());
        }

        if self.display_name.len() > 100 {
            return Err("Display name cannot exceed 100 characters".to_string());
        }

        // Validate multi-select compatibility
        if self.is_multi_select && !self.data_type.supports_multi_select() {
            return Err(format!(
                "Data type {:?} does not support multi-select",
                self.data_type
            ));
        }

        // Validate specific entity type is only used with Entity data type
        if self.specific_entity_type.is_some() && self.data_type != DataType::Entity {
            return Err("specific_entity_type can only be set for Entity data type".to_string());
        }

        Ok(())
    }
}

// ===== PropertyOption Behavior =====

impl PropertyOption {
    /// Create a new property option with business logic
    pub fn new(
        property_definition_id: Uuid,
        display_order: i32,
        value: PropertyOptionValue,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: macro_uuid::generate_uuid_v7(),
            property_definition_id,
            display_order,
            value,
            created_at: now,
            updated_at: now,
        }
    }

    /// Validate the property option
    pub fn validate(&self) -> Result<(), &'static str> {
        self.value.validate()?;

        if self.display_order < 0 {
            return Err("Display order cannot be negative");
        }

        Ok(())
    }
}

// ===== PropertyOptionValue Behavior =====

impl PropertyOptionValue {
    /// Validate the value
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            PropertyOptionValue::String(s) if s.is_empty() => Err("Option value cannot be empty"),
            PropertyOptionValue::Number(n) if !n.is_finite() => {
                Err("Option value must be a finite number")
            }
            _ => Ok(()),
        }
    }
}

// ===== PropertyOwner Behavior =====

impl PropertyOwner {
    /// Validate that the owner has at least one identifier
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            PropertyOwner::User { user_id } if user_id.is_empty() => Err("User ID cannot be empty"),
            PropertyOwner::Organization { organization_id } if *organization_id <= 0 => {
                Err("Organization ID must be positive")
            }
            PropertyOwner::UserAndOrganization {
                user_id,
                organization_id,
            } => {
                if user_id.is_empty() {
                    return Err("User ID cannot be empty");
                }
                if *organization_id <= 0 {
                    return Err("Organization ID must be positive");
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

// ===== DataType Behavior =====

impl DataType {
    /// Check if this data type supports multi-select
    pub fn supports_multi_select(&self) -> bool {
        matches!(
            self,
            DataType::SelectNumber | DataType::SelectString | DataType::Entity | DataType::Link
        )
    }

    /// Check if this data type requires options
    pub fn requires_options(&self) -> bool {
        matches!(self, DataType::SelectNumber | DataType::SelectString)
    }

    /// Check if this is a select type (requires options)
    pub fn is_select_type(&self) -> bool {
        matches!(self, DataType::SelectNumber | DataType::SelectString)
    }
}

// ===== EntityProperty Behavior =====

impl models_properties::service::EntityProperty {
    /// Validate the entity property
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.entity_id.is_empty() {
            return Err("Entity ID cannot be empty");
        }
        Ok(())
    }
}

// ===== PropertyValue Behavior =====

impl models_properties::service::PropertyValue {
    /// Validate the property value
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            models_properties::service::PropertyValue::Num(n) if !n.is_finite() => {
                Err("Property value must be a finite number")
            }
            models_properties::service::PropertyValue::Str(s) if s.is_empty() => {
                Err("Property value cannot be empty string")
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_owner() -> PropertyOwner {
        PropertyOwner::Organization { organization_id: 1 }
    }

    #[test]
    fn test_property_definition_validation() {
        let valid_def = PropertyDefinition::new(
            create_test_owner(),
            "Test Property".to_string(),
            DataType::String,
            false,
            None,
        );
        assert!(valid_def.validate().is_ok());
    }

    #[test]
    fn test_empty_display_name() {
        let mut def = PropertyDefinition::new(
            create_test_owner(),
            "   ".to_string(),
            DataType::String,
            false,
            None,
        );
        assert!(def.validate().is_err());

        def.display_name = String::new();
        assert!(def.validate().is_err());
    }

    #[test]
    fn test_display_name_too_long() {
        let def = PropertyDefinition::new(
            create_test_owner(),
            "a".repeat(128),
            DataType::String,
            false,
            None,
        );
        assert!(def.validate().is_err());
    }

    #[test]
    fn test_multi_select_validation() {
        // Valid multi-select with SelectString
        let def = PropertyDefinition::new(
            create_test_owner(),
            "Test".to_string(),
            DataType::SelectString,
            true,
            None,
        );
        assert!(def.validate().is_ok());

        // Invalid multi-select with String
        let def = PropertyDefinition::new(
            create_test_owner(),
            "Test".to_string(),
            DataType::String,
            true,
            None,
        );
        assert!(def.validate().is_err());
    }

    #[test]
    fn test_entity_type_validation() {
        // Valid Entity type with specific_entity_type
        let def = PropertyDefinition::new(
            create_test_owner(),
            "Test".to_string(),
            DataType::Entity,
            false,
            Some(EntityType::Document),
        );
        assert!(def.validate().is_ok());

        // Valid Entity type without specific_entity_type (optional)
        let def = PropertyDefinition::new(
            create_test_owner(),
            "Test".to_string(),
            DataType::Entity,
            false,
            None,
        );
        assert!(def.validate().is_ok());

        // Invalid specific_entity_type with non-Entity type
        let def = PropertyDefinition::new(
            create_test_owner(),
            "Test".to_string(),
            DataType::String,
            false,
            Some(EntityType::Document),
        );
        assert!(def.validate().is_err());
    }

    #[test]
    fn test_property_option_value_validation() {
        let valid_string = PropertyOptionValue::String("test".to_string());
        assert!(valid_string.validate().is_ok());

        let empty_string = PropertyOptionValue::String(String::new());
        assert!(empty_string.validate().is_err());

        let valid_number = PropertyOptionValue::Number(42.0);
        assert!(valid_number.validate().is_ok());

        let invalid_number = PropertyOptionValue::Number(f64::NAN);
        assert!(invalid_number.validate().is_err());
    }

    #[test]
    fn test_property_option_validation() {
        let valid_option = PropertyOption::new(
            Uuid::new_v4(),
            0,
            PropertyOptionValue::String("test".to_string()),
        );
        assert!(valid_option.validate().is_ok());

        let mut invalid_option = valid_option.clone();
        invalid_option.display_order = -1;
        assert!(invalid_option.validate().is_err());

        let mut invalid_option = valid_option.clone();
        invalid_option.value = PropertyOptionValue::String(String::new());
        assert!(invalid_option.validate().is_err());
    }
}

// ===== PropertyDefinitionWithOptions Behavior =====

impl PropertyDefinitionWithOptions {
    /// Validate the property definition and options
    pub fn validate(&self) -> Result<(), String> {
        // Validate the definition
        self.definition.validate()?;

        // Validate each option
        for option in &self.property_options {
            option.validate().map_err(|e| e.to_string())?;

            // Ensure option belongs to this property
            if option.property_definition_id != self.definition.id {
                return Err(format!(
                    "Option {} does not belong to property definition {}",
                    option.id, self.definition.id
                ));
            }
        }

        Ok(())
    }
}

// ===== EntityPropertyWithDefinition Behavior =====

impl EntityPropertyWithDefinition {
    /// Validate the entity property, definition, value, and options
    pub fn validate(&self) -> Result<(), String> {
        // Validate the property definition
        self.definition.validate()?;

        // Validate the entity property
        self.property.validate()?;

        // Ensure property definition ID matches
        if self.property.property_definition_id != self.definition.id {
            return Err(format!(
                "Entity property definition ID {} does not match definition ID {}",
                self.property.property_definition_id, self.definition.id
            ));
        }

        // If value is provided, validate it
        if let Some(value) = &self.value {
            value.validate().map_err(|e| e.to_string())?;
        }

        // If options are provided, validate them
        if let Some(options) = &self.options {
            for option in options {
                option.validate().map_err(|e| e.to_string())?;

                // Ensure option belongs to this property definition
                if option.property_definition_id != self.definition.id {
                    return Err(format!(
                        "Option {} does not belong to property definition {}",
                        option.id, self.definition.id
                    ));
                }
            }
        }

        Ok(())
    }
}
