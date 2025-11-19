//! Domain models - core business entities
//!
//! This module re-exports models_properties types as the single source of truth,
//! and adds domain behavior (validation, constructors, business logic) via impl blocks.

// Domain extensions (adds methods to models_properties types)
pub mod extensions;

// Common domain models (wrappers/composites)
pub mod common;

// Request/response models (domain-specific, not in models_properties)
pub mod requests;
pub mod responses;

// Re-export models_properties types as domain models (single source of truth)
pub use models_properties::service::{
    EntityProperty, PropertyDefinition, PropertyOption, PropertyOptionValue, PropertyValue,
};
pub use models_properties::shared::{DataType, EntityReference, EntityType, PropertyOwner};

// Re-export domain extensions (impl blocks for models_properties types)
pub use extensions::*;

// Re-export common domain models
pub use common::*;

// Re-export request/response types
pub use requests::*;
pub use responses::*;

// ===== OLD DOMAIN MODEL FILES (TO BE DELETED AFTER REFACTOR) =====
// These files are kept temporarily but should not be imported:
// - data_type.rs
// - entity_property.rs
// - entity_reference.rs
// - entity_type.rs
// - property_definition.rs
// - property_option.rs
// - property_owner.rs
// - property_value.rs
