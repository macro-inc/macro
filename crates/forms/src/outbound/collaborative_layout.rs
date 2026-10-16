//! Forms use the owning collaboration domain for their durable layout.

use std::sync::Arc;

use collab_surface::domain::models::{CollabSurfaceError, SurfaceUpdate};
use collab_surface::domain::ports::{FormIds, OwnedSurfaceService};
use model_entity::EntityType;
use uuid::Uuid;

use crate::domain::drafts::{FormDraftError, FormDraftStore};
use crate::domain::models::FormId;
use crate::domain::ports::FormsRepo;

/// Adapter over parent-owned surfaces. It never constructs another domain's
/// repository or imports its outbound implementation.
#[derive(Clone)]
pub struct SurfaceFormDrafts<Surfaces> {
    surfaces: Arc<Surfaces>,
}

impl<Surfaces> SurfaceFormDrafts<Surfaces> {
    /// Reuse the composition root's collaboration service.
    pub fn new(surfaces: Arc<Surfaces>) -> Self {
        Self { surfaces }
    }
}

fn failure(error: CollabSurfaceError) -> FormDraftError {
    FormDraftError::Unavailable(rootcause::Report::new(error).into_dynamic())
}

impl<Surfaces: OwnedSurfaceService> FormDraftStore for SurfaceFormDrafts<Surfaces> {
    async fn ensure(&self, id: FormId, snapshot: Vec<u8>) -> Result<(), FormDraftError> {
        self.surfaces
            .ensure_owned_surface_from_snapshot(
                EntityType::Form.with_entity_string(id.to_string()),
                id.into_uuid(),
                snapshot,
            )
            .await
            .map_err(failure)?;
        Ok(())
    }

    async fn snapshot(&self, id: FormId) -> Result<Vec<u8>, FormDraftError> {
        Ok(self
            .surfaces
            .owned_surface_snapshot(
                EntityType::Form.with_entity_string(id.to_string()),
                id.into_uuid(),
            )
            .await
            .map_err(failure)?
            .snapshot)
    }

    async fn update(
        &self,
        id: FormId,
        expected_revision: Vec<u8>,
        update: Vec<u8>,
    ) -> Result<(), FormDraftError> {
        match self
            .surfaces
            .update_owned_surface(
                EntityType::Form.with_entity_string(id.to_string()),
                id.into_uuid(),
                expected_revision,
                update,
            )
            .await
            .map_err(failure)?
        {
            SurfaceUpdate::Applied { .. } => Ok(()),
            SurfaceUpdate::Conflict => Err(FormDraftError::Conflict),
        }
    }

    async fn retire(&self, id: FormId) -> Result<(), FormDraftError> {
        self.surfaces
            .retire_surface(id.into_uuid())
            .await
            .map_err(failure)
    }
}

/// The forms domain's ids, as collab surfaces ask for them, read through
/// the forms repository port: a form's id is its surface's id, so the
/// public surface API never takes one.
pub struct RepositoryFormIds<Repository> {
    repository: Arc<Repository>,
}

impl<Repository> RepositoryFormIds<Repository> {
    /// Answer from the composition root's forms repository.
    pub fn new(repository: Arc<Repository>) -> Self {
        Self { repository }
    }
}

impl<Repository: FormsRepo> FormIds for RepositoryFormIds<Repository> {
    async fn is_form_id(&self, id: Uuid) -> Result<bool, rootcause::Report> {
        Ok(self
            .repository
            .form(FormId::from_uuid(id))
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?
            .is_some())
    }
}
