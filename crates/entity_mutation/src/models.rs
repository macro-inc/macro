use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;

/// Authenticated actor performing an entity mutation.
#[derive(Clone, Debug)]
pub struct EntityMutationActor {
    /// Stable Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// Organization id attached to the authenticated request, when present.
    pub organization_id: Option<i64>,
}

/// Request to update an entity's display name.
#[derive(Clone, Debug)]
pub struct RenameEntityRequest {
    /// Entity to rename.
    pub entity: Entity<'static>,
    /// New user-visible display name.
    pub display_name: String,
}

/// Request to move an entity into or out of a project.
#[derive(Clone, Debug)]
pub struct MoveEntityRequest {
    /// Entity to move.
    pub entity: Entity<'static>,
    /// Destination project id, or `None` to move the entity to the root.
    pub project_id: Option<String>,
}

/// Request to duplicate an entity.
#[derive(Clone, Debug)]
pub struct DuplicateEntityRequest {
    /// Source entity to duplicate.
    pub entity: Entity<'static>,
    /// Optional display name for the new entity.
    pub display_name: Option<String>,
}

/// Request to update an entity's public and channel share policy.
#[derive(Clone, Debug)]
pub struct UpdateEntitySharePolicyRequest {
    /// Entity whose share policy should change.
    pub entity: Entity<'static>,
    /// Shared permission update used by documents, projects, chats, email
    /// threads, and calls.
    pub policy: UpdateSharePermissionRequestV2,
}

/// Unit struct with private constructor
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sentinel(());

/// Stable machine-readable mutation failure category.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntityMutationErrorCode {
    /// The operation does not apply to this entity kind.
    UnsupportedOperation(Sentinel),
    /// The request is syntactically valid but violates a domain constraint.
    InvalidInput(Sentinel),
    /// The actor is authenticated but lacks the required capability.
    Forbidden(Sentinel),
    /// The referenced entity does not exist.
    NotFound(Sentinel),
    /// The requested mutation conflicts with current entity state.
    Conflict(Sentinel),
    /// The mutation failed for an internal reason.
    Internal(Sentinel),
}

impl EntityMutationErrorCode {
    /// Log an internal failure and return the generic user-safe error.
    ///
    /// Callers run inside a per-item tracing span carrying the operation and
    /// entity fields, so the log line stays attributable.
    #[tracing::instrument(ret)]
    pub fn internal<C, O, T>(err: rootcause::Report<C, O, T>) -> Self {
        EntityMutationErrorCode::Internal(Sentinel(()))
    }

    /// Construct a not-found error.
    #[tracing::instrument(ret)]
    pub fn not_found<C, O, T>(err: rootcause::Report<C, O, T>) -> Self {
        EntityMutationErrorCode::NotFound(Sentinel(()))
    }

    /// Construct a forbidden error.
    #[tracing::instrument(ret)]
    pub fn forbidden<C, O, T>(err: rootcause::Report<C, O, T>) -> Self {
        EntityMutationErrorCode::Forbidden(Sentinel(()))
    }

    /// Construct an invalid-input error.
    #[tracing::instrument(ret)]
    pub fn invalid<C, O, T>(err: rootcause::Report<C, O, T>) -> Self {
        EntityMutationErrorCode::InvalidInput(Sentinel(()))
    }

    /// Construct a state-conflict error.
    #[tracing::instrument(ret)]
    pub fn conflict<C, O, T>(err: rootcause::Report<C, O, T>) -> Self {
        EntityMutationErrorCode::Conflict(Sentinel(()))
    }

    /// Construct a state-conflict error.
    #[tracing::instrument(ret)]
    pub fn unsupported<C, O, T>(err: rootcause::Report<C, O, T>) -> Self {
        EntityMutationErrorCode::UnsupportedOperation(Sentinel(()))
    }
}

/// One ordered cache-visible consequence of an entity mutation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EntityMutationEffect {
    /// The entity still exists and its current Soup representation must be refreshed.
    Updated(Entity<'static>),
    /// The entity is no longer visible and its normalized record must be removed.
    Deleted(Entity<'static>),
}

impl EntityMutationEffect {
    /// Construct an updated-entity effect.
    pub fn updated(entity: Entity<'static>) -> Self {
        Self::Updated(entity)
    }

    /// Construct a deleted-entity effect.
    pub fn deleted(entity: Entity<'static>) -> Self {
        Self::Deleted(entity)
    }

    /// Return the canonical entity carried by this effect.
    pub fn entity(&self) -> &Entity<'static> {
        match self {
            Self::Updated(entity) | Self::Deleted(entity) => entity,
        }
    }
}

/// Successful mutation outcome with effects in application order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntityMutationSuccess {
    /// Ordered cache effects produced by the mutation.
    pub effects: Vec<EntityMutationEffect>,
}
