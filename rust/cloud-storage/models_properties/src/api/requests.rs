//! API layer request types.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::error::{
    PropertyDefinitionValidationError, PropertyOptionValidationError, PropertyValueValidationError,
};
use crate::shared::{DataType, EntityReference, EntityType, PropertyOwner};

// ===== Property Definition Requests =====

/// Option for select-type properties in requests.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct SelectStringOption {
    pub display_order: i32,
    pub value: String,
}

/// Option for select number properties in requests.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct SelectNumberOption {
    pub display_order: i32,
    pub value: f64,
}

/// Data type with embedded options for requests - provides compile-time validation.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum PropertyDataType {
    /// Boolean true/false values.
    Boolean,
    /// Date and time values.
    Date,
    /// Numeric values.
    Number,
    /// String/text values.
    String,
    /// Select property with numeric options.
    #[serde(rename_all = "snake_case")]
    SelectNumber {
        options: Vec<SelectNumberOption>,
        multi: bool,
    },
    /// Select property with string options.
    #[serde(rename_all = "snake_case")]
    SelectString {
        options: Vec<SelectStringOption>,
        multi: bool,
    },
    /// Entity reference property.
    #[serde(rename_all = "snake_case")]
    Entity {
        specific_type: Option<EntityType>,
        multi: bool,
    },
    /// Link property.
    #[serde(rename_all = "snake_case")]
    Link { multi: bool },
}

impl PropertyDataType {
    /// Extract the base DataType for database storage
    pub fn to_data_type(&self) -> DataType {
        match self {
            PropertyDataType::Boolean => DataType::Boolean,
            PropertyDataType::Date => DataType::Date,
            PropertyDataType::Number => DataType::Number,
            PropertyDataType::String => DataType::String,
            PropertyDataType::SelectNumber { .. } => DataType::SelectNumber,
            PropertyDataType::SelectString { .. } => DataType::SelectString,
            PropertyDataType::Entity { .. } => DataType::Entity,
            PropertyDataType::Link { .. } => DataType::Link,
        }
    }

    /// Get the specific entity type if this is an Entity property
    pub fn specific_entity_type(&self) -> Option<EntityType> {
        match self {
            PropertyDataType::Entity { specific_type, .. } => *specific_type,
            _ => None,
        }
    }

    /// Get whether this property supports multi-select
    pub fn is_multi_select(&self) -> bool {
        match self {
            PropertyDataType::SelectNumber { multi, .. } => *multi,
            PropertyDataType::SelectString { multi, .. } => *multi,
            PropertyDataType::Entity { multi, .. } => *multi,
            PropertyDataType::Link { multi, .. } => *multi,
            _ => false,
        }
    }
}

/// Request to create a new property definition.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreatePropertyDefinitionRequest {
    #[serde(flatten)]
    pub owner: PropertyOwner,
    pub display_name: String,
    pub data_type: PropertyDataType,
}

/// Validation constants for property definitions
pub mod validation_constants {
    pub const MIN_PROPERTY_NAME_LENGTH: usize = 1;
    pub const MAX_PROPERTY_NAME_LENGTH: usize = 100;
}

impl CreatePropertyDefinitionRequest {
    /// Validate property name length
    pub fn validate_display_name(&self) -> Result<(), PropertyDefinitionValidationError> {
        let display_name_length = self.display_name.len();
        if !(validation_constants::MIN_PROPERTY_NAME_LENGTH
            ..=validation_constants::MAX_PROPERTY_NAME_LENGTH)
            .contains(&display_name_length)
        {
            return Err(
                PropertyDefinitionValidationError::InvalidDisplayNameLength {
                    length: display_name_length,
                    min: validation_constants::MIN_PROPERTY_NAME_LENGTH,
                    max: validation_constants::MAX_PROPERTY_NAME_LENGTH,
                },
            );
        }
        Ok(())
    }

    /// Validate all property definition constraints
    pub fn validate(&self) -> Result<(), PropertyDefinitionValidationError> {
        self.validate_display_name()?;
        Ok(())
    }
}

// ===== Property Option Requests =====

/// Type-safe request to add a string option to a SelectString property.
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone)]
pub struct AddStringOptionRequest {
    pub display_order: i32,
    pub value: String,
}

/// Type-safe request to add a number option to a SelectNumber property.
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone)]
pub struct AddNumberOptionRequest {
    pub display_order: i32,
    pub value: f64,
}

/// Enum for type-safe property option addition requests.
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum AddPropertyOptionRequest {
    /// Add a string option to a SelectString property
    #[serde(rename_all = "snake_case")]
    SelectString { option: AddStringOptionRequest },
    /// Add a number option to a SelectNumber property
    #[serde(rename_all = "snake_case")]
    SelectNumber { option: AddNumberOptionRequest },
}

impl AddPropertyOptionRequest {
    /// Validate that the request type matches the property data type
    pub fn validate_compatibility(
        &self,
        data_type: &DataType,
    ) -> Result<(), PropertyOptionValidationError> {
        match (self, data_type) {
            (AddPropertyOptionRequest::SelectString { .. }, DataType::SelectString) => Ok(()),
            (AddPropertyOptionRequest::SelectNumber { .. }, DataType::SelectNumber) => Ok(()),
            (AddPropertyOptionRequest::SelectString { .. }, _) => {
                Err(PropertyOptionValidationError::StringOptionWrongType)
            }
            (AddPropertyOptionRequest::SelectNumber { .. }, _) => {
                Err(PropertyOptionValidationError::NumberOptionWrongType)
            }
        }
    }

