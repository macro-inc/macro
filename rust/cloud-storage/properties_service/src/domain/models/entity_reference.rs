//! Entity reference for property values

use serde::{Deserialize, Serialize};

use super::EntityType;

/// Reference to an entity (used in entity-type property values)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityReference {
    pub entity_type: EntityType,
    pub entity_id: String,
}

impl EntityReference {
    /// Create a new entity reference
    pub fn new(entity_type: EntityType, entity_id: String) -> Self {
        Self {
            entity_type,
            entity_id,
        }
    }

    /// Validate the entity reference
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.entity_id.is_empty() {
            return Err("Entity ID cannot be empty");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_reference_validation() {
        let valid_ref = EntityReference::new(EntityType::Document, "doc123".to_string());
        assert!(valid_ref.validate().is_ok());

        let invalid_ref = EntityReference::new(EntityType::Document, String::new());
        assert!(invalid_ref.validate().is_err());
    }
}
