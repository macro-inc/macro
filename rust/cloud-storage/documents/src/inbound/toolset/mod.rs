//! Toolset inbound adapter for Documents.

mod create_document;
mod edit_document;
mod read_content;
mod read_metadata;
mod rename_document;

#[cfg(test)]
mod test;

use crate::{
    domain::create::DocumentCreator,
    domain::ports::DocumentService,
    domain::ports::create::DocumentCreationService,
    domain::ports::editing::EditingWorkerService,
    inbound::toolset::{
        create_document::CreateDocument, edit_document::EditDocument, read_content::ReadContent,
        read_metadata::ReadMetadata, rename_document::RenameDocument,
    },
    outbound::{
        document_bytes_upload::ReqwestDocumentBytesUploader,
        markdown_init::LexicalSyncMarkdownInitializer,
    },
};
use ai_toolset::AsyncToolCollection;
use entity_access::domain::ports::EntityAccessService;
use lexical_client::LexicalClient;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

/// Default backend-owned document creation use case for document tools.
pub type DefaultDocumentToolCreator<DSvc> =
    DocumentCreator<Arc<DSvc>, LexicalSyncMarkdownInitializer, ReqwestDocumentBytesUploader>;

/// Service context for document AI tools
pub struct DocumentToolContext<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
> {
    /// The document service instance
    pub service: Arc<DSvc>,
    /// The entity access service instance
    pub entity_access_service: Arc<ESvc>,

    /// The lexical client
    pub lexical_client: Arc<LexicalClient>,

    /// The sync-service client
    pub sync_service_client: Arc<SyncServiceClient>,

    /// Backend-owned document creation use case.
    pub creator: DefaultDocumentToolCreator<DSvc>,

    /// Editing worker service for the EditDocument tool.
    pub editing: Arc<EDSvc>,

    /// The caller's Bearer token, set per-request. Used by EditDocument to
    /// authenticate with the editing worker (which exchanges it for a
    /// document-scoped JWT internally).
    pub user_token: Option<String>,
}

impl<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
> Clone for DocumentToolContext<DSvc, ESvc, EDSvc>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            lexical_client: self.lexical_client.clone(),
            sync_service_client: self.sync_service_client.clone(),
            creator: self.creator.clone(),
            editing: self.editing.clone(),
            user_token: self.user_token.clone(),
        }
    }
}

impl<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
> DocumentToolContext<DSvc, ESvc, EDSvc>
{
    /// Create a new document tool context
    pub fn new(
        service: DSvc,
        entity_access_service: ESvc,
        lexical_client: LexicalClient,
        sync_service_client: SyncServiceClient,
        editing: Arc<EDSvc>,
    ) -> Self {
        let service = Arc::new(service);
        let lexical_client = Arc::new(lexical_client);
        let sync_service_client = Arc::new(sync_service_client);
        let creator = DocumentCreator::new(
            service.clone(),
            LexicalSyncMarkdownInitializer::new(
                lexical_client.as_ref().clone(),
                sync_service_client.as_ref().clone(),
            ),
            ReqwestDocumentBytesUploader::default(),
        );

        Self {
            service,
            entity_access_service: Arc::new(entity_access_service),
            lexical_client,
            sync_service_client,
            creator,
            editing,
            user_token: None,
        }
    }
}

/// Create a document toolset
pub fn document_toolset<DSvc, ESvc, EDSvc>(
) -> AsyncToolCollection<DocumentToolContext<DSvc, ESvc, EDSvc>>
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    AsyncToolCollection::new()
        .add_tool::<ReadMetadata, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<ReadContent, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<CreateDocument, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<RenameDocument, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<EditDocument, DocumentToolContext<DSvc, ESvc, EDSvc>>()
}
