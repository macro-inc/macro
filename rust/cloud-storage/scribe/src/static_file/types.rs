use anyhow::{Error, bail};
use attachment::image::ImageData;
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

impl TryFrom<StaticFileContent> for ImageData {
    type Error = anyhow::Error;
    fn try_from(value: StaticFileContent) -> Result<Self, Self::Error> {
        if value.content_type.is_image()
            && let Data::Binary(bytes) = value.data
        {
            ImageData::try_from_bytes(bytes.into())
        } else {
            bail!("No conversion to image")
        }
    }
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
            bail!("Static file is not text")
        }
    }
}