    /// Validate the option value is valid
    pub fn validate(&self) -> Result<(), PropertyOptionValidationError> {
        match self {
            AddPropertyOptionRequest::SelectString { option } => {
                if option.value.trim().is_empty() {
                    return Err(PropertyOptionValidationError::EmptyValue);
                }
                Ok(())
            }
            AddPropertyOptionRequest::SelectNumber { option } => {
                if !option.value.is_finite() {
                    return Err(PropertyOptionValidationError::InvalidNumberValue);
                }
                Ok(())
            }
        }
    }
}

// ===== Entity Property Value Requests =====

/// Type-safe enum for setting entity property values - provides compile-time validation.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum SetPropertyValue {
    /// Boolean true/false value
    Boolean { value: bool },
    /// Date and time value
    Date { value: DateTime<Utc> },
    /// Numeric value
    Number { value: f64 },
    /// String/text value
    String { value: String },
    /// Select option by ID (for select-type properties)
    SelectOption { option_id: Uuid },
    /// Multiple select options by ID (for multi-select properties)
    MultiSelectOption { option_ids: Vec<Uuid> },
    /// Entity reference
    EntityReference { reference: EntityReference },
    /// Multiple entity references (for multi-select entity properties)
    MultiEntityReference { references: Vec<EntityReference> },
    /// Link value
    Link { url: String },
    /// Multiple link values (for multi-select link properties)
    MultiLink { urls: Vec<String> },
}

impl SetPropertyValue {
    /// Validate that the value type is compatible with the property data type
    pub fn validate_compatibility(
        &self,
        data_type: &DataType,
        is_multi_select: bool,
    ) -> Result<(), PropertyValueValidationError> {
        match self {
            SetPropertyValue::Boolean { .. } => {
                if !matches!(data_type, DataType::Boolean) {
                    return Err(PropertyValueValidationError::BooleanWrongType);
                }
                if is_multi_select {
                    return Err(PropertyValueValidationError::BooleanMultiSelect);
                }
                Ok(())
            }

            SetPropertyValue::Date { .. } => {
                if !matches!(data_type, DataType::Date) {
                    return Err(PropertyValueValidationError::DateWrongType);
                }
                if is_multi_select {
                    return Err(PropertyValueValidationError::DateMultiSelect);
                }
                Ok(())
            }

            SetPropertyValue::Number { .. } => {
                if !matches!(data_type, DataType::Number) {
                    return Err(PropertyValueValidationError::NumberWrongType);
                }
                if is_multi_select {
                    return Err(PropertyValueValidationError::NumberMultiSelect);
                }
                Ok(())
            }

            SetPropertyValue::String { .. } => {
                if !matches!(data_type, DataType::String) {
                    return Err(PropertyValueValidationError::StringWrongType);
                }
                if is_multi_select {
                    return Err(PropertyValueValidationError::StringMultiSelect);
                }
                Ok(())
            }

            SetPropertyValue::SelectOption { .. } => {
                if !matches!(data_type, DataType::SelectString | DataType::SelectNumber) {
                    return Err(PropertyValueValidationError::SelectOptionWrongType);
                }
                if is_multi_select {
                    return Err(PropertyValueValidationError::SelectOptionMultiSelect);
                }
                Ok(())
            }

            SetPropertyValue::MultiSelectOption { .. } => {
                if !matches!(data_type, DataType::SelectString | DataType::SelectNumber) {
                    return Err(PropertyValueValidationError::MultiSelectOptionWrongType);
                }
                if !is_multi_select {
                    return Err(PropertyValueValidationError::MultiSelectOptionNotMulti);
                }
                Ok(())
            }

            SetPropertyValue::EntityReference { .. } => {
                if !matches!(data_type, DataType::Entity) {
                    return Err(PropertyValueValidationError::EntityReferenceWrongType);
                }
                if is_multi_select {
                    return Err(PropertyValueValidationError::EntityReferenceMultiSelect);
                }
                Ok(())
            }

            SetPropertyValue::MultiEntityReference { .. } => {
                if !matches!(data_type, DataType::Entity) {
                    return Err(PropertyValueValidationError::MultiEntityReferenceWrongType);
                }
                if !is_multi_select {
                    return Err(PropertyValueValidationError::MultiEntityReferenceNotMulti);
                }
                Ok(())
            }

            SetPropertyValue::Link { .. } => {
                if !matches!(data_type, DataType::Link) {
                    return Err(PropertyValueValidationError::LinkWrongType);
                }
                if is_multi_select {
                    return Err(PropertyValueValidationError::LinkMultiSelect);
                }
                Ok(())
            }

            SetPropertyValue::MultiLink { .. } => {
                if !matches!(data_type, DataType::Link) {
                    return Err(PropertyValueValidationError::MultiLinkWrongType);
                }
                if !is_multi_select {
                    return Err(PropertyValueValidationError::MultiLinkNotMulti);
                }
                Ok(())
            }
        }
    }
}
