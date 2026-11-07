//! Domain models for entity access management.

use model_entity::EntityType;

pub use models_entity_access_management::EntityAccessSourceType;

/// Errors that can occur in entity_access_management crate.
#[derive(Debug, thiserror::Error)]
pub enum EntityAccessManagementError {
    /// Unsupported entity type provided
    #[error("unsupported entity type provided {0}")]
    UnsupportedEntityType(EntityType),
    /// Database error occured
    #[error(transparent)]
    DatabaseError(#[from] anyhow::Error),
    /// Invalid project move configuration
    #[error("invalid project move configuration")]
    InvalidProjectMove,
}
