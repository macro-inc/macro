use utoipa::ToSchema;

use model::response::PresignedUrl;

use model::document::response::DocumentResponseMetadata;

#[derive(serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SaveDocumentResponse {
    /// Indicates if an error occurred
    pub error: bool,

    /// Data to be returned
    pub data: SaveDocumentResponseData,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentResponseData {
    /// The updated document metadata
    pub document_metadata: DocumentResponseMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// If the document is an editable file, we provide a presigned url to save the updated file to.
    pub presigned_url: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreSaveDocumentResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: PreSaveDocumentResponseData,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreSaveDocumentResponseData {
    /// Contains any presigned urls you need to upload specific bom parts with.
    pub presigned_urls: Vec<PresignedUrl>,
}
