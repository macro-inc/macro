//! Domain models for entity access management.

use model_entity::EntityType;

/// Errors that can occur in entity_access_management crate.
#[derive(Debug, thiserror::Error)]
pub enum EntityAccessManagementError {
    /// Unsupported entity type provided
    #[error("unsupported entity type provided {0}")]
    UnsupportedEntityType(EntityType),
    /// Datbase error occured
    #[error(transparent)]
    DatabaseError(#[from] anyhow::Error),
}
