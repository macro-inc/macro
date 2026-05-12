//! Domain models for entity access.

use std::marker::PhantomData;

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use model_entity::EntityType;
pub use models_permissions::share_permission::access_level::AccessLevel;
pub use models_permissions::share_permission::access_level::{
    CommentAccessLevel, EditAccessLevel, OwnerAccessLevel, ViewAccessLevel,
};

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

/// The role a user has within a team.
///
/// Ordered least to most privileged so comparisons reflect access strength.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "\"team_role\"", rename_all = "lowercase")
)]
#[serde(rename_all = "snake_case")]
pub enum TeamRole {
    /// Regular team member.
    #[default]
    Member,
    /// Team administrator.
    Admin,
    /// Team owner with full control.
    Owner,
}

/// Team member role.
#[derive(Debug)]
pub struct MemberTeamRole;

/// Team administrator role.
#[derive(Debug)]
pub struct AdminTeamRole;

/// Team owner role with full control.
#[derive(Debug)]
pub struct OwnerTeamRole;

/// Channel owner role with full control
#[derive(Debug)]
pub struct OwnerParticipantRole;

/// Channel Administrator
#[derive(Debug)]
pub struct AdminParticipantRole;

/// Regular channel member.
#[derive(Debug)]
pub struct MemberParticipantRole;

/// Trait implemented by marker types that encode a permission requirement.
pub trait RequiredPermission: std::fmt::Debug + Send + Sync + 'static {
    /// Returns whether the provided permission satisfies this requirement.
    fn is_satisfied_by(permission: &EntityPermission) -> bool;
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
    /// Permission for team-based entities.
    TeamRole {
        /// The role the user has in the team.
        role: TeamRole,
    },
}

impl EntityPermission {
    /// Returns whether this permission grants at least the requested access level.
    pub fn allows_access_level(&self, required: AccessLevel) -> bool {
        matches!(
            self,
            EntityPermission::AccessLevel { access_level } if *access_level >= required
        )
    }

    /// Returns whether this permission grants at least the requested channel role.
    pub fn allows_participant_role(&self, required: ParticipantRole) -> bool {
        matches!(
            (self, required),
            (
                EntityPermission::ChannelRole {
                    role: ParticipantRole::Owner,
                },
                ParticipantRole::Owner,
            ) | (
                EntityPermission::ChannelRole {
                    role: ParticipantRole::Owner | ParticipantRole::Admin,
                },
                ParticipantRole::Admin,
            ) | (
                EntityPermission::ChannelRole {
                    role: ParticipantRole::Owner | ParticipantRole::Admin | ParticipantRole::Member,
                },
                ParticipantRole::Member
            )
        )
    }

    /// Returns whether this permission grants at least the requested team role.
    pub fn allows_team_role(&self, required: TeamRole) -> bool {
        matches!(
            self,
            EntityPermission::TeamRole { role } if *role >= required
        )
    }

    /// Returns whether this permission satisfies the provided marker type.
    pub fn satisfies<T: RequiredPermission>(&self) -> bool {
        T::is_satisfied_by(self)
    }
}

impl RequiredPermission for ViewAccessLevel {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_access_level(AccessLevel::View)
    }
}

impl RequiredPermission for CommentAccessLevel {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_access_level(AccessLevel::Comment)
    }
}

impl RequiredPermission for EditAccessLevel {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_access_level(AccessLevel::Edit)
    }
}

impl RequiredPermission for OwnerAccessLevel {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_access_level(AccessLevel::Owner)
    }
}

impl RequiredPermission for OwnerParticipantRole {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_participant_role(ParticipantRole::Owner)
    }
}

impl RequiredPermission for AdminParticipantRole {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_participant_role(ParticipantRole::Admin)
    }
}

impl RequiredPermission for MemberParticipantRole {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_participant_role(ParticipantRole::Member)
    }
}

impl RequiredPermission for MemberTeamRole {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_team_role(TeamRole::Member)
    }
}

impl RequiredPermission for AdminTeamRole {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_team_role(TeamRole::Admin)
    }
}

impl RequiredPermission for OwnerTeamRole {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.allows_team_role(TeamRole::Owner)
    }
}

/// The team a user belongs to and the role they hold in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UserTeamInfo {
    /// The team's id.
    pub team_id: Uuid,
    /// The user's role within the team.
    pub role: TeamRole,
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
#[derive(Debug, Clone)]
pub struct Entity {
    /// The id of the entity
    pub entity_id: String,
    /// The type of the entity
    pub entity_type: EntityType,
}

/// The entity access auth type
#[derive(Debug, Clone, serde::Serialize)]
#[serde(untagged)]
pub enum EntityAccessAuth {
    /// The user is authenticated
    Authenticated(MacroUserIdStr<'static>),
    /// The user is unauthenticated
    Unauthenticated,
    /// Internally authenticated
    Internal,
}

/// Represents that a given user has a given permission for the provided id.
///
/// The type parameter `T` encodes the minimum permission that was verified
/// when this receipt was created.
#[derive(Debug, Clone)]
pub struct EntityAccessReceipt<T: RequiredPermission> {
    /// The entity access authentication method
    pub(crate) auth: EntityAccessAuth,
    /// The entity that was requested access
    pub(crate) entity: Entity,
    /// The permission for the user on the entity
    pub(crate) entity_permission: EntityPermission,
    /// Phantom data to carry the access level type
    pub(crate) _marker: PhantomData<T>,
}

impl<T: RequiredPermission> EntityAccessReceipt<T> {
    /// get the authenticated user or error
    pub fn get_authenticated_user(&self) -> Result<&MacroUserIdStr<'static>, AccessError> {
        match &self.auth {
            EntityAccessAuth::Authenticated(user) => Ok(user),
            _ => Err(AccessError::Unauthorized),
        }
    }

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

    /// Dangerously generates a EntityAccessReceipt for an internal user
    /// **NOTE** This should only be used in specific circumstances and not as a way
    /// to circumvent AI tool permissioning
    /// This **DOES NOT** assert the existence of the item
    pub fn dangerously_assert_internal_user(
        entity_id: &str,
        entity_type: EntityType,
    ) -> EntityAccessReceipt<T> {
        EntityAccessReceipt {
            auth: EntityAccessAuth::Internal,
            entity: Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            entity_permission: EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
            _marker: PhantomData,
        }
    }
}

/// Information about a call's channel association and share permission.
#[derive(Debug, Clone)]
pub struct CallChannelInfo {
    /// The channel the call belongs to.
    pub channel_id: Uuid,
    /// The share permission ID for this call.
    pub share_permission_id: String,
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
