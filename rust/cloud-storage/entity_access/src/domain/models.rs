//! Domain models for entity access.

use serde::{Deserialize, Serialize};

pub use model_entity::EntityType;
pub use models_permissions::share_permission::access_level::AccessLevel;

/// The role a user has within a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    /// Channel owner with full control.
    Owner,
    /// Channel administrator.
    Admin,
    /// Regular channel member.
    #[default]
    Member,
}

/// A user's permission for an entity, discriminated by entity kind.
///
/// Items (documents, chats, projects, threads) use access levels.
/// Channels use participant roles.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EntityPermission {
    /// Permission for item-based entities (document, chat, project, thread).
    AccessLevel {
        /// The access level the user has.
        access_level: AccessLevel,
    },
    /// Permission for channel-based entities.
    ChannelRole {
        /// The role the user has in the channel.
        role: ParticipantRole,
    },
}

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
    DatabaseError(#[from] sqlx::Error),

    /// Bad request parameters.
    #[error("Bad request: {0}")]
    BadRequest(&'static str),

    /// Internal server error.
    #[error("Internal error")]
    Internal,
}
