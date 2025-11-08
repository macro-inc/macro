use utoipa::ToSchema;

use model::document::{DocumentMetadata, response::GetDocumentListResult};
use models_permissions::share_permission::access_level::AccessLevel;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct UserDocumentsResponse {
    // The documents returned from the query
    pub documents: Vec<DocumentMetadata>,
    /// The total number of documents the user has
    pub total: i64,
    /// The next offset to be used if there is one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetDocumentsResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Message to explain failure
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Data to be returned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<UserDocumentsResponse>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetDocumentProcessingResult {
    /// The stringified result
    pub result: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetDocumentProcessingResultResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Message to explain failure
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Data to be returned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<GetDocumentProcessingResult>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetDocumentSearchResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: Vec<GetDocumentListResult>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentPermissionsResponseDataV2 {
    pub document_permissions: models_permissions::share_permission::SharePermissionV2,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetDocumentKeyResponseData {
    /// The key of the document
    pub key: String,
}

#[derive(serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetDocumentKeyResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: GetDocumentKeyResponseData,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentUserAccessLevelResponse {
    /// The user's access level to the document
    pub user_access_level: AccessLevel,
}
