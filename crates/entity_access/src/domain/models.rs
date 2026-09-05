//! Domain models for entity access.

#[cfg(test)]
mod test;

use std::marker::PhantomData;

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use bot_id::{BotId, BotIdStr};
pub use model_entity::EntityType;
pub use models_permissions::share_permission::access_level::AccessLevel;
pub use models_permissions::share_permission::access_level::{
    CommentAccessLevel, EditAccessLevel, OwnerAccessLevel, ViewAccessLevel,
};

/// The access scope under which a bot-authorized request is resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BotAccessScope {
    /// Resolve access as the verified acting user.
    User {
        /// The verified acting user's identifier.
        user_id: MacroUserIdStr<'static>,
        /// The verified acting user's organization identifier, when present.
        user_org_id: Option<i64>,
    },
    /// Resolve access from a team's shared access pool.
    Team {
        /// The owning team's identifier.
        team_id: Uuid,
    },
}

impl BotAccessScope {
    /// User scope for a caller that knows only the acting user, such as an AI
    /// tool request, which carries no organization context.
    pub fn user(user_id: MacroUserIdStr<'static>) -> Self {
        Self::User {
            user_id,
            user_org_id: None,
        }
    }

    /// Returns the verified acting user's identifier for user scope.
    pub fn user_id(&self) -> Option<&MacroUserIdStr<'static>> {
        match self {
            Self::User { user_id, .. } => Some(user_id),
            Self::Team { .. } => None,
        }
    }

    /// Returns the verified acting user's organization identifier for user scope.
    pub fn user_org_id(&self) -> Option<i64> {
        match self {
            Self::User { user_org_id, .. } => *user_org_id,
            Self::Team { .. } => None,
        }
    }

    /// Returns the owning team's identifier for team scope.
    pub fn team_id(&self) -> Option<Uuid> {
        match self {
            Self::Team { team_id } => Some(*team_id),
            Self::User { .. } => None,
        }
    }
}

/// The bot scope context retained in an entity-access receipt.
///
/// User organization identifiers are intentionally omitted because they are
/// request-time authorization context rather than receipt identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum BotReceiptScope {
    /// Access was resolved as a verified acting user.
    User {
        /// The verified acting user's identifier.
        acting_user: MacroUserIdStr<'static>,
    },
    /// Access was resolved from a team's shared access pool.
    Team {
        /// The owning team's identifier.
        team_id: Uuid,
    },
}

impl BotReceiptScope {
    /// Returns the verified acting user's identifier for user scope.
    pub fn acting_user_id(&self) -> Option<&MacroUserIdStr<'static>> {
        match self {
            Self::User { acting_user } => Some(acting_user),
            Self::Team { .. } => None,
        }
    }

    /// Returns the owning team's identifier for team scope.
    pub fn team_id(&self) -> Option<Uuid> {
        match self {
            Self::Team { team_id } => Some(*team_id),
            Self::User { .. } => None,
        }
    }
}

impl From<&BotAccessScope> for BotReceiptScope {
    fn from(scope: &BotAccessScope) -> Self {
        match scope {
            BotAccessScope::User { user_id, .. } => Self::User {
                acting_user: user_id.clone(),
            },
            BotAccessScope::Team { team_id } => Self::Team { team_id: *team_id },
        }
    }
}

/// A user's resolved access to a CRM entity (company or contact) paired with
/// the entity's owning team — both produced by the same ownership lookup, so
/// the team is guaranteed to be the one that granted access (not the user's
/// default team).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrmEntityAccess {
    /// The access level the user holds on the entity.
    pub access_level: AccessLevel,
    /// The team that owns the entity.
    pub team_id: Uuid,
    /// The role the user holds on the owning team. Hidden-row visibility
    /// keys on this (admin/owner) rather than on the access level.
    pub team_role: TeamRole,
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
#[derive(Debug, Clone, Copy)]
pub struct MemberTeamRole;

/// Team administrator role.
#[derive(Debug, Clone, Copy)]
pub struct AdminTeamRole;

/// Team owner role with full control.
#[derive(Debug, Clone, Copy)]
pub struct OwnerTeamRole;

/// Channel owner role with full control
#[derive(Debug, Clone, Copy)]
pub struct OwnerParticipantRole;

/// Channel Administrator
#[derive(Debug, Clone, Copy)]
pub struct AdminParticipantRole;

