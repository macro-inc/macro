//! Forms use the owning collaboration domain for their durable layout.

use std::sync::Arc;

use collab_surface::domain::models::{CollabSurfaceError, SurfaceUpdate};
use collab_surface::domain::ports::OwnedSurfaceService;
use model_entity::EntityType;

use crate::domain::drafts::{FormDraftError, FormDraftStore};
use crate::domain::models::FormId;

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
