use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetBatchPreviewRequest {
    pub document_ids: Vec<String>,
}
