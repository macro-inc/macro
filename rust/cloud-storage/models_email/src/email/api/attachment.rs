use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AttachmentDocumentID {
    pub attachment_id: Uuid,
    pub document_id: String,
}
