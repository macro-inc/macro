//! Domain models for entity access.

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use serde::{Deserialize, Serialize};

pub use model_entity::EntityType;
pub use models_permissions::share_permission::access_level::AccessLevel;

/// The role a user has within a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
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

/// Result of resolving a user's role in a channel.
///
/// Distinguishes between "user has a role", "channel exists but user
/// has no access", and "channel does not exist" — all from a single query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelRoleResult {
    /// User has a role in the channel.
    Role(ParticipantRole),
    /// Channel exists but user has no access.
    NoAccess,
    /// Channel does not exist.
    NotFound,
}

/// A given entity
#[derive(Debug)]
pub struct Entity {
    /// The id of the entity
    pub entity_id: String,
    /// The type of the entity
    pub entity_type: EntityType,
}

/// The entity access auth type
#[derive(Debug)]
pub enum EntityAccessAuth {
    /// The user is authenticated
    Authenticated(MacroUserId<Lowercase<'static>>),
    /// The user is unauthenticated
    Unauthenticated,
    /// Internally authenticated
    Internal,
}

/// Represents that a given user has a given permission for the provided id.
#[derive(Debug)]
pub struct EntityAccessReceipt {
    /// The entity access authentication method
    pub(crate) auth: EntityAccessAuth,
    /// The entity that was requested access
    pub(crate) entity: Entity,
    /// The permission for the user on the entity
    pub(crate) entity_permission: EntityPermission,
}

impl EntityAccessReceipt {
    /// Getter for auth
    pub fn auth(&self) -> &EntityAccessAuth {
        &self.auth
    }

    /// Getter for entity
    pub fn entity(&self) -> &Entity {
        &self.entity
    }

    /// Getter for entity permission
    pub fn entity_permission(&self) -> &EntityPermission {
        &self.entity_permission
    }
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

    /// Requested resource was not found.
    #[error("Not found: {0}")]
    NotFound(&'static str),

    /// Internal server error.
    #[error("Internal error")]
    Internal,
}
