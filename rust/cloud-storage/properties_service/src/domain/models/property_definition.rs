//! Property definition model

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DataType, EntityType, PropertyOwner};

/// Property definition - defines a reusable property that can be attached to entities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyDefinition {
    pub id: Uuid,
    pub owner: PropertyOwner,
    pub display_name: String,
    pub data_type: DataType,
    pub is_multi_select: bool,
    pub specific_entity_type: Option<EntityType>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_metadata: bool,
}

impl PropertyDefinition {
    /// Create a new property definition (useful for testing or manual construction)
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

        if self.display_name.len() > 127 {
            return Err("Display name cannot exceed 127 characters".to_string());
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
}
