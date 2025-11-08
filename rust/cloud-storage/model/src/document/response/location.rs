use crate::document::{DocumentBasic, FileType};
use crate::response::PresignedUrl;
use crate::sync_service::DocumentMetadata as SyncServiceMetadata;
use anyhow::Result;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub enum LocationResponseV3 {
    PresignedUrl {
        presigned_url: String,
        metadata: DocumentBasic,
    },
    PresignedUrls {
        presigned_urls: Vec<PresignedUrl>,
        metadata: DocumentBasic,
    },
    SyncServiceContent {
        metadata: DocumentBasic,
        sync_service_metadata: SyncServiceMetadata,
    },
}

impl LocationResponseV3 {
    pub fn metadata(&self) -> &DocumentBasic {
        match self {
            Self::PresignedUrl { metadata, .. } => metadata,
            Self::PresignedUrls { metadata, .. } => metadata,
            Self::SyncServiceContent { metadata, .. } => metadata,
        }
    }

    pub fn sync_service_metadata(&self) -> Option<&SyncServiceMetadata> {
        if let Self::SyncServiceContent {
            sync_service_metadata,
            ..
        } = self
        {
            Some(sync_service_metadata)
        } else {
            None
        }
    }

    pub fn file_type(&self) -> Result<FileType> {
        self.metadata()
            .file_type
            .as_deref()
            .and_then(FileType::from_str)
            .ok_or_else(|| anyhow::anyhow!("unxpected file type {:?}", self.file_type()))
    }
}
