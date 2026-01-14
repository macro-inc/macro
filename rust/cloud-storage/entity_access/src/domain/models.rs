pub use models_permissions::share_permission::access_level::AccessLevel;
pub use models_properties::EntityType;

/// Errors that can occur during access checking.
#[derive(Debug, thiserror::Error)]
pub enum AccessError {
    /// User does not have access to the requested resource.
    #[error("User does not have access to the requested resource")]
    Unauthorized,

    /// User does not have access with a specific message.
    #[error("{0}")]
    UnauthorizedWithMessage(&'static str),

    /// Database error during access check.
    #[error("Database error: {0}")]
    DatabaseError(#[source] anyhow::Error),

    /// External service error during access check.
    #[error("External service error: {0}")]
    ExternalServiceError(#[source] anyhow::Error),

    /// Bad request parameters.
    #[error("Bad request: {0}")]
    BadRequest(&'static str),

    /// Internal server error.
    #[error("Internal error")]
    Internal,
}

/// Information from a SharePermission record needed for access checks.
///
/// This is used for entity types that don't use the optimized UserItemAccess
/// table (e.g., macros).
#[derive(Debug, Clone)]
pub struct SharePermissionInfo {
    /// The owner of the entity.
    pub owner_id: String,
    /// Whether the entity is publicly accessible.
    pub is_public: bool,
    /// The access level for public access (if public).
    pub public_access_level: Option<AccessLevel>,
    /// Channel-based permissions for this entity.
    pub channel_permissions: Vec<ChannelPermission>,
}

/// A channel-based permission entry.
#[derive(Debug, Clone)]
pub struct ChannelPermission {
    /// The channel ID.
    pub channel_id: uuid::Uuid,
    /// The access level granted through this channel.
    pub access_level: AccessLevel,
}
