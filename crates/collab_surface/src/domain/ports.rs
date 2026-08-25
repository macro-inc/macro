//! Ports (trait contracts) for the collab-surface domain.

use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt};
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use crate::domain::models::{CollabSurface, CollabSurfaceError};

/// Outbound persistence port for collab surfaces.
pub trait CollabSurfaceRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Insert a surface in `pending` state. Returns `false` (without error)
    /// when a row with this id already exists — live or soft-deleted — so
    /// concurrent ensures race safely.
    fn insert(
        &self,
        surface: &CollabSurface,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Fetch a surface by id. Soft-deleted surfaces read as absent.
    fn get(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<CollabSurface>, Self::Err>> + Send;

    /// All live surfaces attached to a parent entity.
    fn list_by_parent(
        &self,
        parent: &Entity<'_>,
    ) -> impl Future<Output = Result<Vec<CollabSurface>, Self::Err>> + Send;

    /// Flip a surface to `ready` after its sync-service session initialized.
    fn mark_ready(&self, id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Soft-delete a surface. Idempotent.
    fn soft_delete(&self, id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Outbound port that boots a surface's sync-service session from markdown.
///
/// Implementations convert the markdown to a Loro snapshot (an empty string
/// maps to the canonical blank-document snapshot) and store it as the
/// session's initial state. Initialization is one-shot per id on the
/// sync-service side.
#[cfg_attr(test, mockall::automock)]
pub trait SurfaceInitializer: Send + Sync + 'static {
    /// Initialize the sync-service session for `surface_id` with `markdown`.
    fn initialize(
        &self,
        surface_id: &str,
        markdown: &str,
    ) -> impl Future<Output = Result<(), CollabSurfaceError>> + Send;
}

/// The collab-surface use-cases, generic over the outbound ports.
pub trait CollabSurfaceService: Send + Sync + 'static {
    /// Idempotently ensure surface `id` exists, attached to the parent entity
    /// the receipt proves access to, with its sync-service session
    /// initialized. Returns only once the surface is `ready`:
    ///
    /// - missing → created with the caller-supplied id, initialized, `ready`.
    /// - exists (live) → parent must match the receipt's entity; a `pending`
    ///   row (an earlier ensure died or failed mid-init) has its
    ///   initialization retried.
    /// - soft-deleted → [`CollabSurfaceError::Gone`]; ids are never reused.
    ///
    /// Concurrent ensures for the same id converge: the insert is
    /// conflict-tolerant and the initializer treats an already-initialized
    /// session as success.
    fn ensure_surface(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
        initial_markdown: String,
    ) -> impl Future<Output = Result<CollabSurface, CollabSurfaceError>> + Send;

    /// Fetch a surface. The caller must already hold a receipt for the
    /// surface's parent (resolved by the inbound layer via
    /// [`CollabSurfaceService::get_parent`]).
    fn get_surface(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
    ) -> impl Future<Output = Result<CollabSurface, CollabSurfaceError>> + Send;

    /// The parent entity of a surface, for the inbound layer to mint a receipt
    /// against before any surface operation. `NotFound` for missing/deleted.
    fn get_parent(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Entity<'static>, CollabSurfaceError>> + Send;

    /// Mint a sync-service connection token for the surface, at the access
    /// level implied by the caller's permission on the parent entity.
    fn mint_token(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
    ) -> impl Future<Output = Result<DocumentPermissionToken, CollabSurfaceError>> + Send;

    /// Soft-delete a surface. Requires an edit-capable permission on the
    /// parent. The sync-service session is not reclaimed (documented gap
    /// shared with documents); deletion makes the surface unmintable, which
    /// cuts off all access.
    fn delete_surface(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), CollabSurfaceError>> + Send;
}
