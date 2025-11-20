//! Domain models - core business entities
//!
//! This module re-exports models_properties types as the single source of truth,
//! and adds domain behavior (validation, constructors, business logic) via impl blocks.

// Domain extensions (adds methods to models_properties types)
pub mod extensions;

// Request/response models (domain-specific, not in models_properties)
pub mod requests;
pub mod responses;

// Re-export models_properties types as domain models (single source of truth)
pub use models_properties::service::entity_property::EntityProperty;
pub use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
pub use models_properties::service::property_definition::PropertyDefinition;
pub use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
pub use models_properties::service::property_option::PropertyOption;
pub use models_properties::service::property_option::PropertyOptionValue;
pub use models_properties::service::property_value::PropertyValue;
pub use models_properties::shared::{DataType, EntityReference, EntityType, PropertyOwner};

// Re-export domain extensions (impl blocks for models_properties types)
// Note: Extensions are used via impl blocks, not direct imports

// Re-export request/response types
pub use requests::*;
pub use responses::*;
