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

#[derive(Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCommentRequest {
    pub remove_anchor_thread_only: Option<bool>,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAnchorInfo {
    #[serde(flatten)]
    pub anchor_info: AnchorId,
    pub deleted: bool,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteThreadInfo {
    pub thread_id: i64,
    pub deleted: bool,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCommentResponse {
    pub document_id: String,
    pub comment_id: i64,
    pub thread: DeleteThreadInfo,
    pub anchor: Option<DeleteAnchorInfo>,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteUnthreadedAnchorResponse {
    pub document_id: String,
    #[serde(flatten)]
    pub anchor_info: AnchorId,
    pub thread_id: Option<i64>,
}
