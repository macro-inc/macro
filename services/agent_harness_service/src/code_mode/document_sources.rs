//! Reads a stored HTML document for its build, through document storage.
use agent_code_mode::domain::{DocumentSourceError, DocumentSources};
use async_trait::async_trait;
use document_storage_service_client::DocumentStorageServiceClient;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use model::document::{FileType, response::LocationResponseV3};
use std::{str::FromStr, time::Duration};

/// Largest HTML file a build reads.
const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
/// Longest a download of the stored file may take.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15);

/// The document's current stored file, located through document storage's
/// internal API and downloaded from its presigned URL. View access was
/// already established by the receipt.
pub struct StoredDocumentSources {
    documents: DocumentStorageServiceClient,
    downloads: reqwest::Client,
}

impl StoredDocumentSources {
    /// Bind the storage client and build the download client.
    pub fn new(documents: DocumentStorageServiceClient) -> Result<Self, rootcause::Report> {
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
impl DocumentSources for StoredDocumentSources {
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
        let location = self
            .documents
            .get_recent_document_location_v3(&document.entity().entity_id)
            .await
            .map_err(|error| {
                let missing = error
                    .downcast_ref::<reqwest::Error>()
                    .and_then(reqwest::Error::status)
                    .is_some_and(|status| status == reqwest::StatusCode::NOT_FOUND);
                if missing {
                    DocumentSourceError::NotFound
                } else {
                    DocumentSourceError::Internal(rootcause::report!("{error:#}"))
                }
            })?;
        let LocationResponseV3::PresignedUrl {
            presigned_url,
            metadata,
        } = location
        else {
            return Err(DocumentSourceError::NotHtml);
        };
        if metadata.deleted_at.is_some() {
            return Err(DocumentSourceError::NotFound);
        }
        let file_type = metadata
            .file_type
            .as_deref()
            .and_then(|file_type| FileType::from_str(file_type).ok());
        if !matches!(file_type, Some(FileType::Html | FileType::Htm)) {
            return Err(DocumentSourceError::NotHtml);
        }

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
