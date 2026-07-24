//! Per-capability mutation traits implemented by each entity domain.
//!
//! These traits push unification down into the domain crates: each crate
//! implements the capabilities that make sense for its entity kind and owns
//! the mapping from the unified vocabulary onto its own service methods,
//! preconditions, and errors. The composition layer (the DSS entity mutation
//! service) stays a thin router: it resolves access receipts, enforces the
//! batch contract, and dispatches each item to the owning domain's impl.
//!
//! Every trait declares its required access level as an associated
//! [`RequiredPermission`] type, so each entity kind's permission requirement
//! lives with its implementation and the router resolves receipts
//! generically. Implementations return the additional records they affected
//! (containers, cascade descendants); the router attributes outcomes to the
//! requested entity.

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, RequiredPermission};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;

use crate::EntityMutationErrorCode;

/// Rename an entity's user-visible display name.
pub trait RenameEntity {
    /// Access requirement for renaming this entity kind.
    type Receipt: RequiredPermission;

    /// Rename the entity, returning any additionally affected records.
    fn rename_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, EntityMutationErrorCode>> + Send;
}

/// The payload to move an entity
pub enum MoveEntityRequest<R: RequiredPermission> {
    /// we are moving the entity to "root" i.e. not a project
    MoveToRoot {
        /// the entity to move
        entity: Entity<'static>,
        /// the access to the entity
        receipt: EntityAccessReceipt<R>,
    },
    /// we are moving the entity to a project
    MoveToProject {
        /// the entity to move
        entity: Entity<'static>,
        /// the access to the entity
        receipt: EntityAccessReceipt<R>,
        /// the project id
        project_id: String,
        /// the access to the project
        project_receipt: EntityAccessReceipt<EditAccessLevel>,
    },
}

/// Move an entity into a project, or to the root.
pub trait MoveEntity {
    /// Access requirement for moving this entity kind.
    type Receipt: RequiredPermission;

    /// Move the entity. `project_id` of `None` means the root; the router
    /// has already validated edit access to the target project and passes
    /// the receipt along for domains that consume it.
    fn move_entity(
        &self,
        req: MoveEntityRequest<Self::Receipt>,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, EntityMutationErrorCode>> + Send;
}

/// Update an entity's public and channel share policy.
pub trait UpdateEntitySharePolicy {
    /// Access requirement for changing this entity kind's share policy.
    type Receipt: RequiredPermission;

    /// Apply the share-policy update, returning affected records.
    fn update_share_policy(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        policy: UpdateSharePermissionRequestV2,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, EntityMutationErrorCode>> + Send;
}

/// Soft-delete an entity with a reversible trash lifecycle.
pub trait TrashEntity {
    /// Access requirement for trashing this entity kind.
    type Receipt: RequiredPermission;

    /// Trash the entity, returning affected records (containers, cascades).
    fn trash_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, EntityMutationErrorCode>> + Send;
}

/// Restore a reversibly deleted entity.
pub trait RestoreEntity {
    /// Access requirement for restoring this entity kind.
    type Receipt: RequiredPermission;

    /// Restore the entity, returning affected records.
    fn restore_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, EntityMutationErrorCode>> + Send;
}

/// Irreversibly delete an entity.
pub trait DeleteEntityPermanently {
    /// Access requirement for permanently deleting this entity kind.
    type Receipt: RequiredPermission;

    /// Permanently delete the entity, returning affected records.
    fn delete_entity_permanently(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, EntityMutationErrorCode>> + Send;
}

/// Duplicate an entity.
pub trait DuplicateEntity {
    /// Access requirement for duplicating this entity kind.
    type Receipt: RequiredPermission;

    /// Duplicate the entity, returning the newly created entity.
    fn duplicate_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        user_id: MacroUserIdStr<'static>,
        display_name: Option<String>,
    ) -> impl Future<Output = Result<Entity<'static>, EntityMutationErrorCode>> + Send;
}
