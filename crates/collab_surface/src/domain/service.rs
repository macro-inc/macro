//! The collab-surface service implementation.

#[cfg(test)]
mod test;

use std::sync::Arc;

use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt};
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_permissions::share_permission::access_level::AccessLevel;
use uuid::Uuid;

use crate::domain::models::{
    CollabSurface, CollabSurfaceError, SurfaceOwnership, SurfaceSnapshot, SurfaceState,
    SurfaceUpdate, surface_ownership,
};
use crate::domain::ports::{
    CollabSurfaceRepo, CollabSurfaceService, DocumentIds, OwnedSurfaceService, SurfaceInitializer,
};
use crate::domain::token::{
    access_level_for, encode_service_surface_token, encode_surface_token, surface_access_level,
};

/// Upper bound on initial markdown, mirroring the lexical-service request cap.
const MAX_INITIAL_MARKDOWN_LEN: usize = 1_000_000;

/// What a new surface's sync-service session starts from.
#[derive(Clone, Copy)]
enum InitialContent<'a> {
    /// Markdown, converted to a Loro snapshot by the initializer.
    Markdown(&'a str),
    /// An opaque Loro snapshot, stored as-is.
    Snapshot(&'a [u8]),
}

/// Whether the public API may create and delete surfaces under `parent`.
fn caller_owned(parent: &Entity<'_>) -> bool {
    surface_ownership(parent.entity_type) == Some(SurfaceOwnership::Callers)
}

/// Production implementation of [`CollabSurfaceService`].
pub struct CollabSurfaceServiceImpl<Repository, Initializer, Documents> {
    repo: Arc<Repository>,
    initializer: Arc<Initializer>,
    documents: Arc<Documents>,
    jwt_secret: String,
}

impl<Repository, Initializer, Documents>
    CollabSurfaceServiceImpl<Repository, Initializer, Documents>
{
    /// Build the service from its ports and the sync-service JWT secret.
    pub fn new(
        repo: Arc<Repository>,
        initializer: Arc<Initializer>,
        documents: Arc<Documents>,
        jwt_secret: String,
    ) -> Self {
        Self {
            repo,
            initializer,
            documents,
            jwt_secret,
        }
    }
}

/// The parent entity and caller identity a receipt proves.
///
/// The receipt is the only source of the parent — a caller cannot name an
/// entity it has not proven access to, because there is nowhere else to put
/// the id. The receipt must also have been minted for this caller, or one
/// user could act using another's receipt.
fn resolve_parent(
    user_id: &MacroUserIdStr<'_>,
    receipt: &EntityAccessReceipt<AnyEntityPermission>,
) -> Result<Entity<'static>, CollabSurfaceError> {
    let receipt_user = receipt
        .get_authenticated_user()
        .map_err(|_| CollabSurfaceError::AccessDenied)?;
    if receipt_user.as_ref() != user_id.as_ref() {
        return Err(CollabSurfaceError::AccessDenied);
    }
    let entity = receipt.entity();
    Ok(entity
        .entity_type
        .with_entity_string(entity.entity_id.to_string()))
}

/// Surface ids are chosen by the caller, so the public API only takes random
/// ones (UUID v4 or v7).
fn is_random_id(id: Uuid) -> bool {
    matches!(
        id.get_version(),
        Some(uuid::Version::Random | uuid::Version::SortRand)
    )
}

/// Verify a receipt (already minted against the surface's parent by the
/// inbound layer) actually names that parent. Defense in depth: the inbound
/// layer resolves the parent via [`CollabSurfaceService::get_parent`], so a
/// mismatch means a coding error, not a malicious caller — but the check makes
/// the invariant unskippable.
fn verify_receipt_matches_parent(
    surface: &CollabSurface,
    parent: &Entity<'static>,
) -> Result<(), CollabSurfaceError> {
    if surface.parent.entity_type != parent.entity_type
        || surface.parent.entity_id != parent.entity_id
    {
        return Err(CollabSurfaceError::AccessDenied);
    }
    Ok(())
}

