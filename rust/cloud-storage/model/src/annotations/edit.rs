use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{Anchor, Comment};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditCommentRequest {
    pub text: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditPdfPlaceableCommentAnchorRequest {
    pub uuid: Uuid,
    pub page: Option<i32>,
    pub original_page: Option<i32>,
    pub original_index: Option<i32>,
    pub x_pct: Option<f64>,
    pub y_pct: Option<f64>,
    pub width_pct: Option<f64>,
    pub height_pct: Option<f64>,
    pub rotation: Option<f64>,
    pub allowable_edits: Option<Value>,
    pub was_edited: Option<bool>,
    pub was_deleted: Option<bool>,
    pub should_lock_on_save: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "anchorType")]
#[serde(rename_all = "kebab-case")]
pub enum EditPdfAnchorRequest {
    FreeComment(EditPdfPlaceableCommentAnchorRequest),
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "fileType")]
#[serde(rename_all = "kebab-case")]
pub enum EditAnchorRequest {
    Pdf(EditPdfAnchorRequest),
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EditCommentResponse {
    pub document_id: String,
    #[serde(flatten)]
    pub comment: Comment,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EditAnchorResponse {
    pub document_id: String,
    #[serde(flatten)]
    pub anchor: Anchor,
}
