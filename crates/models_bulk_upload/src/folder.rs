use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{UploadFolderProgress, UploadFolderStatus};

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

/// Where a folder upload stands, for the uploader to follow it to the end.
#[derive(Serialize, Deserialize, Debug, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadExtractStatusResponseData {
    pub status: UploadFolderStatus,
    /// The uploaded folder, once it exists.
    pub project_id: Option<String>,
    /// Files stored so far, once the extractor has counted them.
    pub progress: Option<UploadFolderProgress>,
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
