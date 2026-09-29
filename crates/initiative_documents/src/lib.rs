//! Adapters that give the initiative domain its description storage: the collab surface
//! every initiative's description lives in, and the legacy description documents of
//! initiatives created before surfaces.

#![deny(missing_docs)]

use std::sync::Arc;

use collab_surface::domain::models::{CollabSurfaceError, SurfaceSeed};
use collab_surface::domain::ports::CollabSurfaceService;
use documents_hex::domain::models::DocumentError;
use documents_hex::domain::purge::DocumentPurgeService;
use initiative::domain::models::{
    DescriptionDocumentId, DescriptionSeed, DescriptionSurfaceId, InitiativeError, InitiativeId,
};
use initiative::domain::ports::{InitiativeDescriptionDocuments, InitiativeDescriptionSurfaces};
use model_entity::EntityType;

#[cfg(test)]
mod test;

/// Legacy description document cleanup composed from the document-owned purge service.
pub struct InitiativeDescriptionDocumentsAdapter<P> {
    purger: P,
}

impl<P> InitiativeDescriptionDocumentsAdapter<P> {
    /// Compose permanent cleanup from the owning document service.
    pub fn new(purger: P) -> Self {
        Self { purger }
    }
}

impl<P> InitiativeDescriptionDocuments for InitiativeDescriptionDocumentsAdapter<P>
where
    P: DocumentPurgeService,
{
    #[tracing::instrument(skip(self), err)]
    async fn purge(&self, id: DescriptionDocumentId) -> Result<(), InitiativeError> {
        self.purger
            .purge(id.as_uuid())
            .await
            .map_err(map_document_error)
    }
}

fn map_document_error(error: DocumentError) -> InitiativeError {
    match error {
        DocumentError::BadRequest(message) => InitiativeError::BadRequest(message),
        DocumentError::Conflict(message) => InitiativeError::Conflict(message),
        DocumentError::Unauthorized => InitiativeError::Unauthorized,
        other => InitiativeError::Internal(rootcause::report!(other).into()),
    }
}

/// Description surfaces composed from the collab-surface domain service. The initiative
/// domain has authorized every call, so this uses the service's internal entry points and
/// always names the initiative as the surface's parent.
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
    S: CollabSurfaceService,
{
    #[tracing::instrument(skip(self, seed), err)]
    async fn ensure(
        &self,
        id: DescriptionSurfaceId,
        initiative: InitiativeId,
        seed: DescriptionSeed,
    ) -> Result<(), InitiativeError> {
        let seed = surface_seed(id, seed)?;
        self.surfaces
            .internal_ensure_surface(
                EntityType::Initiative.with_entity_string(initiative.to_string()),
                id.as_uuid(),
                seed,
            )
            .await
            .map_err(map_surface_error)?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn read_markdown(&self, id: DescriptionSurfaceId) -> Result<String, InitiativeError> {
        self.surfaces
            .internal_read_markdown(id.as_uuid())
            .await
            .map_err(map_surface_error)
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete(&self, id: DescriptionSurfaceId) -> Result<(), InitiativeError> {
        self.surfaces
            .internal_delete_surface(id.as_uuid())
            .await
            .map_err(map_surface_error)
    }
}

/// A legacy document is adopted only as the surface with its own id: the surface id is the
/// sync-service session key, so any other id would bind an unrelated session.
fn surface_seed(
    id: DescriptionSurfaceId,
    seed: DescriptionSeed,
) -> Result<SurfaceSeed, InitiativeError> {
    match seed {
        DescriptionSeed::Markdown(markdown) => Ok(SurfaceSeed::Markdown(markdown)),
        DescriptionSeed::LegacyDocument(document) if document.adopting_surface() == id => {
            Ok(SurfaceSeed::AdoptDocumentSession)
        }
        DescriptionSeed::LegacyDocument(document) => Err(InitiativeError::Internal(
            rootcause::report!("surface {id} cannot adopt description document {document}"),
        )),
    }
}

fn map_surface_error(error: CollabSurfaceError) -> InitiativeError {
    match error {
        CollabSurfaceError::BadRequest(message) => InitiativeError::BadRequest(message),
        CollabSurfaceError::AccessDenied => InitiativeError::Unauthorized,
        other => InitiativeError::Internal(rootcause::report!(other).into()),
    }
}
