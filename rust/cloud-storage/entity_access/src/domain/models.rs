//! Domain models for entity access.

use std::marker::PhantomData;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use serde::{Deserialize, Serialize};

pub use model_entity::EntityType;
pub use models_permissions::share_permission::access_level::AccessLevel;
pub use models_permissions::share_permission::access_level::{
    CommentAccessLevel, EditAccessLevel, OwnerAccessLevel, ViewAccessLevel,
};

/// Trait to convert a unit struct marker into an [`AccessLevel`].
///
/// This allows extractors and receipts to be parameterized by required access level.
/// Implement this for marker types like `ViewAccessLevel`, `EditAccessLevel`, etc.
pub trait RequiredAccessLevel: std::fmt::Debug + Send + Sync + 'static {
    /// Returns the access level this marker represents.
    fn required_level() -> AccessLevel;
}

impl RequiredAccessLevel for ViewAccessLevel {
    fn required_level() -> AccessLevel {
        AccessLevel::View
    }
}

impl RequiredAccessLevel for CommentAccessLevel {
    fn required_level() -> AccessLevel {
        AccessLevel::Comment
    }
}

impl RequiredAccessLevel for EditAccessLevel {
    fn required_level() -> AccessLevel {
        AccessLevel::Edit
    }
}

impl RequiredAccessLevel for OwnerAccessLevel {
    fn required_level() -> AccessLevel {
        AccessLevel::Owner
    }
}

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
///
/// The type parameter `T` encodes the minimum access level that was verified
/// when this receipt was created.
#[derive(Debug)]
pub struct EntityAccessReceipt<T: RequiredAccessLevel> {
    /// The entity access authentication method
    pub(crate) auth: EntityAccessAuth,
    /// The entity that was requested access
    pub(crate) entity: Entity,
    /// The permission for the user on the entity
    pub(crate) entity_permission: EntityPermission,
    /// Phantom data to carry the access level type
    pub(crate) _marker: PhantomData<T>,
}

impl<T: RequiredAccessLevel> EntityAccessReceipt<T> {
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
