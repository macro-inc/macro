use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::AnchorId;

#[derive(Deserialize, ToSchema)]
#[serde(tag = "anchorType", content = "uuid")]
#[serde(rename_all = "kebab-case")]
pub enum DeleteUnthreadedPdfAnchorRequest {
    Highlight(Uuid),
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "fileType")]
#[serde(rename_all = "kebab-case")]
pub enum DeleteUnthreadedAnchorRequest {
    Pdf(DeleteUnthreadedPdfAnchorRequest),
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteUnthreadedAnchorResponse {
    pub document_id: String,
    #[serde(flatten)]
    pub anchor_info: AnchorId,
    /// Root of the discussion that was deleted with the anchor, if it had one.
    pub root_id: Option<Uuid>,
}
