//! Ports (trait contracts) for the collab-surface domain.

use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt};
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use crate::domain::models::{CollabSurface, CollabSurfaceError, SurfaceSeed};

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

    /// Whether `id` belongs to a soft-deleted surface.
    fn is_deleted(&self, id: Uuid) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Outbound port onto the document id namespace, which surfaces share in
/// sync-service. The composition root implements it over macro_db_client's
/// `does_document_exist` helper, which owns reads of the documents table.
pub trait DocumentIds: Send + Sync + 'static {
    /// Whether `id` names a document, live or soft-deleted.
    fn is_document_id(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// Outbound port for a surface's sync-service session: boots it from
/// markdown, checks whether it exists, and reads it back.
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

    /// Whether a session for `surface_id` exists. Only asked for a new id,
    /// before its row is inserted. Sync-service answers yes as soon as a
    /// session knows its id (a client connected, say), not only once it is
    /// initialized: the conservative answer for an id nothing should use yet.
    fn session_exists(
        &self,
        surface_id: &str,
    ) -> impl Future<Output = Result<bool, CollabSurfaceError>> + Send;

    /// Read the session's current content as internal (lossless) markdown.
    fn read_markdown(
        &self,
        surface_id: &str,
    ) -> impl Future<Output = Result<String, CollabSurfaceError>> + Send;
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
    /// - the id names a document, or a new id already has a sync-service
    ///   session → [`CollabSurfaceError::IdReserved`], before any row is
    ///   written: a new surface only ever creates its own session.
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

    /// Mint a sync-service connection token for a `ready` surface, at the
    /// access level implied by the caller's permission on the parent entity.
    /// A surface whose id names a document is refused
    /// ([`CollabSurfaceError::IdReserved`]), whenever it was bound, unless
    /// its parent's domain adopted that document's session on purpose.
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

    /// Ensure a surface owned by another domain, which has already authorized
    /// the caller against `parent` (or is creating `parent` itself, so it may
    /// not exist yet). Same convergence rules as
    /// [`CollabSurfaceService::ensure_surface`], plus the choice of `seed`.
    /// For internal callers only; never expose it to a caller-chosen id.
    fn internal_ensure_surface(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        seed: SurfaceSeed,
    ) -> impl Future<Output = Result<CollabSurface, CollabSurfaceError>> + Send;

    /// Soft-delete a surface for the domain that owns it. Idempotent. For
    /// internal callers only.
    fn internal_delete_surface(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<(), CollabSurfaceError>> + Send;

    /// Read a ready surface's content as internal markdown for the domain that
    /// owns it. For internal callers only.
    fn internal_read_markdown(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<String, CollabSurfaceError>> + Send;
}
