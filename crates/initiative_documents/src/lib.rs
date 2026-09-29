//! Adapters that give the initiative domain its description storage: the description
//! document, and the collab surface that adopts the document's sync-service session.

#![deny(missing_docs)]

use std::str::FromStr;
use std::sync::Arc;

use collab_surface::domain::models::{CollabSurfaceError, SurfaceSeed};
use collab_surface::domain::ports::CollabSurfaceService;

use documents_hex::domain::create::{
    DocumentCreator, MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument,
};
use documents_hex::domain::models::DocumentError;
use documents_hex::domain::ports::create::{DocumentBytesUploadPort, DocumentCreationService};
use documents_hex::domain::ports::markdown::MarkdownInitializationPort;
use documents_hex::domain::ports::mentions::DocumentMentionTrackingPort;
use documents_hex::domain::purge::DocumentPurgeService;
use initiative::domain::models::{
    DescriptionDocumentId, DescriptionSurfaceId, InitiativeError, InitiativeId,
    NewDescriptionDocument,
};
use initiative::domain::ports::{InitiativeDescriptionDocuments, InitiativeDescriptionSurfaces};
use model_entity::EntityType;
use model_owner::CreationPrincipal;

#[cfg(test)]
mod test;

macro_rules! internal {
    ($error:expr) => {
        InitiativeError::Internal(rootcause::report!($error).into())
    };
}

/// Description document lifecycle composed from document-owned services.
pub struct InitiativeDescriptionDocumentsAdapter<Svc, MarkdownInit, BytesUpload, MentionTracker, P>
{
    creator: DocumentCreator<Svc, MarkdownInit, BytesUpload, MentionTracker>,
    purger: P,
}

impl<Svc, MarkdownInit, BytesUpload, MentionTracker, P>
    InitiativeDescriptionDocumentsAdapter<Svc, MarkdownInit, BytesUpload, MentionTracker, P>
{
    /// Compose creation and permanent cleanup from owning document services.
    pub fn new(
        creator: DocumentCreator<Svc, MarkdownInit, BytesUpload, MentionTracker>,
        purger: P,
    ) -> Self {
        Self { creator, purger }
    }
}

impl<Svc, MarkdownInit, BytesUpload, MentionTracker, P> InitiativeDescriptionDocuments
    for InitiativeDescriptionDocumentsAdapter<Svc, MarkdownInit, BytesUpload, MentionTracker, P>
where
    Svc: DocumentCreationService + Send + Sync + 'static,
    MarkdownInit: MarkdownInitializationPort + Send + Sync + 'static,
    BytesUpload: DocumentBytesUploadPort + Send + Sync + 'static,
    MentionTracker: DocumentMentionTrackingPort + Send + Sync + 'static,
    P: DocumentPurgeService,
{
    #[tracing::instrument(skip_all, err)]
    async fn create(
        &self,
        document: NewDescriptionDocument,
    ) -> Result<DescriptionDocumentId, InitiativeError> {
        let NewDescriptionDocument {
            owner,
            name,
            prefill_markdown,
            link_share,
        } = document;
        // Recents list the initiative. The editor opens this document by id.
        let metadata = NewDocumentMetadata::builder(name)
            .skip_history()
            .initial_link_share(link_share)
            .build();
        let created = self
            .creator
            .create_markdown_text(
                &CreationPrincipal::User(owner),
                NewMarkdownTextDocument {
                    metadata,
                    markdown: prefill_markdown,
                    subtype: MarkdownSubtype::InitiativeDescription,
                },
            )
            .await
            .map_err(map_document_error)?;
        let document_id = created.document_id();
        DescriptionDocumentId::from_str(document_id).map_err(|error| {
            InitiativeError::Internal(rootcause::report!(
                "created document {document_id} does not have a uuid id: {error}"
            ))
        })
    }

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
        other => internal!(other),
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
    #[tracing::instrument(skip(self), err)]
    async fn adopt(
        &self,
        document: DescriptionDocumentId,
        initiative: InitiativeId,
    ) -> Result<(), InitiativeError> {
        self.surfaces
            .internal_ensure_surface(
                EntityType::Initiative.with_entity_string(initiative.to_string()),
                document.adopting_surface().as_uuid(),
                SurfaceSeed::AdoptDocumentSession,
            )
            .await
            .map_err(map_surface_error)?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete(&self, id: DescriptionSurfaceId) -> Result<(), InitiativeError> {
        self.surfaces
            .internal_delete_surface(id.as_uuid())
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
        CollabSurfaceError::IdReserved => {
            InitiativeError::Conflict("the description surface id is already in use".to_string())
        }
        CollabSurfaceError::BadRequest(message) => InitiativeError::BadRequest(message),
        CollabSurfaceError::AccessDenied => InitiativeError::Unauthorized,
        error @ CollabSurfaceError::Internal(_) => internal!(error),
    }
}
