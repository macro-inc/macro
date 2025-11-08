use utoipa::ToSchema;

use model::{document::DocumentMetadata, response::PresignedUrl};

use super::DocumentResponse;

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

#[derive(serde::Serialize, serde::Deserialize, ToSchema)]
pub struct CreateBulkDocumentResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: Vec<CreateBulkDocumentResponseData>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateBulkDocumentResponseData {
    /// Indicates if the document was created successfully
    pub success: bool,
    /// The created documents metadata
    /// Only returned if the document was created successfully
    pub document_metadata: Option<DocumentMetadata>,
    /// The presigned url used to upload the document
    /// Only returned if the document was created successfully
    pub presigned_url: Option<PresignedUrl>,
}