impl<Repository, Initializer, Documents> CollabSurfaceService
    for CollabSurfaceServiceImpl<Repository, Initializer, Documents>
where
    Repository: CollabSurfaceRepo,
    Initializer: SurfaceInitializer,
    Documents: DocumentIds,
{
    #[tracing::instrument(err, skip(self, user_id, parent_receipt, initial_markdown))]
    async fn ensure_surface(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
        initial_markdown: String,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        let parent = resolve_parent(user_id, &parent_receipt)?;
        if !caller_owned(&parent) {
            return Err(CollabSurfaceError::AccessDenied);
        }
        self.ensure_bound(parent, id, InitialContent::Markdown(&initial_markdown))
            .await
    }

    #[tracing::instrument(err, skip(self, user_id, parent_receipt))]
    async fn get_surface(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        let parent = resolve_parent(user_id, &parent_receipt)?;
        let surface = self.get_live(id).await?;
        verify_receipt_matches_parent(&surface, &parent)?;
        Ok(surface)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_parent(&self, id: Uuid) -> Result<Entity<'static>, CollabSurfaceError> {
        Ok(self.get_live(id).await?.parent)
    }

    #[tracing::instrument(err, skip(self, user_id, parent_receipt))]
    async fn mint_token(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
    ) -> Result<DocumentPermissionToken, CollabSurfaceError> {
        let parent = resolve_parent(user_id, &parent_receipt)?;
        let surface = self.get_live(id).await?;
        verify_receipt_matches_parent(&surface, &parent)?;
        // A pending row has not proven that its session is the surface's own
        // (initialization failed or never ran), so it is not connectable.
        if surface.state != SurfaceState::Ready {
            return Err(CollabSurfaceError::NotReady);
        }
        // Checked on every mint, not only at creation, so a surface whose id
        // names a document never connects to it, however it was bound.
        self.refuse_document_id(surface.id).await?;

        let access_level =
            surface_access_level(parent.entity_type, parent_receipt.entity_permission())?;
        encode_surface_token(
            parent_receipt
                .get_authenticated_user()
                .map_err(|_| CollabSurfaceError::AccessDenied)?
                .clone(),
            surface.id.to_string(),
            access_level,
            &self.jwt_secret,
        )
    }

    #[tracing::instrument(err, skip(self, user_id, parent_receipt))]
    async fn delete_surface(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
    ) -> Result<(), CollabSurfaceError> {
        let parent = resolve_parent(user_id, &parent_receipt)?;
        let surface = self.get_live(id).await?;
        verify_receipt_matches_parent(&surface, &parent)?;
        // A deleted id never comes back, so a surface its parent's domain owns
        // (e.g. a project description) is retired only by that domain.
        if !caller_owned(&parent) {
            return Err(CollabSurfaceError::AccessDenied);
        }

        // Deletion requires an edit-capable permission on the parent; there is
        // no per-surface owner. `access_level_for` already maps channel
        // membership to Edit and view-only presences to View.
        let level = access_level_for(parent_receipt.entity_permission())?;
        if level < AccessLevel::Edit {
            return Err(CollabSurfaceError::AccessDenied);
        }

        self.repo
            .soft_delete(id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Ok(())
    }
}

impl<Repository, Initializer, Documents> OwnedSurfaceService
    for CollabSurfaceServiceImpl<Repository, Initializer, Documents>
where
    Repository: CollabSurfaceRepo,
    Initializer: SurfaceInitializer,
    Documents: DocumentIds,
{
    #[tracing::instrument(err, skip(self, initial_markdown))]
    async fn ensure_owned_surface(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        initial_markdown: String,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        self.ensure_bound(parent, id, InitialContent::Markdown(&initial_markdown))
            .await
    }

    #[tracing::instrument(err, skip(self, snapshot), fields(snapshot_len = snapshot.len()))]
    async fn ensure_owned_surface_from_snapshot(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        snapshot: Vec<u8>,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        self.ensure_bound(parent, id, InitialContent::Snapshot(&snapshot))
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn owned_surface_markdown(&self, id: Uuid) -> Result<Option<String>, CollabSurfaceError> {
        match self.get_optional(id).await? {
            Some(surface) if surface.state == SurfaceState::Ready => {
                Ok(Some(self.initializer.markdown(&id.to_string()).await?))
            }
            _ => Ok(None),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn owned_surface_snapshot(
        &self,
        parent: Entity<'static>,
        id: Uuid,
    ) -> Result<SurfaceSnapshot, CollabSurfaceError> {
        let surface = self.ready_owned_surface(&parent, id).await?;
        let session_id = surface.id.to_string();
        let token =
            encode_service_surface_token(session_id.clone(), AccessLevel::View, &self.jwt_secret)?;
        self.initializer.snapshot(&session_id, &token).await
    }

    #[tracing::instrument(
        err,
        skip(self, expected_revision, update),
        fields(update_len = update.len())
    )]
    async fn update_owned_surface(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        expected_revision: Vec<u8>,
        update: Vec<u8>,
    ) -> Result<SurfaceUpdate, CollabSurfaceError> {
        let surface = self.ready_owned_surface(&parent, id).await?;
        let session_id = surface.id.to_string();
        let token =
            encode_service_surface_token(session_id.clone(), AccessLevel::Edit, &self.jwt_secret)?;
        self.initializer
            .update(&session_id, &token, &expected_revision, &update)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn retire_surface(&self, id: Uuid) -> Result<(), CollabSurfaceError> {
        self.repo
            .soft_delete(id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Ok(())
    }
}

impl<Repository, Initializer, Documents>
    CollabSurfaceServiceImpl<Repository, Initializer, Documents>
where
    Repository: CollabSurfaceRepo,
    Initializer: SurfaceInitializer,
    Documents: DocumentIds,
{
    /// Load-or-create surface `id` bound to `parent`, returning once it is
    /// `ready`. See [`CollabSurfaceService::ensure_surface`] for the rules.
    async fn ensure_bound(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        initial_content: InitialContent<'_>,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        if !is_random_id(id) {
            return Err(CollabSurfaceError::BadRequest(
                "surface ids must be random UUIDs".to_string(),
            ));
        }
        match initial_content {
            InitialContent::Markdown(markdown) if markdown.len() > MAX_INITIAL_MARKDOWN_LEN => {
                return Err(CollabSurfaceError::BadRequest(format!(
                    "initial markdown exceeds {MAX_INITIAL_MARKDOWN_LEN} bytes"
                )));
            }
            InitialContent::Snapshot([]) => {
                return Err(CollabSurfaceError::BadRequest(
                    "initial snapshot is empty".to_string(),
                ));
            }
            InitialContent::Markdown(_) | InitialContent::Snapshot(_) => {}
        }

        // Fast path: the surface already exists. A `pending` row still gets
        // its initialization retried in `finish_init`.
        if let Some(existing) = self.get_optional(id).await? {
            verify_receipt_matches_parent(&existing, &parent)?;
            if existing.state == SurfaceState::Pending {
                // A document may have taken the id since the row was written.
                self.refuse_document_id(id).await?;
            }
            return self.finish_init(existing, initial_content).await;
        }

        // A new surface creates its own session, so its id must be free in the
        // namespace surfaces share with documents: no document and no session
        // yet. Checked before inserting, so a refusal leaves no row behind.
        self.refuse_taken_id(id).await?;

        let now = chrono::Utc::now();
        let surface = CollabSurface {
            id,
            parent,
            state: SurfaceState::Pending,
            created_at: now,
            updated_at: now,
        };

        let inserted = self
            .repo
            .insert(&surface)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

        if !inserted {
            // Lost a race with a concurrent ensure (which passed the same
            // checks), or the id belongs to a soft-deleted surface (which never
            // comes back).
            let Some(existing) = self.get_optional(id).await? else {
                return Err(CollabSurfaceError::Gone);
            };
            verify_receipt_matches_parent(&existing, &surface.parent)?;
            return self.finish_init(existing, initial_content).await;
        }

        self.finish_init(surface, initial_content).await
    }

    /// The ready surface `id` under `parent`, for the domain that owns it to
    /// read or write its state. Nothing here creates or initializes a surface.
    async fn ready_owned_surface(
        &self,
        parent: &Entity<'static>,
        id: Uuid,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        if surface_ownership(parent.entity_type) != Some(SurfaceOwnership::ParentDomain) {
            return Err(CollabSurfaceError::AccessDenied);
        }
        let surface = self.get_live(id).await?;
        verify_receipt_matches_parent(&surface, parent)?;
        if surface.state != SurfaceState::Ready {
            return Err(CollabSurfaceError::NotReady);
        }
        self.refuse_document_id(surface.id).await?;
        Ok(surface)
    }

    /// Fetch a live (non-deleted) surface or `NotFound`.
    async fn get_live(&self, id: Uuid) -> Result<CollabSurface, CollabSurfaceError> {
        self.get_optional(id)
            .await?
            .ok_or(CollabSurfaceError::NotFound)
    }

    /// Fetch a live (non-deleted) surface, absent as `None`.
    async fn get_optional(&self, id: Uuid) -> Result<Option<CollabSurface>, CollabSurfaceError> {
        Ok(self
            .repo
            .get(id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?)
    }

    /// Refuse an id that names a document. Surfaces share the document
    /// namespace in sync-service, so a surface never uses a document's id.
    async fn refuse_document_id(&self, id: Uuid) -> Result<(), CollabSurfaceError> {
        if self.documents.is_document_id(id).await? {
            return Err(CollabSurfaceError::IdReserved);
        }
        Ok(())
    }

    /// Refuse a new id that names a document or already has a sync-service
    /// session: the initializer would take that session as this surface's. A
    /// deleted surface keeps its session, so its id is `Gone` rather than
    /// reserved; that is only looked up once the check fires.
    async fn refuse_taken_id(&self, id: Uuid) -> Result<(), CollabSurfaceError> {
        let session_id = id.to_string();
        let (names_document, has_session) = tokio::try_join!(
            async { Ok::<_, CollabSurfaceError>(self.documents.is_document_id(id).await?) },
            self.initializer.session_exists(&session_id),
        )?;
        if !(names_document || has_session) {
            return Ok(());
        }
        let deleted = self
            .repo
            .is_deleted(id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Err(if deleted {
            CollabSurfaceError::Gone
        } else {
            CollabSurfaceError::IdReserved
        })
    }

    /// Take a surface the caller may act on to `Ready`, (re)initializing its
    /// sync-service session when it is still `Pending`. The initializer treats
    /// an already-initialized session as success, so this is safe to run
    /// concurrently and after partial failures: a pending row whose session
    /// was initialized before `mark_ready` failed heals here.
    async fn finish_init(
        &self,
        surface: CollabSurface,
        initial_content: InitialContent<'_>,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        if surface.state == SurfaceState::Ready {
            return Ok(surface);
        }

        let session_id = surface.id.to_string();
        match initial_content {
            InitialContent::Markdown(markdown) => {
                self.initializer.initialize(&session_id, markdown).await?
            }
            InitialContent::Snapshot(snapshot) => {
                self.initializer
                    .initialize_from_snapshot(&session_id, snapshot)
                    .await?
            }
        }

        self.repo
            .mark_ready(surface.id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

        Ok(CollabSurface {
            state: SurfaceState::Ready,
            ..surface
        })
    }
}
