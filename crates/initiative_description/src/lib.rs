//! Adapter that gives the initiative domain its description storage: a collab surface
//! with the initiative's id, parented by the initiative.

#![deny(missing_docs)]

use std::sync::Arc;

use collab_surface::domain::models::CollabSurfaceError;
use collab_surface::domain::ports::OwnedSurfaceService;
use initiative::domain::models::{InitiativeError, InitiativeId};
use initiative::domain::ports::InitiativeDescriptionSurfaces;
use model_entity::EntityType;

#[cfg(test)]
mod test;

/// Description surfaces composed from the collab-surface domain service. The initiative
/// domain owns these surfaces and has authorized every call; the initiative is always the
/// surface's parent.
pub struct InitiativeDescriptionSurfacesAdapter<S> {
    surfaces: Arc<S>,
}

impl<S> InitiativeDescriptionSurfacesAdapter<S> {
    /// Compose description surfaces from the shared collab-surface service.
    pub fn new(surfaces: Arc<S>) -> Self {
        Self { surfaces }
    }
}

impl<S> InitiativeDescriptionSurfaces for InitiativeDescriptionSurfacesAdapter<S>
where
    S: OwnedSurfaceService,
{
    #[tracing::instrument(skip(self, markdown), err)]
    async fn ensure(
        &self,
        initiative: InitiativeId,
        markdown: String,
    ) -> Result<(), InitiativeError> {
        self.surfaces
            .ensure_owned_surface(
                EntityType::Initiative.with_entity_string(initiative.to_string()),
                initiative.as_uuid(),
                markdown,
            )
            .await
            .map_err(map_surface_error)?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn read(&self, initiative: InitiativeId) -> Result<String, InitiativeError> {
        Ok(self
            .surfaces
            .owned_surface_markdown(initiative.as_uuid())
            .await
            .map_err(map_surface_error)?
            .unwrap_or_default())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete(&self, initiative: InitiativeId) -> Result<(), InitiativeError> {
        self.surfaces
            .retire_surface(initiative.as_uuid())
            .await
            .map_err(map_surface_error)
    }
}

/// Expected surface states are client errors; only unexpected failures are internal.
fn map_surface_error(error: CollabSurfaceError) -> InitiativeError {
    match error {
        CollabSurfaceError::NotFound
        | CollabSurfaceError::ParentNotFound
        | CollabSurfaceError::Gone => InitiativeError::NotFound,
        CollabSurfaceError::NotReady => InitiativeError::Conflict(
            "the project description is still being prepared; try again shortly".to_string(),
        ),
        CollabSurfaceError::BadRequest(message) => InitiativeError::BadRequest(message),
        CollabSurfaceError::AccessDenied => InitiativeError::Unauthorized,
        // An initiative id never names a document or another session.
        error @ (CollabSurfaceError::IdReserved | CollabSurfaceError::Internal(_)) => {
            InitiativeError::Internal(rootcause::report!(error).into())
        }
    }
}
