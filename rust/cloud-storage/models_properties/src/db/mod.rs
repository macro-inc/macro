//! Database layer types - used only by properties_db_client.
//!
//! These structs directly map to database tables and include all database fields.
//! They should not be exposed outside of the db_client.

pub mod entity_property;
pub mod error;
pub mod property_definition;
pub mod property_option;

pub use entity_property::EntityProperty;
pub use error::DbConversionError;
pub use property_definition::PropertyDefinition;
pub use property_option::PropertyOption;
