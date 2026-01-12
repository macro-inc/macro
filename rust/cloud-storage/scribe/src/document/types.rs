use ai::types::ImageData;
use anyhow::{Error, bail};
use bytes::Bytes;
use lexical_client::types::CognitionResponseData;
use model::document::response::LocationResponseV3;
use model::document::{DocumentBasic, FileType, FileTypeExt};
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;

#[derive(Debug, Clone)]
pub struct DocumentContent {
    pub(crate) data: Data,
    pub document_id: String,
    pub file_type: FileType,
    pub location: LocationResponseV3,
    pub properties: Option<Vec<EntityPropertyWithDefinition>>,
}

#[derive(Clone)]
pub enum Data {
    Text(String),
    Binary(Bytes),
    Markdown(CognitionResponseData),
}

impl TryFrom<DocumentContent> for ImageData {
    type Error = anyhow::Error;
    fn try_from(value: DocumentContent) -> Result<Self, Self::Error> {
        if value.file_type.is_image()
            && let Data::Binary(bytes) = value.data
        {
            ImageData::try_from_bytes(bytes.into())
        } else {
            bail!("No conversion to image")
        }
    }
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
            bail!("Document is not text")
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
