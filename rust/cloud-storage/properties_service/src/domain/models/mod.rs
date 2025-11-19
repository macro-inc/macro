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
pub use models_properties::service::{
    EntityProperty,
    // Composite types
    EntityPropertyWithDefinition,
    PropertyDefinition,
    PropertyDefinitionWithOptions,
    PropertyOption,
    PropertyOptionValue,
    PropertyValue,
};
pub use models_properties::shared::{DataType, EntityReference, EntityType, PropertyOwner};

// Re-export domain extensions (impl blocks for models_properties types)
pub use extensions::*;

// Re-export request/response types
pub use requests::*;
pub use responses::*;
