//! Domain error types for properties.

use models_properties::service::property_option::PropertyOption;
use thiserror::Error;

/// Domain error type for property operations.
#[derive(Debug, Error)]
pub enum PropertiesErr {
    /// Validation errors (includes property not found) - maps to 400
    #[error("{0}")]
    Validation(String),

    /// Permission denied - maps to 403
    #[error("Access denied")]
    PermissionDenied,

    /// Requested resource not found - maps to 404
    #[error("Property definition not found")]
    NotFound,

    /// Property option not found - maps to 404
    #[error("Property option not found")]
    OptionNotFound,

    /// Entity property not found - maps to 404
    #[error("Entity property not found")]
    EntityPropertyNotFound,

    /// The property is required for the entity type - maps to 403
    #[error("This property is required and cannot be removed from this entity")]
    RequiredProperty,

    /// An option with the requested value already exists - maps to 409
    #[error("An option with that value already exists")]
    DuplicateOptionValue,

    /// Promoting a personal label would collide with an existing team label -
    /// maps to 409. Carries the team label so the caller can offer to merge
    /// into it instead.
    #[error("A team label with that name already exists")]
    ConflictingTeamLabel(Box<PropertyOption>),

    /// System properties cannot be modified - maps to 403
    #[error("Cannot modify system properties")]
    SystemPropertyNotModifiable,

    /// Team scope was requested by a caller with no team - maps to 403
    #[error("You must be on a team to use team-scoped properties")]
    TeamMembershipRequired,

    /// Repository/database errors - maps to 500
    #[error(transparent)]
    Repo(#[from] anyhow::Error),

    /// Permission service is not configured
    #[error("permission service is not configured")]
    PermissionServiceNotConfigured,
}
