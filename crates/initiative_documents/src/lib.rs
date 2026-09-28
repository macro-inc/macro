//! Adapter that gives the initiative domain its description documents.

#![deny(missing_docs)]

use std::str::FromStr;

use documents_hex::domain::create::{
    DocumentCreator, MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument,
};
use documents_hex::domain::models::DocumentError;
use documents_hex::domain::ports::create::{DocumentBytesUploadPort, DocumentCreationService};
use documents_hex::domain::ports::markdown::MarkdownInitializationPort;
use documents_hex::domain::ports::mentions::DocumentMentionTrackingPort;
use documents_hex::domain::purge::DocumentPurgeService;
use initiative::domain::models::{DescriptionDocumentId, InitiativeError, NewDescriptionDocument};
use initiative::domain::ports::InitiativeDescriptionDocuments;

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
                owner,
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
