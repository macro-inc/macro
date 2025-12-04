//! Port definitions for system properties.
//!
//! These traits define the interfaces that the domain layer uses.
//! Implementations live in the outbound module.

use models_properties::EntityType;
use uuid::Uuid;

use crate::domain::model::SystemPropertyError;

/// A single property row to upsert.
#[derive(Debug)]
pub struct PropertyRow {
    /// The entity ID to attach the property to.
    pub entity_id: String,
    /// The entity type.
    pub entity_type: EntityType,
    /// The property definition UUID.
    pub property_definition_id: Uuid,
    /// The property values as JSON.
    pub values: serde_json::Value,
}

/// Repository trait for system property database operations.
///
/// This trait abstracts the database layer, allowing for different implementations
/// (e.g., PostgreSQL, mock for testing).
pub trait SystemPropertiesRepository: Clone + Send + Sync + 'static {
    /// Bulk upsert property rows in a single query.
    fn bulk_upsert_properties(
        &self,
        rows: Vec<PropertyRow>,
    ) -> impl Future<Output = Result<(), SystemPropertyError>> + Send;
}
