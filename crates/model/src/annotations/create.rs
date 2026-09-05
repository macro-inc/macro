use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{Anchor, HighlightType};

#[derive(Deserialize, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPlaceableCommentAnchorRequest {
    pub uuid: Option<Uuid>,
    pub page: i32,
    pub original_page: i32,
    pub original_index: i32,
    pub x_pct: f64,
    pub y_pct: f64,
    pub width_pct: f64,
    pub height_pct: f64,
    pub rotation: f64,
    pub allowable_edits: Option<Value>,
    pub was_edited: bool,
    pub was_deleted: bool,
    pub should_lock_on_save: bool,
}

#[derive(Deserialize, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfHighlightRectAnchorRequest {
    pub top: f64,
    pub left: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfHighlightAnchorRequest {
    pub uuid: Option<Uuid>,
    pub page: i32,
    pub red: i32,
    pub green: i32,
    pub blue: i32,
    pub alpha: f64,
    pub highlight_type: HighlightType,
    pub text: String,
    pub page_viewport_width: f64,
    pub page_viewport_height: f64,
    pub highlight_rects: Vec<PdfHighlightRectAnchorRequest>,
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "anchorType")]
#[serde(rename_all = "kebab-case")]
pub enum PdfAnchorRequest {
    FreeComment(PdfPlaceableCommentAnchorRequest),
    Highlight(PdfHighlightAnchorRequest),
    // Support direct thread attachment for unthreaded anchors
    Attachment(UnthreadedPdfUuidRequest),
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "attachmentType", content = "uuid")]
#[serde(rename_all = "kebab-case")]
pub enum UnthreadedPdfUuidRequest {
    Highlight(Uuid),
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "fileType")]
#[serde(rename_all = "kebab-case")]
pub enum AnchorRequest {
    Pdf(PdfAnchorRequest),
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "anchorType")]
#[serde(rename_all = "kebab-case")]
pub enum CreateUnthreadedPdfAnchorRequest {
    Highlight(PdfHighlightAnchorRequest),
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "fileType")]
#[serde(rename_all = "kebab-case")]
pub enum CreateUnthreadedAnchorRequest {
    Pdf(CreateUnthreadedPdfAnchorRequest),
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreateUnthreadedAnchorResponse {
    pub document_id: String,
    #[serde(flatten)]
    pub anchor: Anchor,
}
