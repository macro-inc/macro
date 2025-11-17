//! Property value model - actual values assigned to entity properties

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EntityReference;

/// Actual value stored for an entity property
/// This is serialized to/from JSONB in the database
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum PropertyValue {
    /// Boolean value
    #[serde(rename = "Boolean")]
    Bool(bool),
    /// Numeric value
    #[serde(rename = "Number")]
    Num(f64),
    /// String value
    #[serde(rename = "String")]
    Str(String),
    /// Date/timestamp value
    Date(DateTime<Utc>),
    /// Select option(s) - always an array (check is_multi_select to determine if single or multi)
    SelectOption(Vec<Uuid>),
    /// Entity reference(s) - always an array (check is_multi_select to determine if single or multi)
    #[serde(rename = "EntityReference")]
    EntityRef(Vec<EntityReference>),
    /// Link value(s) - always an array (check is_multi_select to determine if single or multi)
    Link(Vec<String>),
}

impl PropertyValue {
    /// Validate the property value
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            PropertyValue::Num(n) if !n.is_finite() => Err("Numeric value must be finite"),
            PropertyValue::EntityRef(refs) => {
                for r in refs {
                    r.validate()?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::EntityType;

    #[test]
    fn test_property_value_validation() {
        // Valid values
        assert!(PropertyValue::Bool(true).validate().is_ok());
        assert!(PropertyValue::Num(42.0).validate().is_ok());
        assert!(PropertyValue::Str("test".to_string()).validate().is_ok());
        assert!(PropertyValue::Str(String::new()).validate().is_ok());

        // Invalid numeric value
        assert!(PropertyValue::Num(f64::NAN).validate().is_err());
    }

    #[test]
    fn test_entity_ref_validation() {
        let valid_ref = PropertyValue::EntityRef(vec![EntityReference::new(
            EntityType::Document,
            "doc123".to_string(),
        )]);
        assert!(valid_ref.validate().is_ok());

        let invalid_ref = PropertyValue::EntityRef(vec![EntityReference::new(
            EntityType::Document,
            String::new(),
        )]);
        assert!(invalid_ref.validate().is_err());
    }
}
