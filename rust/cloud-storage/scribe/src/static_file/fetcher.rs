use crate::static_file::types::{StaticFileContent, StaticFileData};
use anyhow::{Context, Error};
use model::document::{ContentType, ContentTypeExt};
use models_sfs::FileMetadata;
use static_file_service_client::StaticFileServiceClient;
use std::fmt::Debug;
use std::str::FromStr;
use std::sync::Arc;

pub type NoData = ();
pub type Fetched<T> = T;

pub type NewStaticFileFetcher = StaticFileFetcher<NoData, NoData>;

pub struct StaticFileFetcher<Metadata, Content> {
    pub metadata: Metadata,
    pub content: Content,
    inner_sfs: Arc<StaticFileServiceClient>,
    file_id: String,
}

impl StaticFileFetcher<NoData, NoData> {
    pub fn new(sfs_client: Arc<StaticFileServiceClient>, file_id: String) -> Self {
        Self {
            inner_sfs: sfs_client,
            file_id,
            content: (),
            metadata: (),
        }
    }

    #[tracing::instrument(err)]
    pub async fn file_metadata(
        self,
    ) -> Result<StaticFileFetcher<Fetched<FileMetadata>, NoData>, Error> {
        let metadata = self
            .inner_sfs
            .get_file_metadata(&self.file_id)
            .await
            .context("Failed to get file metadata")?
            .ok_or_else(|| anyhow::anyhow!("File not found: {}", self.file_id))?;

        Ok(StaticFileFetcher {
            content: (),
            metadata,
            file_id: self.file_id,
            inner_sfs: self.inner_sfs,
        })
    }

    #[tracing::instrument(err)]
    pub async fn file_content(
        self,
    ) -> Result<StaticFileFetcher<Fetched<FileMetadata>, Fetched<StaticFileContent>>, Error> {
        let fetcher_with_metadata = self.file_metadata().await?;
        fetcher_with_metadata.file_content().await
    }
}

impl StaticFileFetcher<Fetched<FileMetadata>, NoData> {
    #[tracing::instrument(err)]
    pub async fn file_content(
        self,
    ) -> Result<StaticFileFetcher<Fetched<FileMetadata>, Fetched<StaticFileContent>>, Error> {
        let content = self.fetch_content_from_metadata(&self.metadata).await?;
        Ok(StaticFileFetcher {
            content,
            metadata: self.metadata,
            file_id: self.file_id,
            inner_sfs: self.inner_sfs,
        })
    }
}

impl<T> StaticFileFetcher<Fetched<FileMetadata>, T> {
    pub fn metadata(&self) -> &FileMetadata {
        &self.metadata
    }

    pub fn content_type(&self) -> Result<ContentType, Error> {
        ContentType::from_str(&self.metadata.content_type)
            .map_err(|_| anyhow::anyhow!("Invalid content type: {}", self.metadata.content_type))
    }
}

// -- internal util / fetching logic --
impl<L: Debug, D: Debug> StaticFileFetcher<L, D> {
    #[tracing::instrument(err)]
    async fn fetch_content_from_metadata(
        &self,
        metadata: &FileMetadata,
    ) -> Result<StaticFileContent, Error> {
        let content_type =
            ContentType::from_str(&metadata.content_type).unwrap_or(ContentType::Default);

        let file_data = self
            .inner_sfs
            .read_file(&self.file_id)
            .await
            .context("Failed to read file data")?;

        let data = if content_type.is_image() {
            StaticFileData::Binary(file_data)
        } else if content_type.is_text_content() {
            let text = String::from_utf8(file_data.to_vec())
                .context("Failed to convert file data to text")?;
            StaticFileData::Text(text)
        } else {
            StaticFileData::Binary(file_data)
        };

        Ok(StaticFileContent {
            data,
            file_id: metadata.file_id.clone(),
            content_type,
            metadata: metadata.clone(),
        })
    }
}

//  -- internal helper --

impl<L, D> Debug for StaticFileFetcher<L, D>
where
    L: Debug,
    D: Debug,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StaticFileFetcher")
            .field("metadata", &self.metadata)
            .field("content", &self.content)
            .field("file_id", &self.file_id)
            .finish()
    }
}
