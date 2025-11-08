use utoipa::ToSchema;

use model::document::SaveBomPart;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    /// The sha of the new document.
    /// This is used to generate a presigned url to upload the new document content to s3.
    pub sha: Option<String>,
    /// **DOCX ONLY**
    /// The updated BOM for the document.
    /// Containing the file path and the sha.
    pub new_bom: Option<Vec<SaveBomPart>>,
    /// The modification data for the document instance.
    /// Used to store highlights and other overlays onto a static file
    pub modification_data: Option<serde_json::Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreSaveDocumentRequest {
    /// The updated BOM for the document
    /// Containing the file path and the sha
    pub new_bom: Vec<SaveBomPart>,
}
