//! The collab-surface service implementation.

#[cfg(test)]
mod test;

use std::sync::Arc;

use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt};
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use crate::domain::models::{
    CollabSurface, CollabSurfaceError, SurfaceSeed, SurfaceState, owned_by_parent_domain,
};
use crate::domain::ports::{
    CollabSurfaceRepo, CollabSurfaceService, DocumentIds, SurfaceInitializer,
};
use crate::domain::token::{access_level_for, encode_surface_token};

/// Upper bound on initial markdown, mirroring the lexical-service request cap.
const MAX_INITIAL_MARKDOWN_LEN: usize = 1_000_000;

/// Production implementation of [`CollabSurfaceService`].
pub struct CollabSurfaceServiceImpl<R, I, D> {
    repo: Arc<R>,
    initializer: Arc<I>,
    documents: Arc<D>,
    jwt_secret: String,
}

impl<R, I, D> CollabSurfaceServiceImpl<R, I, D> {
    /// Build the service from its ports and the sync-service JWT secret.
    pub fn new(repo: Arc<R>, initializer: Arc<I>, documents: Arc<D>, jwt_secret: String) -> Self {
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

impl<R, I, D> CollabSurfaceService for CollabSurfaceServiceImpl<R, I, D>
where
    R: CollabSurfaceRepo,
    I: SurfaceInitializer,
    D: DocumentIds,
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
        if owned_by_parent_domain(parent.entity_type) {
            return Err(CollabSurfaceError::AccessDenied);
        }
        self.ensure_bound(parent, id, SurfaceSeed::Markdown(initial_markdown))
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
        // names a document never connects to it, however it was bound. Only
        // a parent's own domain binds its surfaces to a document on purpose.
        if !owned_by_parent_domain(surface.parent.entity_type) {
            self.refuse_document_id(surface.id).await?;
        }

        let access_level = access_level_for(parent_receipt.entity_permission())?;
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
        if owned_by_parent_domain(parent.entity_type) {
            return Err(CollabSurfaceError::AccessDenied);
        }

        // Deletion requires an edit-capable permission on the parent; there is
        // no per-surface owner. `access_level_for` already maps channel
        // membership to Edit and view-only presences to View.
        let level = access_level_for(parent_receipt.entity_permission())?;
        if level < models_permissions::share_permission::access_level::AccessLevel::Edit {
            return Err(CollabSurfaceError::AccessDenied);
        }

        self.repo
            .soft_delete(id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, seed))]
    async fn internal_ensure_surface(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        seed: SurfaceSeed,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        self.ensure_bound(parent, id, seed).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn internal_delete_surface(&self, id: Uuid) -> Result<(), CollabSurfaceError> {
        self.repo
            .soft_delete(id)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Ok(())
    }
}

impl<R, I, D> CollabSurfaceServiceImpl<R, I, D>
where
    R: CollabSurfaceRepo,
    I: SurfaceInitializer,
    D: DocumentIds,
{
    /// Load-or-create surface `id` bound to `parent`, returning once it is
    /// `ready`. See [`CollabSurfaceService::ensure_surface`] for the rules.
    async fn ensure_bound(
        &self,
        parent: Entity<'static>,
        id: Uuid,
        seed: SurfaceSeed,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        if let SurfaceSeed::Markdown(markdown) = &seed
            && markdown.len() > MAX_INITIAL_MARKDOWN_LEN
        {
            return Err(CollabSurfaceError::BadRequest(format!(
                "initial markdown exceeds {MAX_INITIAL_MARKDOWN_LEN} bytes"
            )));
        }

        // Only the owning domain adopts a document's session; any other seed
        // never uses a document's id.
        let own_session = matches!(seed, SurfaceSeed::Markdown(_));

        // Fast path: the surface already exists. A `pending` row still gets
        // its initialization retried.
        if let Some(existing) = self.get_optional(id).await? {
            verify_receipt_matches_parent(&existing, &parent)?;
            if own_session && existing.state == SurfaceState::Pending {
                // A document may have taken the id since the row was written.
                self.refuse_document_id(id).await?;
            }
            return self.finish_init(existing, &seed).await;
        }

        // A new surface creates its own session, so its id must be free in the
        // namespace surfaces share with documents: no document and no session
        // yet. Checked before inserting, so a refusal leaves no row behind.
        if own_session {
            self.refuse_taken_id(id).await?;
        }

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
            return self.finish_init(existing, &seed).await;
        }

        self.finish_init(surface, &seed).await
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
    /// namespace in sync-service, so a surface never uses a document's id
    /// unless its parent's domain adopts that document's session.
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

    /// Take a surface the caller may act on to `Ready`. A markdown seed
    /// (re)initializes a `Pending` session; the initializer treats an
    /// already-initialized session as success, so this is safe to run
    /// concurrently and after partial failures (a pending row whose session
    /// was initialized before `mark_ready` failed heals here). An adoption
    /// never initializes: it waits for the document's own session, and stays
    /// `Pending` until then.
    async fn finish_init(
        &self,
        surface: CollabSurface,
        seed: &SurfaceSeed,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        if surface.state == SurfaceState::Ready {
            return Ok(surface);
        }

        let session_id = surface.id.to_string();
        match seed {
            SurfaceSeed::Markdown(markdown) => {
                self.initializer.initialize(&session_id, markdown).await?;
            }
            SurfaceSeed::AdoptDocumentSession => {
                if !self.initializer.await_session(&session_id).await? {
                    return Err(CollabSurfaceError::NotReady);
                }
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
