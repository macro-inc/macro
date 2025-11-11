mod location;
pub use location::*;

use crate::document::{BomPart, FileType};
use crate::response::TypedSuccessResponse;
use crate::{document::DocumentMetadata, response::PresignedUrl};
use chrono::serde::ts_seconds_option;
use models_permissions::share_permission::access_level::AccessLevel;
use tracing::instrument;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentListResult {
    /// The id of the document
    pub document_id: String,
    /// The id of the document version
    pub document_version_id: i64,
    /// The name of the document
    pub document_name: String,
    /// The file type of the document
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
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
    /// The time the document was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the document instance / document BOM was updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetDocumentResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: GetDocumentResponseData,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentResponseData {
    /// The metadata of the document
    pub document_metadata: DocumentMetadata,
    /// The users level of access to the document
    pub user_access_level: AccessLevel,
    /// The users view location if there is one
    pub view_location: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum LocationResponseData {
    /// The presigned url of the document if it is not a docx
    PresignedUrl(String),
    /// The presigned urls of the docx bom parts if it is a docx
    PresignedUrls(Vec<PresignedUrl>),
}

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
            .and_then(|file_type| file_type.try_into().ok())
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

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentResponseData {
    #[serde(flatten)]
    pub document_response: DocumentResponse,
    /// Content type of the document converted from file type
    pub content_type: String,
    /// The file type of the document
    pub file_type: Option<String>,
}

pub type CreateDocumentResponse = TypedSuccessResponse<CreateDocumentResponseData>;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentRequest {
    /// The id of the document in the database
    pub id: Option<String>,
    /// The sha of the document.
    pub sha: String,
    /// The name of the document without extension.
    pub document_name: String,
    /// Optional file type of the document.
    pub file_type: Option<String>,
    /// The content type of the document (currently only used for logging matches against file type).
    pub mime_type: Option<String>,
    /// The document family id if the document is being branched.
    pub document_family_id: Option<i64>,
    /// The document id if the document is being branched.
    pub branched_from_id: Option<String>,
    /// The version id if the document is being branched.
    pub branched_from_version_id: Option<i64>,
    /// Optional job id to be used to track an upload job for the newly created document.
    /// Will need to have a corresponding job initiated for the file beforehand.
    pub job_id: Option<String>,
    //// Optional project id to be used to what project the document belongs to.
    pub project_id: Option<String>,
}
