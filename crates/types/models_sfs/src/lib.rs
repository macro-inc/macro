use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// File metadata for static files
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FileMetadata {
    /// id of static file
    pub file_id: String,
    /// mimetype
    pub content_type: String,
    /// is data uploaded to s3
    pub is_uploaded: bool,
    /// extra metadata, uploaded with the file
    pub extension_data: Option<Value>,
    /// file name
    pub file_name: String,
    /// owner
    pub owner_id: String,
    /// s3 key
    pub s3_key: String,
}