/// Regular channel member.
#[derive(Debug, Clone, Copy)]
pub struct MemberParticipantRole;

/// Permission to view a channel without requiring an active participant role.
#[derive(Debug, Clone, Copy)]
pub struct ViewOnly;

/// Permission marker that accepts every valid entity permission.
#[derive(Debug, Clone, Copy)]
pub struct AnyEntityPermission;

/// Trait implemented by marker types that encode a permission requirement.
pub trait RequiredPermission: std::fmt::Debug + Send + Sync + 'static {
    /// Returns whether the provided permission satisfies this requirement.
    fn is_satisfied_by(permission: &EntityPermission) -> bool;
}

/// A user's permission for an entity, discriminated by entity kind.
///
/// Items (documents, chats, projects, threads) use access levels.
/// Channels use view-only permission or participant roles.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EntityPermission {
    /// Permission for item-based entities (document, chat, project, thread).
    AccessLevel {
        /// The access level the user has.
        access_level: AccessLevel,
    },
    /// View-only permission for a channel without an active participant role.
    ChannelViewOnly,
    /// Permission for channel-based entities with an active participant role.
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

impl RequiredPermission for AnyEntityPermission {
    fn is_satisfied_by(_permission: &EntityPermission) -> bool {
        true
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

impl RequiredPermission for ViewOnly {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        matches!(
            permission,
            EntityPermission::ChannelViewOnly | EntityPermission::ChannelRole { .. }
        )
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
/// Distinguishes between an active participant role, view-only access,
/// no access to an existing channel, and a channel that does not exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelRoleResult {
    /// User has a role in the channel.
    Role(ParticipantRole),
    /// User can view the channel without an active participant role.
    ViewOnly,
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

/// Authentication context retained for a bot entity-access receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BotReceiptAuth {
    bot_id: BotIdStr<'static>,
    #[serde(flatten)]
    scope: BotReceiptScope,
}

impl BotReceiptAuth {
    /// Creates receipt authentication context for a bot and its access scope.
    pub fn new(bot_id: BotIdStr<'static>, scope: BotReceiptScope) -> Self {
        Self { bot_id, scope }
    }

    /// Returns the bot's canonical identifier.
    pub fn bot_id(&self) -> BotId {
        self.bot_id.bot_id()
    }

    /// Returns the bot's canonical storage principal.
    pub fn bot_id_str(&self) -> &BotIdStr<'static> {
        &self.bot_id
    }

    /// Returns the scope retained in the receipt.
    pub fn scope(&self) -> &BotReceiptScope {
        &self.scope
    }
}

impl std::fmt::Display for BotReceiptAuth {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.bot_id)
    }
}

