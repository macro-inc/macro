//! Adapter that gives the initiative domain its description documents.

use std::str::FromStr;
use std::sync::Arc;

use documents_hex::domain::create::{
    DocumentCreator, MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument,
};
use documents_hex::domain::models::DocumentError;
use documents_hex::domain::ports::create::{DocumentBytesUploadPort, DocumentCreationService};
use documents_hex::domain::ports::markdown::MarkdownInitializationPort;
use documents_hex::domain::ports::mentions::DocumentMentionTrackingPort;
use initiative::domain::models::{DescriptionDocumentId, InitiativeError, NewDescriptionDocument};
use initiative::domain::ports::InitiativeDescriptionDocuments;
use macro_event_broker::MacroEventBroker;
use sqlx::PgPool;

use crate::service::document_event_publisher::publish_document_purged_event;

macro_rules! internal {
    ($error:expr) => {
        InitiativeError::Internal(rootcause::report!($error).into())
    };
}

pub struct InitiativeDescriptionDocumentsAdapter<Svc, MarkdownInit, BytesUpload, MentionTracker, B>
{
    creator: DocumentCreator<Svc, MarkdownInit, BytesUpload, MentionTracker>,
    db: PgPool,
    sqs: Arc<sqs_client::SQS>,
    event_broker: B,
}

impl<Svc, MarkdownInit, BytesUpload, MentionTracker, B>
    InitiativeDescriptionDocumentsAdapter<Svc, MarkdownInit, BytesUpload, MentionTracker, B>
{
    pub fn new(
        creator: DocumentCreator<Svc, MarkdownInit, BytesUpload, MentionTracker>,
        db: PgPool,
        sqs: Arc<sqs_client::SQS>,
        event_broker: B,
    ) -> Self {
        Self {
            creator,
            db,
            sqs,
            event_broker,
        }
    }
}

impl<Svc, MarkdownInit, BytesUpload, MentionTracker, B> InitiativeDescriptionDocuments
    for InitiativeDescriptionDocumentsAdapter<Svc, MarkdownInit, BytesUpload, MentionTracker, B>
where
    Svc: DocumentCreationService + Send + Sync + 'static,
    MarkdownInit: MarkdownInitializationPort + Send + Sync + 'static,
    BytesUpload: DocumentBytesUploadPort + Send + Sync + 'static,
    MentionTracker: DocumentMentionTrackingPort + Send + Sync + 'static,
    B: MacroEventBroker + Send + Sync + 'static,
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
        let document_id = id.to_string();
        macro_db_client::document::delete_document(&self.db, &document_id)
            .await
            .map_err(|error| internal!(error))?;
        comms_db_client::entity_mentions::delete_entity_mentions_by_source(
            &self.db,
            vec![document_id.clone()],
        )
        .await
        .inspect_err(|error| {
            tracing::error!(error = ?error, %document_id, "unable to delete entity mentions")
        })
        .ok();
        self.sqs
            .bulk_enqueue_document_delete(vec![document_id.clone()])
            .await
            .map_err(|error| internal!(error))?;
        publish_document_purged_event(&self.event_broker, &document_id)
            .map_err(|error| internal!(error))
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
