use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub static EXTRACT_UPLOAD_FOLDER: &str = "extract";

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct S3ObjectInfo {
    pub bucket: String,
    pub key: String,
}

#[derive(Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadExtractFolderRequest {
    pub sha: String,
    pub name: Option<String>,
    pub parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadExtractFolderResponseData {
    pub request_id: String,
    pub presigned_url: String,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkProjectUploadedRequest {
    pub project_id: String,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkProjectUploadedResponse {
    /// all the project ids that were recursively marked as uploaded
    pub project_ids: Vec<String>,
}
