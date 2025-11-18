use crate::compress_image::make_compressed_base64_webp;
use anyhow::Error;
use model::document::{ContentType, ContentTypeExt};

use models_sfs::FileMetadata;

pub type Data = crate::document::types::Data;

#[derive(Debug, Clone)]
pub struct StaticFileContent {
    pub(crate) data: Data,
    pub file_id: String,
    pub content_type: ContentType,
    pub metadata: FileMetadata,
}

impl StaticFileContent {
    pub fn metadata(&self) -> &FileMetadata {
        &self.metadata
    }

    /// stringify content if its mimetype is text and it is not binary
    #[tracing::instrument(err)]
    pub fn text_content(self) -> Result<String, Error> {
        if self.content_type.is_text_content() {
            Ok(self.data.to_string())
        } else {
            Err(anyhow::anyhow!("Static file is not text"))
        }
    }

    #[tracing::instrument(err)]
    pub fn base64_compressed_webp(self) -> Result<String, Error> {
        if self.content_type.is_image()
            && let Some(bytes) = self.data.binary_data()
        {
            make_compressed_base64_webp(&bytes)
        } else {
            Err(anyhow::anyhow!("Data is not in image format"))
        }
    }
}
