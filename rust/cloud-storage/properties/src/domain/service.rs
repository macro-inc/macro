//! Service trait for properties.

use models_properties::EntityType;

/// Service trait for property operations.
pub trait PropertiesService: Send + Sync + 'static {
    type Err;

    /// Set an entity's status system property to "Completed".
    /// No-op if the entity doesn't have a status property.
    fn set_system_property_status_complete(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
