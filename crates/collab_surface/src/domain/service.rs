//! The collab-surface service implementation.

#[cfg(test)]
mod test;

use std::sync::Arc;

use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt};
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use crate::domain::models::{CollabSurface, CollabSurfaceError, SurfaceState};
use crate::domain::ports::{CollabSurfaceRepo, CollabSurfaceService, SurfaceInitializer};
use crate::domain::token::{access_level_for, encode_surface_token};

/// Upper bound on initial markdown, mirroring the lexical-service request cap.
const MAX_INITIAL_MARKDOWN_LEN: usize = 1_000_000;

/// Production implementation of [`CollabSurfaceService`].
pub struct CollabSurfaceServiceImpl<R, I> {
    repo: Arc<R>,
    initializer: Arc<I>,
    jwt_secret: String,
}

impl<R, I> CollabSurfaceServiceImpl<R, I> {
    /// Build the service from its ports and the sync-service JWT secret.
    pub fn new(repo: Arc<R>, initializer: Arc<I>, jwt_secret: String) -> Self {
        Self {
            repo,
            initializer,
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

impl<R, I> CollabSurfaceService for CollabSurfaceServiceImpl<R, I>
where
    R: CollabSurfaceRepo,
    I: SurfaceInitializer,
{
    #[tracing::instrument(err, skip(self, user_id, parent_receipt, initial_markdown))]
    async fn ensure_surface(
        &self,
        user_id: &MacroUserIdStr<'_>,
        parent_receipt: EntityAccessReceipt<AnyEntityPermission>,
        id: Uuid,
        initial_markdown: String,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        if initial_markdown.len() > MAX_INITIAL_MARKDOWN_LEN {
            return Err(CollabSurfaceError::BadRequest(format!(
                "initial markdown exceeds {MAX_INITIAL_MARKDOWN_LEN} bytes"
            )));
        }
        let parent = resolve_parent(user_id, &parent_receipt)?;

        // Fast path: the surface already exists. A `pending` row still gets
        // its initialization retried in `finish_init`.
        if let Some(existing) = self.get_optional(id).await? {
            verify_receipt_matches_parent(&existing, &parent)?;
            return self.finish_init(existing, &initial_markdown).await;
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
            // Lost a race with a concurrent ensure, or the id belongs to a
            // soft-deleted surface (which never comes back).
            let Some(existing) = self.get_optional(id).await? else {
                return Err(CollabSurfaceError::Gone);
            };
            verify_receipt_matches_parent(&existing, &surface.parent)?;
            return self.finish_init(existing, &initial_markdown).await;
        }

        self.finish_init(surface, &initial_markdown).await
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
}

impl<R, I> CollabSurfaceServiceImpl<R, I>
where
    R: CollabSurfaceRepo,
    I: SurfaceInitializer,
{
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

    /// Take a surface the caller may act on to `Ready`, (re)initializing its
    /// sync-service session when it is still `Pending`. The initializer treats
    /// an already-initialized session as success, so this is safe to run
    /// concurrently and after partial failures.
    async fn finish_init(
        &self,
        surface: CollabSurface,
        initial_markdown: &str,
    ) -> Result<CollabSurface, CollabSurfaceError> {
        if surface.state == SurfaceState::Ready {
            return Ok(surface);
        }

        self.initializer
            .initialize(&surface.id.to_string(), initial_markdown)
            .await?;

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
