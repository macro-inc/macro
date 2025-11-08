use anyhow::Error;
use base64::{Engine as _, engine::general_purpose};
use bytes::Bytes;
use model::document::ContentType;
use models_sfs::FileMetadata;

#[derive(Debug, Clone)]
pub struct StaticFileContent {
    pub(crate) data: StaticFileData,
    pub file_id: String,
    pub content_type: ContentType,
    pub metadata: FileMetadata,
}

#[derive(Clone, Debug)]
pub enum StaticFileData {
    Text(String),
    Binary(Bytes),
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
    pub fn base64_image_content(self) -> Result<String, Error> {
        let data = self.data.binary_data();
        if self.content_type.is_image() && data.is_some() {
            let base64_string = general_purpose::STANDARD.encode(data.unwrap());
            let content_type = self.content_type.mime_type();
            Ok(format!("data:{};base64,{}", content_type, base64_string))
        } else {
            Err(anyhow::anyhow!("Data is not in image format"))
        }
    }
}

impl std::fmt::Display for StaticFileData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StaticFileData::Binary(data) => write!(f, "{}", String::from_utf8_lossy(data)),
            StaticFileData::Text(text) => write!(f, "{}", text),
        }
    }
}

impl StaticFileData {
    pub fn binary_data(self) -> Option<Bytes> {
        if let StaticFileData::Binary(data) = self {
            Some(data)
        } else {
            None
        }
    }

    pub fn text_data(self) -> Option<String> {
        if let StaticFileData::Text(data) = self {
            Some(data)
        } else {
            None
        }
    }
}
