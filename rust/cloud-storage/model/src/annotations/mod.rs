pub mod create;
pub mod delete;
pub mod edit;

use chrono::{DateTime, Utc, serde::ts_seconds_option};
use create::{CreateCommentResponse, CreateUnthreadedAnchorResponse};
use delete::{DeleteCommentResponse, DeleteUnthreadedAnchorResponse};
use edit::{EditAnchorResponse, EditCommentResponse};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_repr::{Deserialize_repr, Serialize_repr};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub comment_id: i64,
    pub thread_id: i64,
    pub order: Option<i32>,
    pub owner: String,
    pub sender: Option<String>,
    pub text: String,
    pub metadata: Option<Value>,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=true)]
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub thread_id: i64,
    pub owner: String,
    pub resolved: bool,
    pub document_id: String,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=true)]
    pub deleted_at: Option<DateTime<Utc>>,
    pub metadata: Option<Value>,
}

#[derive(FromRow, Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentThread {
    pub thread: Thread,
    pub comments: Vec<Comment>,
}

#[derive(FromRow, Serialize, Deserialize, PartialEq, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PdfPlaceableCommentAnchor {
    pub uuid: Uuid,
    pub document_id: String,
    pub owner: String,
    pub thread_id: i64,
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
    pub thread_id: Option<i64>,
    pub page: i32,
    pub red: i32,
    pub green: i32,
    pub blue: i32,
    pub alpha: f64,
    pub highlight_type: HighlightType,
    pub text: String,
    pub page_viewport_width: f64,
    pub page_viewport_height: f64,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=true)]
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
    #[serde(rename = "create-comment")]
    #[serde(rename_all = "camelCase")]
    CreateComment {
        sender: &'a str,
        document_id: &'a str,
        response: &'a CreateCommentResponse,
    },
    #[serde(rename = "create-anchor")]
    #[serde(rename_all = "camelCase")]
    CreateUnthreadedAnchor {
        sender: &'a str,
        document_id: &'a str,
        response: &'a CreateUnthreadedAnchorResponse,
    },
    #[serde(rename = "edit-comment")]
    #[serde(rename_all = "camelCase")]
    EditComment {
        sender: &'a str,
        document_id: &'a str,
        response: &'a EditCommentResponse,
    },
    #[serde(rename = "edit-anchor")]
    #[serde(rename_all = "camelCase")]
    EditAnchor {
        sender: &'a str,
        document_id: &'a str,
        response: &'a EditAnchorResponse,
    },
    #[serde(rename = "delete-comment")]
    #[serde(rename_all = "camelCase")]
    DeleteComment {
        sender: &'a str,
        document_id: &'a str,
        response: &'a DeleteCommentResponse,
    },
    #[serde(rename = "delete-anchor")]
    #[serde(rename_all = "camelCase")]
    DeleteUnthreadedAnchor {
        sender: &'a str,
        document_id: &'a str,
        response: &'a DeleteUnthreadedAnchorResponse,
    },
}
