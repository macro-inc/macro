use model::document::DocumentPreview;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetBatchPreviewResponse {
    pub previews: Vec<DocumentPreview>,
}
