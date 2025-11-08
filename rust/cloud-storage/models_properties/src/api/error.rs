//! API validation errors

use thiserror::Error;

/// Errors that can occur during property definition validation
#[derive(Debug, Error, Clone, PartialEq)]
pub enum PropertyDefinitionValidationError {
    #[error("Display name length {length} is invalid. Must be between {min} and {max} characters.")]
    InvalidDisplayNameLength {
        length: usize,
        min: usize,
        max: usize,
    },
}

/// Errors that can occur during property option validation
#[derive(Debug, Error, Clone, PartialEq)]
pub enum PropertyOptionValidationError {
    #[error("Cannot add string option to non-SelectString property")]
    StringOptionWrongType,

    #[error("Cannot add number option to non-SelectNumber property")]
    NumberOptionWrongType,

    #[error("Option value cannot be empty or whitespace")]
    EmptyValue,

    #[error("Number option value must be finite (not NaN or Infinity)")]
    InvalidNumberValue,
}

/// Errors that can occur during property value validation
#[derive(Debug, Error, Clone, PartialEq)]
pub enum PropertyValueValidationError {
    #[error("Boolean values can only be used with Boolean properties")]
    BooleanWrongType,

    #[error("Boolean properties cannot be multi-select")]
    BooleanMultiSelect,

    #[error("Date values can only be used with Date properties")]
    DateWrongType,

    #[error("Date properties cannot be multi-select")]
    DateMultiSelect,

    #[error("Number values can only be used with Number properties")]
    NumberWrongType,

    #[error("Number properties cannot be multi-select")]
    NumberMultiSelect,

    #[error("String values can only be used with String properties")]
    StringWrongType,

    #[error("String properties cannot be multi-select")]
    StringMultiSelect,

    #[error("Select options can only be used with SelectString or SelectNumber properties")]
    SelectOptionWrongType,

    #[error("Single select options cannot be used with multi-select properties")]
    SelectOptionMultiSelect,

    #[error("Multi-select options can only be used with SelectString or SelectNumber properties")]
    MultiSelectOptionWrongType,

    #[error("Multi-select options can only be used with multi-select properties")]
    MultiSelectOptionNotMulti,

    #[error("Entity references can only be used with Entity properties")]
    EntityReferenceWrongType,

    #[error("Single entity references cannot be used with multi-select properties")]
    EntityReferenceMultiSelect,

    #[error("Multi-entity references can only be used with Entity properties")]
    MultiEntityReferenceWrongType,

    #[error("Multi-entity references can only be used with multi-select properties")]
    MultiEntityReferenceNotMulti,

    #[error("Link values can only be used with Link properties")]
    LinkWrongType,

    #[error("Single link values cannot be used with multi-select properties")]
    LinkMultiSelect,

    #[error("Multi-link values can only be used with Link properties")]
    MultiLinkWrongType,

    #[error("Multi-link values can only be used with multi-select properties")]
    MultiLinkNotMulti,
}

/// Errors that can occur during query parameter validation
#[derive(Debug, Error, Clone, PartialEq)]
pub enum QueryParamValidationError {
    #[error("entity_ids parameter is empty")]
    EmptyEntityIds,
}
