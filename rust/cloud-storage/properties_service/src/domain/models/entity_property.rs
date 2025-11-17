//! Entity property model - links entities to property definitions with values

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{EntityType, PropertyValue};

/// Assignment of a property definition to a specific entity, with its value
/// This creates the link: Entity → PropertyDefinition + Value
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityProperty {
    pub id: Uuid,
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
    /// The actual value stored for this property (optional - can attach property without value)
    pub value: Option<PropertyValue>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl EntityProperty {
    /// Create a new entity property with optional value
    pub fn new(
        entity_id: String,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: macro_uuid::generate_uuid_v7(),
            entity_id,
            entity_type,
            property_definition_id,
            value,
            created_at: now,
            updated_at: now,
        }
    }

    /// Validate the entity property
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.entity_id.is_empty() {
            return Err("Entity ID cannot be empty");
        }

        // Validate the value if present
        if let Some(ref value) = self.value {
            value.validate()?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_property_creation() {
        let prop = EntityProperty::new(
            "doc123".to_string(),
            EntityType::Document,
            Uuid::new_v4(),
            None,
        );

        assert_eq!(prop.entity_id, "doc123");
        assert_eq!(prop.entity_type, EntityType::Document);
        assert!(prop.value.is_none());
        assert!(prop.validate().is_ok());
    }

    #[test]
    fn test_entity_property_with_value() {
        let prop = EntityProperty::new(
            "doc123".to_string(),
            EntityType::Document,
            Uuid::new_v4(),
            Some(PropertyValue::Str("test value".to_string())),
        );

        assert!(prop.value.is_some());
        assert!(prop.validate().is_ok());
    }

    #[test]
    fn test_entity_property_validation() {
        let mut prop = EntityProperty::new(
            "doc123".to_string(),
            EntityType::Document,
            Uuid::new_v4(),
            None,
        );
        assert!(prop.validate().is_ok());

        prop.entity_id = String::new();
        assert!(prop.validate().is_err());
    }
}
