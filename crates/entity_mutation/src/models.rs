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
}

/// Safe error returned for one item in a batch mutation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntityMutationError {
    /// Machine-readable failure category.
    pub code: EntityMutationErrorCode,
    /// User-safe explanation of the failure.
    pub message: String,
}

impl EntityMutationError {
    /// Construct a mutation error from a category and user-safe message.
    pub fn new(code: EntityMutationErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Log an internal failure and return the generic user-safe error.
    pub fn internal(detail: &dyn std::fmt::Debug) -> Self {
        tracing::error!(error = ?detail, "unified entity mutation failed");
        Self::new(
            EntityMutationErrorCode::Internal(Sentinel(())),
            "entity mutation failed",
        )
    }

    /// Construct a not-found error.
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(EntityMutationErrorCode::NotFound(Sentinel(())), message)
    }

    /// Construct a forbidden error.
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(EntityMutationErrorCode::Forbidden(Sentinel(())), message)
    }

    /// Construct an invalid-input error.
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(EntityMutationErrorCode::InvalidInput(Sentinel(())), message)
    }

    /// Construct a state-conflict error.
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(EntityMutationErrorCode::Conflict(Sentinel(())), message)
    }
}

impl From<EntityMutationErrorCode> for EntityMutationError {
    fn from(code: EntityMutationErrorCode) -> Self {
        let message = match code {
            EntityMutationErrorCode::UnsupportedOperation(_) => {
                "operation is not supported for this entity"
            }
            EntityMutationErrorCode::InvalidInput(_) => "invalid entity mutation input",
            EntityMutationErrorCode::Forbidden(_) => "insufficient permission for entity mutation",
            EntityMutationErrorCode::NotFound(_) => "entity not found",
            EntityMutationErrorCode::Conflict(_) => {
                "entity mutation conflicts with current entity state"
            }
            EntityMutationErrorCode::Internal(_) => "entity mutation failed",
        };
        Self::new(code, message)
    }
}

/// Result for one requested entity in a batch mutation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntityMutationOutcome {
    /// Entity reference supplied by the caller.
    pub requested: Entity<'static>,
    /// Entity produced or updated by the operation. Duplicate operations use
    /// this field for the newly created entity.
    pub entity: Option<Entity<'static>>,
    /// Canonical records known to have changed as a consequence of the
    /// request. This includes affected containers and includes cascade
    /// descendants when the delegated domain service exposes their ids.
    pub affected_entities: Vec<Entity<'static>>,
    /// Per-item failure. A missing error denotes success.
    pub error: Option<EntityMutationError>,
}

impl EntityMutationOutcome {
    /// Build a successful outcome that changed only the requested entity.
    pub fn success(requested: Entity<'static>) -> Self {
        Self {
            entity: Some(requested.clone()),
            affected_entities: vec![requested.clone()],
            requested,
            error: None,
        }
    }

    /// Build a successful outcome with an explicit result and affected set.
    pub fn success_with(
        requested: Entity<'static>,
        entity: Option<Entity<'static>>,
        affected_entities: Vec<Entity<'static>>,
    ) -> Self {
        Self {
            requested,
            entity,
            affected_entities,
            error: None,
        }
    }

    /// Build a failed outcome.
    pub fn failure(requested: Entity<'static>, error: EntityMutationError) -> Self {
        Self {
            requested,
            entity: None,
            affected_entities: Vec::new(),
            error: Some(error),
        }
    }

    /// Build a standard unsupported-operation outcome.
    pub fn unsupported(requested: Entity<'static>, operation: &str) -> Self {
        let kind = requested.entity_type.to_string();
        Self::failure(
            requested,
            EntityMutationError::new(
                EntityMutationErrorCode::UnsupportedOperation(Sentinel(())),
                format!("{operation} is not supported for {kind} entities"),
            ),
        )
    }
}
