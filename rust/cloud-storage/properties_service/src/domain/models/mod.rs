//! Domain models - core business entities

pub mod data_type;
pub mod entity_type;
pub mod property_definition;
pub mod property_option;
pub mod property_owner;

pub use data_type::DataType;
pub use entity_type::EntityType;
pub use property_definition::PropertyDefinition;
pub use property_option::{PropertyOption, PropertyOptionValue};
pub use property_owner::PropertyOwner;
