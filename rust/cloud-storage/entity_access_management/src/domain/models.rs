//! Domain models for entity access management.

use model_entity::EntityType;

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

/// Entity access source type
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "entity_access_source_type", rename_all = "lowercase")
)]
pub enum EntityAccessSourceType {
    /// Channel source
    Channel,
    /// Team source
    Team,
    /// User source
    User,
}
