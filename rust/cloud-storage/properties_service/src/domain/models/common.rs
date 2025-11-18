//! Common domain models used across requests and responses

use super::{EntityProperty, PropertyDefinition, PropertyOption, PropertyValue};

/// Property definition with optional options
/// Used in list responses and create-with-options responses
#[derive(Debug, Clone)]
pub struct PropertyWithOptions {
    pub definition: PropertyDefinition,
    pub options: Option<Vec<PropertyOption>>,
}

impl PropertyWithOptions {
    /// Validate the property definition and options
    pub fn validate(&self) -> Result<(), String> {
        // Validate the definition
        self.definition.validate()?;

        // If options are provided, validate them
        if let Some(options) = &self.options {
            // Validate each option
            for option in options {
                option.validate()?;

                // Ensure option belongs to this property
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

/// Entity property with its definition and optional value/options
/// Used for rich entity property queries and bulk operations
#[derive(Debug, Clone)]
pub struct EntityPropertyWithDefinition {
    pub property: EntityProperty,
    pub definition: PropertyDefinition,
    pub value: Option<PropertyValue>,
    pub options: Option<Vec<PropertyOption>>,
}

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
                option.validate()?;

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
