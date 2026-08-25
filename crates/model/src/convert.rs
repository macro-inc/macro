use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ConvertRequest {
    /// The bucket of the current item
    pub from_bucket: String,
    /// The destination bucket of the current item
    pub to_bucket: String,
    /// The key of the current item we are converting
    pub from_key: String,
    /// The destination key of the current item we are converting
    pub to_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertQueueMessage {
    /// The job id that was generaeted for this conversion
    /// Used for basic log tracking
    pub job_id: String,
    /// The bucket of the current item
    pub from_bucket: String,
    /// The destination bucket of the current item
    pub to_bucket: String,
    /// The key of the current item we are converting
    pub from_key: String,
    /// The destination key of the current item we are converting
    pub to_key: String,
}
