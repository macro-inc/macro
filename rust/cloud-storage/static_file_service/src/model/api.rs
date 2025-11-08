use crate::service::dynamodb::model::MetadataObject;
use models_sfs::FileMetadata;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PutFileRequest {
    /// file name
    pub file_name: String,
    /// optional mime type if type cannot be infered from file_name
    pub content_type: Option<String>,
    /// extra metadata to store with file
    /// don't put anything private in here it is public
    pub extension_data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PutFileResponse {
    /// expiring url to upload file blob to
    pub upload_url: String,
    /// permalink
    pub file_location: String,
    /// key to retrieve metadata
    pub id: String,
}

// Re-export the shared FileMetadata type as GetFileMetadataResponse for API compatibility
pub type GetFileMetadataResponse = FileMetadata;

impl From<MetadataObject> for FileMetadata {
    fn from(value: MetadataObject) -> Self {
        FileMetadata {
            file_id: value.file_id,
            is_uploaded: value.is_uploaded,
            extension_data: value.extension_data,
            file_name: value.file_name,
            content_type: value.content_type,
            owner_id: value.owner_id,
            s3_key: value.s3_key,
        }
    }
}