/// The entity access auth type
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum EntityAccessAuth {
    /// The user is authenticated
    Authenticated(MacroUserIdStr<'static>),
    /// A bot is authenticated under a specific access scope.
    Bot(BotReceiptAuth),
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
    /// Re-tag this receipt for another permission requirement after
    /// revalidating the already-resolved permission.
    ///
    /// This safely supports passing a stronger receipt to a read-only domain
    /// method without repeating the underlying access lookup.
    pub fn try_into_requirement<U: RequiredPermission>(
        self,
    ) -> Result<EntityAccessReceipt<U>, AccessError> {
        EntityAccessReceipt::<U>::try_new(self.auth, self.entity, self.entity_permission)
    }

    /// Creates an access receipt for the given auth after validating the
    /// provided permission against the required level `T`.
    pub fn try_new(
        auth: EntityAccessAuth,
        entity: Entity,
        entity_permission: EntityPermission,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if !entity_permission.satisfies::<T>() {
            return Err(AccessError::Unauthorized);
        }

        Ok(EntityAccessReceipt {
            auth,
            entity,
            entity_permission,
            _marker: PhantomData,
        })
    }

    /// Creates an access receipt for an authenticated user after validating the provided permission.
    pub fn try_new_authenticated_user(
        user_id: MacroUserIdStr<'static>,
        entity: Entity,
        entity_permission: EntityPermission,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Self::try_new(
            EntityAccessAuth::Authenticated(user_id),
            entity,
            entity_permission,
        )
    }

    /// Creates an access receipt for an authenticated bot after validating the provided permission.
    pub fn try_new_bot(
        bot_id: BotIdStr<'static>,
        scope: BotReceiptScope,
        entity: Entity,
        entity_permission: EntityPermission,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Self::try_new(
            EntityAccessAuth::Bot(BotReceiptAuth::new(bot_id, scope)),
            entity,
            entity_permission,
        )
    }

    /// Get the authenticated user or return an authorization error.
    pub fn get_authenticated_user(&self) -> Result<&MacroUserIdStr<'static>, AccessError> {
        match &self.auth {
            EntityAccessAuth::Authenticated(user) => Ok(user),
            EntityAccessAuth::Bot(_)
            | EntityAccessAuth::Unauthenticated
            | EntityAccessAuth::Internal => Err(AccessError::Unauthorized),
        }
    }

    /// Get the authenticated bot's canonical storage principal or return an authorization error.
    pub fn get_authenticated_bot(&self) -> Result<&BotIdStr<'static>, AccessError> {
        Ok(self.get_authenticated_bot_auth()?.bot_id_str())
    }

    /// Get the authenticated bot and receipt scope or return an authorization error.
    pub fn get_authenticated_bot_auth(&self) -> Result<&BotReceiptAuth, AccessError> {
        match &self.auth {
            EntityAccessAuth::Bot(bot_auth) => Ok(bot_auth),
            EntityAccessAuth::Authenticated(_)
            | EntityAccessAuth::Unauthenticated
            | EntityAccessAuth::Internal => Err(AccessError::Unauthorized),
        }
    }

    /// Returns the direct user or verified acting user represented by this receipt.
    pub fn acting_user_id(&self) -> Option<&MacroUserIdStr<'static>> {
        match &self.auth {
            EntityAccessAuth::Authenticated(user_id) => Some(user_id),
            EntityAccessAuth::Bot(bot_auth) => bot_auth.scope().acting_user_id(),
            EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => None,
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

    /// Dangerously generates an `EntityAccessReceipt` for an authenticated user
    /// without performing the underlying access check.
    ///
    /// **NOTE** This is intended for tests. It **DOES NOT** assert the
    /// existence of the item or that the user actually has the required
    /// permission.
    pub fn dangerously_assert_authenticated_user(
        user_id: MacroUserIdStr<'static>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> EntityAccessReceipt<T> {
        EntityAccessReceipt {
            auth: EntityAccessAuth::Authenticated(user_id),
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

    /// Dangerously generates an `EntityAccessReceipt` for an authenticated bot
    /// without performing the underlying access check.
    ///
    /// **NOTE** This is intended for tests. It **DOES NOT** assert the
    /// existence of the item or that the bot actually has the required
    /// permission.
    pub fn dangerously_assert_bot(
        bot_id: BotIdStr<'static>,
        scope: BotReceiptScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> EntityAccessReceipt<T> {
        EntityAccessReceipt {
            auth: EntityAccessAuth::Bot(BotReceiptAuth::new(bot_id, scope)),
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
///
/// The variants are the domain's failure vocabulary; causes never appear as
/// typed payloads. Where a cause exists (a database error, a failed lookup)
/// it travels inside a [`rootcause::Report`] attached to the variant, so it
/// is visible in logs but structurally opaque to domain logic.
#[derive(Debug, thiserror::Error)]
pub enum AccessError {
    /// User does not have access to the requested resource.
    #[error("User does not have access to the requested resource")]
    Unauthorized,

    /// User does not have access with a specific message.
    #[error("{0}")]
    UnauthorizedWithMessage(&'static str),

    /// Access could not be checked because a backing service failed
    /// transiently; retrying may succeed. The cause is attached.
    #[error("access check temporarily unavailable: {0}")]
    Unavailable(rootcause::Report),

    /// Bad request parameters.
    #[error("Bad request: {0}")]
    BadRequest(&'static str),

    /// Requested resource was not found.
    #[error("Not found: {0}")]
    NotFound(&'static str),

    /// Internal server error; retrying will not help. The cause is attached.
    #[error("Internal error: {0}")]
    Internal(rootcause::Report),
}

impl AccessError {
    /// Non-retryable internal failure with a short reason attached to the
    /// report, for sites that have no underlying cause to carry.
    pub fn internal(reason: &'static str) -> Self {
        Self::Internal(rootcause::report!(reason).into_dynamic())
    }
}
