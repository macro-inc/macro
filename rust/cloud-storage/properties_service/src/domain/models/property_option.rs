//! Property option model for select-type properties

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The value of a property option - either a string or a number
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PropertyOptionValue {
    String(String),
    Number(f64),
}

impl PropertyOptionValue {
    /// Get as string if this is a string value
    pub fn as_string(&self) -> Option<&str> {
        match self {
            PropertyOptionValue::String(s) => Some(s),
            PropertyOptionValue::Number(_) => None,
        }
    }

    /// Get as number if this is a number value
    pub fn as_number(&self) -> Option<f64> {
        match self {
            PropertyOptionValue::Number(n) => Some(*n),
            PropertyOptionValue::String(_) => None,
        }
    }

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

/// A selectable option for select-type properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyOption {
    pub id: Uuid,
    pub property_definition_id: Uuid,
    pub display_order: i32,
    pub value: PropertyOptionValue,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl PropertyOption {
    /// Validate the property option
    pub fn validate(&self) -> Result<(), &'static str> {
        self.value.validate()?;

        if self.display_order < 0 {
            return Err("Display order cannot be negative");
        }

        Ok(())
    }

    /// Create a new property option (useful for testing or manual construction)
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_property_option_value_accessors() {
        let string_val = PropertyOptionValue::String("test".to_string());
        assert_eq!(string_val.as_string(), Some("test"));
        assert_eq!(string_val.as_number(), None);

        let number_val = PropertyOptionValue::Number(42.0);
        assert_eq!(number_val.as_string(), None);
        assert_eq!(number_val.as_number(), Some(42.0));
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
