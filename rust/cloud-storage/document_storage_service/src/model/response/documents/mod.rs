use std::str::FromStr;

use chrono::serde::ts_seconds_option;
use model::document::{BomPart, DocumentMetadata, FileType};
use tracing::instrument;
use utoipa::ToSchema;

pub mod create;
pub mod get;
pub mod preview;
pub mod save;
pub mod user_document_view_location;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentResponse {
    pub document_metadata: DocumentResponseMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presigned_url: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentResponseMetadata {
    /// The document id
    pub document_id: String,
    /// The version of the document
    /// This could be the document_instance_id or document_bom_id depending on
    /// the file type
    pub document_version_id: i64,
    /// The owner of the document
    pub owner: String,
    /// The name of the document
    pub document_name: String,
    /// The file type of the document
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// If the document is a PDF, this is the SHA of the pdf
    /// If the document is a DOCX, this will not be present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    /// The id of the document this document branched from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_id: Option<String>,
    /// The id of the version this document branched from
    /// This could be either DocumentInstance or DocumentBom id depending on
    /// the file type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_version_id: Option<i64>,
    /// The id of the document family this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_family_id: Option<i64>,
    /// If the document is a DOCX document, the document_bom will be present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_bom: Option<Vec<BomPart>>,
    /// The modification data for the document instance.
    /// This is only used for PDF documents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modification_data: Option<serde_json::Value>,
    /// The time the document was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the document instance / document BOM was updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl DocumentResponseMetadata {
    /// Initialize document response from document metadata
    fn initialize_from_document_metadata(document_metadata: &DocumentMetadata) -> Self {
        DocumentResponseMetadata {
            document_id: document_metadata.document_id.clone(),
            document_version_id: document_metadata.document_version_id,
            owner: document_metadata.owner.clone(),
            document_name: document_metadata.document_name.clone(),
            file_type: document_metadata.file_type.clone(),
            sha: document_metadata.sha.clone(),
            document_bom: None,
            modification_data: document_metadata.modification_data.clone(),
            branched_from_id: document_metadata.branched_from_id.clone(),
            branched_from_version_id: document_metadata.branched_from_version_id,
            document_family_id: document_metadata.document_family_id,
            created_at: document_metadata.created_at,
            updated_at: document_metadata.updated_at,
        }
    }

    #[instrument]
    pub fn from_document_metadata(document_metadata: &DocumentMetadata) -> anyhow::Result<Self> {
        // Initialize document response
        let mut document_response_metadata =
            DocumentResponseMetadata::initialize_from_document_metadata(document_metadata);
        // Ensure we have a valid file type
        if let Some(FileType::Docx) = document_metadata
            .file_type
            .as_deref()
            .and_then(|file_type| FileType::from_str(file_type).ok())
            && let Some(document_bom) = &document_metadata.document_bom
        {
            let document_bom: Vec<BomPart> = match serde_json::from_value(document_bom.clone()) {
                Ok(document_bom) => document_bom,
                Err(e) => {
                    return Err(anyhow::anyhow!(format!(
                        "document bom could not be serialized {e}",
                    )));
                }
            };
            document_response_metadata.document_bom = Some(document_bom);
        };

        Ok(document_response_metadata)
    }
}
