//! Port definitions (traits) for properties.
//!
//! These traits define the interfaces that the domain layer uses.
//! Implementations live in the outbound module.

use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

/// Repository trait for property operations.
///
/// This trait abstracts the database layer, allowing for different implementations
/// (e.g., PostgreSQL, mock for testing).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait PropertiesRepo: Send + Sync + 'static {
    type Err;

    /// Atomically update a property value if the property is attached to the entity.
    /// No-op if the property is not attached.
    fn update_entity_property_value_if_exists(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        property_definition_id: Uuid,
        value: Option<PropertyValue>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
