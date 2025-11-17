//! Data type for property values

use serde::{Deserialize, Serialize};

/// Data type for property values, determining storage and validation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DataType {
    Boolean,
    Date,
    Number,
    String,
    SelectNumber,
    SelectString,
    Entity,
    Link,
}

impl DataType {
    /// Check if this data type supports multi-select
    pub fn supports_multi_select(&self) -> bool {
        matches!(
            self,
            DataType::SelectNumber | DataType::SelectString | DataType::Entity
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

// ===== Conversions to/from models_properties =====

impl From<models_properties::DataType> for DataType {
    fn from(external: models_properties::DataType) -> Self {
        match external {
            models_properties::DataType::Boolean => DataType::Boolean,
            models_properties::DataType::Date => DataType::Date,
            models_properties::DataType::Number => DataType::Number,
            models_properties::DataType::String => DataType::String,
            models_properties::DataType::SelectNumber => DataType::SelectNumber,
            models_properties::DataType::SelectString => DataType::SelectString,
            models_properties::DataType::Entity => DataType::Entity,
            models_properties::DataType::Link => DataType::Link,
        }
    }
}

impl From<DataType> for models_properties::DataType {
    fn from(domain: DataType) -> Self {
        match domain {
            DataType::Boolean => models_properties::DataType::Boolean,
            DataType::Date => models_properties::DataType::Date,
            DataType::Number => models_properties::DataType::Number,
            DataType::String => models_properties::DataType::String,
            DataType::SelectNumber => models_properties::DataType::SelectNumber,
            DataType::SelectString => models_properties::DataType::SelectString,
            DataType::Entity => models_properties::DataType::Entity,
            DataType::Link => models_properties::DataType::Link,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supports_multi_select() {
        assert!(DataType::SelectNumber.supports_multi_select());
        assert!(DataType::SelectString.supports_multi_select());
        assert!(DataType::Entity.supports_multi_select());

        assert!(!DataType::Boolean.supports_multi_select());
        assert!(!DataType::Date.supports_multi_select());
        assert!(!DataType::Number.supports_multi_select());
        assert!(!DataType::String.supports_multi_select());
        assert!(!DataType::Link.supports_multi_select());
    }

    #[test]
    fn test_requires_options() {
        assert!(DataType::SelectNumber.requires_options());
        assert!(DataType::SelectString.requires_options());

        assert!(!DataType::Boolean.requires_options());
        assert!(!DataType::Entity.requires_options());
    }

    #[test]
    fn test_is_select_type() {
        assert!(DataType::SelectNumber.is_select_type());
        assert!(DataType::SelectString.is_select_type());

        assert!(!DataType::Entity.is_select_type());
        assert!(!DataType::Boolean.is_select_type());
    }
}
