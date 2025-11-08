use model::sync_service::SyncServiceVersionID;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CopyDocumentRequest {
    /// The name of the document without extension.
    pub document_name: String,
    pub version_id: Option<SyncServiceVersionID>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct CopyDocumentQueryParams {
    /// The version id of the document to copy. Defaults to copying the latest version of the document.
    pub version_id: Option<i64>,
}
