//! Reads a stored HTML document for its build, through the documents domain.
use agent_code_mode::domain::{DocumentSourceError, DocumentSources};
use async_trait::async_trait;
use documents::domain::{
    models::LocationQueryParams, ports::DocumentService, response::LocationResponseV3,
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use model::document::FileType;
use std::{sync::Arc, time::Duration};

/// Largest HTML file a build reads.
const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
/// Longest a download of the stored file may take.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15);

/// The document's current stored file: located by the same documents service
/// Macro's own tools use, under the viewer's receipt, and downloaded from its
/// presigned URL.
pub struct StoredDocumentSources<D> {
    documents: Arc<D>,
    downloads: reqwest::Client,
}

impl<D> StoredDocumentSources<D> {
    /// Bind the documents service and build the download client.
    pub fn new(documents: Arc<D>) -> Result<Self, rootcause::Report> {
        let downloads = reqwest::Client::builder()
            .timeout(DOWNLOAD_TIMEOUT)
            .build()?;
        Ok(Self {
            documents,
            downloads,
        })
    }
}

#[async_trait]
impl<D: DocumentService> DocumentSources for StoredDocumentSources<D> {
    #[tracing::instrument(
        name = "document_programs.read_source",
        skip_all,
        fields(document_id = %document.entity().entity_id, bytes = tracing::field::Empty),
        err
    )]
    async fn html(
        &self,
        document: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentSourceError> {
        // The receipt already proves view access; this is the metadata the
        // location lookup needs.
        let basic = self
            .documents
            .internal_get_basic_document(&document.entity().entity_id)
            .await
            .map_err(|_| DocumentSourceError::NotFound)?;
        if basic.deleted_at.is_some() {
            return Err(DocumentSourceError::NotFound);
        }
        if !matches!(basic.try_file_type(), Some(FileType::Html | FileType::Htm)) {
            return Err(DocumentSourceError::NotHtml);
        }

        let location = self
            .documents
            .get_document_location(
                &basic,
                document.clone(),
                LocationQueryParams {
                    document_version_id: None,
                    get_converted_docx_url: None,
                },
            )
            .await
            .map_err(|error| DocumentSourceError::Internal(rootcause::report!("{error}")))?;
        let LocationResponseV3::PresignedUrl { presigned_url, .. } = location else {
            return Err(DocumentSourceError::NotHtml);
        };
        // The URL is browser-facing; a server-side fetch on the local stack
        // must reach LocalStack directly (a no-op elsewhere).
        let presigned_url = macro_aws_config::transform_aws_url_for_internal_fetch(&presigned_url);

        let internal = |error: reqwest::Error| {
            DocumentSourceError::Internal(rootcause::report!("{}", error.without_url()))
        };
        let mut response = self
            .downloads
            .get(&presigned_url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(internal)?;
        let declared = response.content_length().unwrap_or(0);
        if usize::try_from(declared).map_or(true, |declared| declared > MAX_HTML_BYTES) {
            return Err(DocumentSourceError::TooLarge);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(internal)? {
            if bytes.len() + chunk.len() > MAX_HTML_BYTES {
                return Err(DocumentSourceError::TooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        tracing::Span::current().record("bytes", bytes.len());
        String::from_utf8(bytes).map_err(|_| DocumentSourceError::NotHtml)
    }
}
