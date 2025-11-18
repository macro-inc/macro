//! Domain models - core business entities

pub mod data_type;
pub mod entity_property;
pub mod entity_reference;
pub mod entity_type;
pub mod property_definition;
pub mod property_option;
pub mod property_owner;
pub mod property_value;
pub mod requests;
pub mod responses;

pub use data_type::DataType;
pub use entity_property::EntityProperty;
pub use entity_reference::EntityReference;
pub use entity_type::EntityType;
pub use property_definition::PropertyDefinition;
pub use property_option::{PropertyOption, PropertyOptionValue};
pub use property_owner::PropertyOwner;
pub use property_value::PropertyValue;

// Re-export request/response types
pub use requests::*;
pub use responses::*;
