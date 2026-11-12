use serde::{Deserialize, Serialize};
use shared_types::document::DocumentPreview;
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetBatchPreviewResponse {
    pub previews: Vec<DocumentPreview>,
}
