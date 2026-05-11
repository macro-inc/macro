//! Domain helpers for finalizing uploaded document bytes.

use std::future::Future;

use lexical_client::LexicalClient;
use model::document::{DocumentBasic, FileType, FileTypeExt};
use sync_service_client::SyncServiceClient;

use super::content::{DocumentContent, DocumentContentState};
use super::markdown_init::initialize_markdown_document;
use super::models::DocumentError;
use super::ports::{DocumentRepo, DocumentService};

/// Minimal document operations needed to finalize an uploaded object.
pub trait UploadFinalizeDocumentPort: Send + Sync {
    /// Get content lifecycle metadata for a document.
    fn get_document_content(
        &self,
        document_context: &DocumentBasic,
    ) -> impl Future<Output = Result<DocumentContent, DocumentError>> + Send;

    /// Mark document upload/finalization complete.
    fn mark_document_uploaded(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

impl<T> UploadFinalizeDocumentPort for T
where
    T: DocumentService,
{
    async fn get_document_content(
        &self,
        document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        DocumentService::get_document_content(self, document_context).await
    }

    async fn mark_document_uploaded(&self, document_id: &str) -> Result<(), DocumentError> {
        DocumentService::mark_document_uploaded(self, document_id).await
    }
}

/// Repo-backed upload-finalization port for infrastructure workers.
pub struct RepoUploadFinalizePort<R> {
    repo: R,
}

impl<R> RepoUploadFinalizePort<R> {
    /// Construct a repo-backed finalization port.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> UploadFinalizeDocumentPort for RepoUploadFinalizePort<R>
where
    R: DocumentRepo,
{
    async fn get_document_content(
        &self,
        document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        let file_type = document_context.try_file_type();
        let (_, uploaded) = if file_type
            .is_none_or(|file_type| file_type == FileType::Docx || file_type.is_static())
        {
            self.repo
                .get_document_version_id(&document_context.document_id)
                .await
                .map_err(|error| DocumentError::Internal(error.into()))?
        } else {
            self.repo
                .get_latest_document_version_id(&document_context.document_id)
                .await
                .map_err(|error| DocumentError::Internal(error.into()))?
        };

        Ok(DocumentContent::from_legacy_uploaded(uploaded, file_type))
    }

    async fn mark_document_uploaded(&self, document_id: &str) -> Result<(), DocumentError> {
        self.repo
            .mark_document_uploaded(document_id)
            .await
            .map_err(|error| DocumentError::Internal(error.into()))
    }
}

/// Finalizes uploaded document bytes once object storage reports them present.
pub struct UploadedDocumentFinalizer<'a, P> {
    document_port: &'a P,
    lexical_client: &'a LexicalClient,
    sync_service_client: &'a SyncServiceClient,
}

impl<'a, P> UploadedDocumentFinalizer<'a, P>
where
    P: UploadFinalizeDocumentPort,
{
    /// Construct a finalizer.
    pub fn new(
        document_port: &'a P,
        lexical_client: &'a LexicalClient,
        sync_service_client: &'a SyncServiceClient,
    ) -> Self {
        Self {
            document_port,
            lexical_client,
            sync_service_client,
        }
    }

    /// Finalize a document whose uploaded object is now present.
    ///
    /// Markdown uploads require the uploaded markdown body so sync-service can
    /// be initialized. Non-markdown uploads are finalized by marking them
    /// uploaded. DOCX is finalized by its unzip/conversion pipeline.
    #[tracing::instrument(skip(self, document_context, markdown), err)]
    pub async fn finalize_uploaded_document(
        &self,
        document_context: &DocumentBasic,
        markdown: Option<&str>,
    ) -> Result<(), DocumentError> {
        let file_type = document_context.try_file_type();

        if matches!(file_type, Some(FileType::Docx)) {
            return Ok(());
        }

        let content = self
            .document_port
            .get_document_content(document_context)
            .await?;
        if content.state == DocumentContentState::Ready {
            return Ok(());
        }

        if matches!(file_type, Some(FileType::Md)) {
            let markdown = markdown.ok_or_else(|| {
                DocumentError::BadRequest(
                    "markdown upload finalization requires uploaded markdown".to_string(),
                )
            })?;

            match initialize_markdown_document(
                self.lexical_client,
                self.sync_service_client,
                &document_context.document_id,
                markdown,
            )
            .await
            {
                Ok(()) => {}
                Err(error) if sync_snapshot_already_exists(&error) => {}
                Err(error) => return Err(DocumentError::Internal(error)),
            }
        }

        self.document_port
            .mark_document_uploaded(&document_context.document_id)
            .await
    }
}

fn sync_snapshot_already_exists(error: &anyhow::Error) -> bool {
    error.to_string().contains("snapshot already exists")
}
