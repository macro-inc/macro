use crate::document::types::{Data, DocumentContent};
use anyhow::{Context, Error};
use document_storage_service_client::DocumentStorageServiceClient;
use lexical_client::LexicalClient;
use model::document::{DocumentBasic, FileType, response::LocationResponseV3};
use std::fmt::Debug;
use std::sync::Arc;
use sync_service_client::SyncServiceClient;

pub type NoData = ();
pub type Fetched<T> = T;

pub type NewDocumentFetcher = DocumentFetcher<NoData, NoData>;

pub struct DocumentFetcher<Location, Content> {
    pub location: Location,
    pub content: Content,
    inner_dss: Arc<DocumentStorageServiceClient>,
    inner_sync_service: Arc<SyncServiceClient>,
    inner_lexical: Arc<LexicalClient>,
    document_id: String,
    jwt_token: Option<String>,
}

// A client is a wrapper around methods that may be applied to a single document
// TODO write `BulkDocumentClient` (same interface over Vec<document_id>)
impl DocumentFetcher<NoData, NoData> {
    pub fn new(
        dss_client: Arc<DocumentStorageServiceClient>,
        sync_service_client: Arc<SyncServiceClient>,
        lexical_client: Arc<LexicalClient>,
        document_id: String,
    ) -> Self {
        Self {
            inner_dss: dss_client,
            inner_sync_service: sync_service_client,
            inner_lexical: lexical_client,
            document_id,
            content: (),
            location: (),
            jwt_token: None,
        }
    }

    /// Set JWT token for external API authentication
    pub fn with_jwt_token(mut self, jwt_token: String) -> Self {
        self.jwt_token = Some(jwt_token);
        self
    }
}

impl DocumentFetcher<NoData, NoData> {
    #[tracing::instrument(err)]
    pub async fn document_location(
        self,
    ) -> Result<DocumentFetcher<Fetched<LocationResponseV3>, NoData>, Error> {
        let location = match &self.jwt_token {
            Some(jwt) => {
                self.inner_dss
                    .get_recent_document_location_v3_external(&self.document_id, jwt)
                    .await?
            }
            None => {
                self.inner_dss
                    .get_recent_document_location_v3(&self.document_id)
                    .await?
            }
        };
        Ok(DocumentFetcher {
            content: (),
            location,
            document_id: self.document_id,
            inner_dss: self.inner_dss,
            inner_lexical: self.inner_lexical,
            inner_sync_service: self.inner_sync_service,
            jwt_token: self.jwt_token,
        })
    }

    #[tracing::instrument(err)]
    pub async fn document_content(
        self,
    ) -> Result<DocumentFetcher<Fetched<LocationResponseV3>, Fetched<DocumentContent>>, Error> {
        let client_with_location = self.document_location().await?;
        client_with_location.document_content().await
    }
}

impl DocumentFetcher<Fetched<LocationResponseV3>, NoData> {
    #[tracing::instrument(err)]
    pub async fn document_content(
        self,
    ) -> Result<DocumentFetcher<Fetched<LocationResponseV3>, Fetched<DocumentContent>>, Error> {
        let content = self.fetch_content_from_location(&self.location).await?;
        Ok(DocumentFetcher {
            content,
            location: self.location,
            document_id: self.document_id,
            inner_dss: self.inner_dss,
            inner_lexical: self.inner_lexical,
            inner_sync_service: self.inner_sync_service,
            jwt_token: self.jwt_token,
        })
    }
}

impl<T> DocumentFetcher<Fetched<LocationResponseV3>, T> {
    pub fn metadata(&self) -> &DocumentBasic {
        self.location.metadata()
    }

    pub fn preview_file_type(&self) -> Result<FileType, Error> {
        self.location.file_type()
    }
}

impl<T> DocumentFetcher<T, Fetched<DocumentContent>> {
    pub fn file_type(&self) -> FileType {
        self.content.file_type
    }
}

// -- internal util / fetching logic --
impl<L: Debug, D: Debug> DocumentFetcher<L, D> {
    #[tracing::instrument(err)]
    async fn fetch_content_from_location(
        &self,
        location: &LocationResponseV3,
    ) -> Result<DocumentContent, Error> {
        let file_type = location.file_type()?;
        match file_type {
            // pdf / docx content is static and always in macrodb
            FileType::Docx | FileType::Pdf => {
                let text = match &self.jwt_token {
                    Some(jwt) => {
                        self.inner_dss
                            .get_document_text_external(self.document_id.as_str(), jwt)
                            .await?
                    }
                    None => {
                        self.inner_dss
                            .get_document_text(self.document_id.as_str())
                            .await?
                    }
                };
                Ok(DocumentContent {
                    data: Data::Text(text),
                    document_id: location.metadata().document_id.clone(),
                    file_type,
                    location: location.clone(),
                })
            }
            // md content is usually in sync service but may be in s3
            FileType::Md => self.fetch_ai_markdown(location).await,
            // everything else is in S3 (for now)
            other => match location {
                LocationResponseV3::PresignedUrl { presigned_url, .. } => {
                    if other.is_text_content() {
                        reqwest::get(presigned_url)
                            .await
                            .context("HTTP (head) error when fetching from S3 [other]")?
                            .text()
                            .await
                            .context("HTTP (body) error when fetching from S3 [other]")
                            .map(|text| DocumentContent {
                                data: Data::Text(text),
                                document_id: self.document_id.clone(),
                                file_type,
                                location: location.clone(),
                            })
                    } else {
                        reqwest::get(presigned_url)
                            .await
                            .context("HTTP (head) error when fetching from S3 [other]")?
                            .bytes()
                            .await
                            .context("HTTP (body) error when fetching from S3 [other]")
                            .map(|bytes| DocumentContent {
                                data: Data::Binary(bytes),
                                document_id: self.document_id.clone(),
                                file_type,
                                location: location.clone(),
                            })
                    }
                }
                LocationResponseV3::SyncServiceContent { .. } => Err(anyhow::anyhow!(
                    "Unexpected location (sync service) for other document type"
                )),
                LocationResponseV3::PresignedUrls { .. } => Err(anyhow::anyhow!(
                    "Unexpected location (multi part presigned url) for other document type"
                )),
            },
        }
    }

    #[tracing::instrument(err)]
    async fn fetch_ai_markdown(
        &self,
        location: &LocationResponseV3,
    ) -> Result<DocumentContent, Error> {
        self.inner_lexical
            .parse_markdown_for_ai(&self.document_id)
            .await
            .map(|content| DocumentContent {
                data: Data::Markdown(content),
                document_id: self.document_id.clone(),
                location: location.clone(),
                file_type: FileType::Md,
            })
    }
}

//  -- internal helper --

impl<L, D> Debug for DocumentFetcher<L, D>
where
    L: Debug,
    D: Debug,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DocumentClient")
            .field("location", &self.location)
            .field("content", &self.content)
            .finish()
    }
}
