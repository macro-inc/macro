use chrono::{DateTime, Utc};
pub mod create;
pub mod delete;
pub mod edit;

use create::CreateUnthreadedAnchorResponse;
use delete::DeleteUnthreadedAnchorResponse;
use edit::EditAnchorResponse;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_repr::{Deserialize_repr, Serialize_repr};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(FromRow, Serialize, Deserialize, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPlaceableCommentAnchor {
    pub uuid: Uuid,
    pub document_id: String,
    pub owner: String,
    pub thread_id: Uuid,
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

#[derive(sqlx::Type, FromRow, Serialize, Deserialize, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfHighlightRect {
    pub id: i64,
    pub top: f64,
    pub left: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize_repr, Deserialize_repr, PartialEq, Debug, Clone, ToSchema, Copy)]
#[repr(u8)]
pub enum HighlightType {
    Highlight = 1,
    Underline = 2,
    Strikeout = 3,
}

impl From<i32> for HighlightType {
    fn from(value: i32) -> Self {
        match value {
            1 => HighlightType::Highlight,
            2 => HighlightType::Underline,
            3 => HighlightType::Strikeout,
            _ => panic!("Invalid highlight type"),
        }
    }
}

#[derive(FromRow, Serialize, Deserialize, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfHighlightAnchor {
    pub uuid: Uuid,
    pub document_id: String,
    pub owner: String,
    pub thread_id: Option<Uuid>,
    pub page: i32,
    pub red: i32,
    pub green: i32,
    pub blue: i32,
    pub alpha: f64,
    pub highlight_type: HighlightType,
    pub text: String,
    pub page_viewport_width: f64,
    pub page_viewport_height: f64,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub highlight_rects: Vec<PdfHighlightRect>,
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(tag = "anchorType")]
#[serde(rename_all = "kebab-case")]
pub enum PdfAnchor {
    Placeable(PdfPlaceableCommentAnchor),
    Highlight(PdfHighlightAnchor),
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(untagged)]
#[serde(rename_all = "kebab-case")]
pub enum Anchor {
    Pdf(PdfAnchor),
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(tag = "fileType")]
#[serde(rename_all = "kebab-case")]
pub enum AnchorId {
    Pdf(PdfAnchorId),
}

#[derive(Serialize, ToSchema, Debug)]
#[serde(tag = "anchorType", content = "uuid")]
#[serde(rename_all = "kebab-case")]
pub enum PdfAnchorId {
    FreeComment(Uuid),
    Highlight(Uuid),
}

impl From<AnchorId> for Uuid {
    fn from(val: AnchorId) -> Self {
        match val {
            AnchorId::Pdf(pdf_id) => match pdf_id {
                PdfAnchorId::FreeComment(uuid) => uuid,
                PdfAnchorId::Highlight(uuid) => uuid,
            },
        }
    }
}

#[derive(Serialize, Debug, ToSchema)]
#[serde(tag = "updateType", content = "payload")]
pub enum AnnotationIncrementalUpdate<'a> {
    #[serde(rename = "create-anchor")]
    #[serde(rename_all = "camelCase")]
    CreateUnthreadedAnchor {
        sender: &'a str,
        document_id: &'a str,
        response: &'a CreateUnthreadedAnchorResponse,
    },
    #[serde(rename = "edit-anchor")]
    #[serde(rename_all = "camelCase")]
    EditAnchor {
        sender: &'a str,
        document_id: &'a str,
        response: &'a EditAnchorResponse,
    },
    #[serde(rename = "delete-anchor")]
    #[serde(rename_all = "camelCase")]
    DeleteUnthreadedAnchor {
        sender: &'a str,
        document_id: &'a str,
        response: &'a DeleteUnthreadedAnchorResponse,
    },
}
