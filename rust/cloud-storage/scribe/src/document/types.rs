use anyhow::Error;
use base64::{Engine as _, engine::general_purpose};
use bytes::Bytes;
use lexical_client::types::CognitionResponseData;
use model::document::response::LocationResponseV3;
use model::document::{DocumentBasic, FileType, FileTypeExt};

#[derive(Debug, Clone)]
pub struct DocumentContent {
    pub(crate) data: Data,
    pub document_id: String,
    pub file_type: FileType,
    pub location: LocationResponseV3,
}

#[derive(Clone)]
pub enum Data {
    Text(String),
    Binary(Bytes),
    Markdown(CognitionResponseData),
}

impl std::fmt::Debug for Data {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Data::Binary(bytes) => write!(f, "Data::Binary(<{} bytes>)", bytes.len()),
            Data::Text(chars) => write!(f, "Data::Text(<{} characters>)", chars.len()),
            Data::Markdown(nodes) => write!(f, "Data::Markdown(<{} nodes>)", nodes.data.len()),
        }
    }
}

impl DocumentContent {
    pub fn metadata(&self) -> &DocumentBasic {
        self.location.metadata()
    }

    /// stringify content if its mimetype is text and it is not binary
    /// Markdown is stringifyable / preformatted
    #[tracing::instrument(err)]
    pub fn text_content(self) -> Result<String, Error> {
        if self.file_type.is_text_content() {
            Ok(self.data.to_string())
        } else {
            Err(anyhow::anyhow!("Document is not text"))
        }
    }

    #[tracing::instrument(err)]
    pub fn base64_image_content(self) -> Result<String, Error> {
        let data = self.data.binary_data();
        if self.file_type.is_image() && data.is_some() {
            let base64_string = general_purpose::STANDARD.encode(data.unwrap());
            let content_type = self.file_type.mime_type();
            Ok(format!("data:{};base64,{}", content_type, base64_string))
        } else {
            Err(anyhow::anyhow!("Data is not in image format"))
        }
    }
}

impl std::fmt::Display for Data {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Data::Markdown(md) => write!(
                f,
                "{}",
                md.data
                    .iter()
                    .map(|node| format!("[[node_id: {}]]\n{}", node.node_id, node.content))
                    .collect::<Vec<String>>()
                    .join("\n")
            ),
            Data::Binary(data) => write!(f, "{}", String::from_utf8_lossy(data)),
            Data::Text(text) => write!(f, "{}", text),
        }
    }
}

impl Data {
    pub fn binary_data(self) -> Option<Bytes> {
        if let Data::Binary(data) = self {
            Some(data)
        } else {
            None
        }
    }

    pub fn text_data(self) -> Option<String> {
        if let Data::Text(data) = self {
            Some(data)
        } else {
            None
        }
    }
}
