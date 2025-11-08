// TODO: remove dependency on model crate
use model::document::{BackfillSearchDocumentInformation, CONVERTED_DOCUMENT_FILE_NAME, FileType};

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct DocumentId {
    pub document_id: String,
}

/// Search text extractor message
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct SearchExtractorMessage {
    /// The user id who owns the document
    pub user_id: String,
    /// The document id
    pub document_id: String,
    /// The file type of the document
    pub file_type: FileType,
    /// The version of the document
    ///
    /// The version may be "convert" for documents that have been converted to a different format
    /// like docx to pdf
    /// NOTE: this will become deprecated once we remove document versioning
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_version_id: Option<String>,
}

impl<'a> From<&'a BackfillSearchDocumentInformation> for SearchExtractorMessage {
    fn from(value: &'a BackfillSearchDocumentInformation) -> Self {
        match value.file_type {
            FileType::Docx => {
                SearchExtractorMessage {
                    user_id: value.owner.clone(),
                    document_id: value.document_id.clone(),
                    file_type: FileType::Pdf, // Explicitly override the file type to pdf since we are looking for the converted file
                    document_version_id: Some(CONVERTED_DOCUMENT_FILE_NAME.to_string()),
                }
            }
            _ => SearchExtractorMessage {
                user_id: value.owner.clone(),
                document_id: value.document_id.clone(),
                file_type: value.file_type,
                document_version_id: Some(value.document_version_id.to_string()),
            },
        }
    }
}
