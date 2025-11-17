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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supports_multi_select() {
        assert!(DataType::SelectNumber.supports_multi_select());
        assert!(DataType::SelectString.supports_multi_select());
        assert!(DataType::Entity.supports_multi_select());
        assert!(DataType::Link.supports_multi_select());

        assert!(!DataType::Boolean.supports_multi_select());
        assert!(!DataType::Date.supports_multi_select());
        assert!(!DataType::Number.supports_multi_select());
        assert!(!DataType::String.supports_multi_select());
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
