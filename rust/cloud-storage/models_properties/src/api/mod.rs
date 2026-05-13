//! API layer types - external-facing request and response types.
//!
//! These structs represent the API contract with clients.
//! They use ToSchema for OpenAPI documentation and may use camelCase serialization.

pub mod error;
pub mod query_params;
pub mod requests;
pub mod responses;

pub use error::{
    PropertyDefinitionValidationError, PropertyOptionValidationError, PropertyValueValidationError,
    QueryParamValidationError,
};
pub use query_params::{BulkEntityQueryParams, EntityQueryParams};
pub use requests::{
    AddNumberOptionRequest, AddPropertyOptionRequest, AddStringOptionRequest,
    CreatePropertyDefinitionRequest, PropertyDataType, SelectNumberOption, SelectStringOption,
    SetPropertyValue,
};
pub use responses::{
    BulkEntityPropertiesResponse, EntityPropertiesResponse, EntityPropertyResponse,
    EntityPropertyWithDefinitionResponse, PropertyDefinitionResponse,
    PropertyDefinitionWithOptionsResponse, PropertyOptionResponse, PropertyOptionValue,
    PropertyValue,
};
